import 'server-only'
import { createHash } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Limitação de requisições durável e compartilhada entre instâncias.
 *
 * A implementação anterior usava um Map no nível do módulo. Na Vercel, cada
 * instância serverless tinha sua própria cópia, e cada publicação a apagava;
 * assim, o limite efetivo era "limite x número de instâncias ativas", e um
 * invasor podia zerá-lo aguardando uma publicação. Agora os contadores ficam
 * no Postgres, o único armazenamento compartilhado por todas as instâncias, e
 * o incremento é feito em um único INSERT ... ON CONFLICT DO UPDATE, tornando-o
 * atômico sob concorrência: não há janela de leitura e gravação na qual duas
 * requisições possam passar ao mesmo tempo.
 *
 * FALHA FECHADA. Se não for possível acessar o armazenamento, o padrão é negar.
 * Um limitador que libera tudo silenciosamente quando o banco falha deixa de
 * limitar justamente os endpoints protegidos (login, MCP e links públicos de
 * pagamento), que um invasor tentaria sobrecarregar para contornar a proteção.
 * Os pontos de chamada que preferirem permanecer disponíveis em vez de
 * protegidos devem optar explicitamente por onStoreFailure: 'allow' e explicar o motivo.
 */

export interface RateLimitPolicy {
  /** Requisições permitidas por janela. */
  limit: number
  /** Duração da janela em milissegundos. Limitada no servidor ao intervalo [1s, 24h]. */
  windowMs: number
  /**
   * Comportamento quando o Postgres está inacessível. O padrão é 'deny' (falha fechada).
   */
  onStoreFailure?: 'deny' | 'allow'
}

export interface RateLimitDecision {
  allowed: boolean
  /** Cota restante na janela atual, nunca inferior a 0. */
  remaining: number
  /** Segundos até a renovação da janela, adequado para o cabeçalho Retry-After. */
  retryAfterSeconds: number
  /** Verdadeiro quando o armazenamento estava inacessível e onStoreFailure determinou este resultado. */
  degraded: boolean
}

/** Interface mínima do cliente Supabase necessária neste módulo, permitindo substituí-lo nos testes. */
export interface RateLimitStore {
  rpc(
    fn: 'consume_rate_limit' | 'peek_rate_limit',
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>
}

let storeFactory: (() => RateLimitStore) | null = null

/**
 * Ponto de substituição para testes. Troca o armazenamento baseado em Postgres
 * por uma simulação, permitindo testar atomicidade e falha fechada sem banco de
 * dados. Não faz parte da API de produção; o código de produção nunca o utiliza.
 */
export function _setRateLimitStore(factory: (() => RateLimitStore) | null): void {
  storeFactory = factory
}

function store(): RateLimitStore {
  if (storeFactory) return storeFactory()
  return createServiceClient() as unknown as RateLimitStore
}

/**
 * Cria uma chave opaca para o grupo.
 *
 * O identificador é armazenado como hash, não em texto puro: caso contrário, a
 * tabela de contadores acumularia endereços de e-mail, endereços IP e hashes de
 * chaves de API - dados pessoais que não temos motivo para guardar e cujo
 * tamanho não podemos limitar. O namespace permanece legível para facilitar a
 * depuração do grupo.
 */
export function rateLimitKey(namespace: string, identifier: string): string {
  const digest = createHash('sha256').update(identifier).digest('hex').slice(0, 32)
  return `${namespace}:${digest}`
}

interface RpcRow {
  allowed: boolean
  remaining: number
  retry_after_seconds: number
}

/** O PostgREST retorna funções RETURNS TABLE como um vetor de linhas. */
function firstRow(data: unknown): RpcRow | null {
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') return null
  const candidate = row as Partial<RpcRow>
  if (typeof candidate.allowed !== 'boolean') return null
  return {
    allowed: candidate.allowed,
    remaining: typeof candidate.remaining === 'number' ? candidate.remaining : 0,
    retry_after_seconds:
      typeof candidate.retry_after_seconds === 'number' ? candidate.retry_after_seconds : 60,
  }
}

function storeFailure(policy: RateLimitPolicy, reason: string): RateLimitDecision {
  const allow = policy.onStoreFailure === 'allow'
  console.error(
    `rate-limit: armazenamento indisponível (${reason}); ${allow ? 'permitindo (falha aberta, opção explícita)' : 'negando (falha fechada)'}`
  )
  return {
    allowed: allow,
    remaining: 0,
    retryAfterSeconds: Math.max(1, Math.ceil(policy.windowMs / 1000)),
    degraded: true,
  }
}

/**
 * Consome uma unidade da cota de um grupo e informa se a chamada pode prosseguir.
 * Requisições bloqueadas também são contabilizadas; insistir em um grupo já
 * bloqueado o mantém assim, em vez de conceder uma nova cota.
 */
export async function consumeRateLimit(
  bucket: string,
  policy: RateLimitPolicy
): Promise<RateLimitDecision> {
  try {
    const { data, error } = await store().rpc('consume_rate_limit', {
      p_bucket: bucket,
      p_limit: policy.limit,
      p_window_seconds: Math.max(1, Math.ceil(policy.windowMs / 1000)),
      p_cost: 1,
    })
    if (error) return storeFailure(policy, error.message)
    const row = firstRow(data)
    if (!row) return storeFailure(policy, 'formato de resposta inesperado')
    return {
      allowed: row.allowed,
      remaining: row.remaining,
      retryAfterSeconds: row.retry_after_seconds,
      degraded: false,
    }
  } catch (err) {
    return storeFailure(policy, err instanceof Error ? err.message : 'erro desconhecido')
  }
}

/**
 * Consulta um grupo sem consumir sua cota. Usado para respeitar um bloqueio
 * vigente antes de uma tentativa, sem prolongá-lo durante a consulta.
 */
export async function peekRateLimit(
  bucket: string,
  policy: RateLimitPolicy
): Promise<RateLimitDecision> {
  try {
    const { data, error } = await store().rpc('peek_rate_limit', {
      p_bucket: bucket,
      p_limit: policy.limit,
      p_window_seconds: Math.max(1, Math.ceil(policy.windowMs / 1000)),
    })
    if (error) return storeFailure(policy, error.message)
    const row = firstRow(data)
    if (!row) return storeFailure(policy, 'formato de resposta inesperado')
    return {
      allowed: row.allowed,
      remaining: row.remaining,
      retryAfterSeconds: row.retry_after_seconds,
      degraded: false,
    }
  } catch (err) {
    return storeFailure(policy, err instanceof Error ? err.message : 'erro desconhecido')
  }
}

export interface LayeredCheck {
  bucket: string
  policy: RateLimitPolicy
}

/**
 * Consome cotas de vários grupos de uma vez e retorna a decisão mais restritiva.
 *
 * Todas as camadas são consumidas, mesmo que uma anterior já negue a chamada.
 * Assim, um invasor que alterne endereços de e-mail ainda consome a cota por IP,
 * e quem alterne IPs ainda consome a cota por conta. Interromper na primeira
 * negativa permitiria que a camada mais barata protegesse a mais custosa.
 */
export async function consumeRateLimits(checks: LayeredCheck[]): Promise<RateLimitDecision> {
  if (checks.length === 0) {
    return { allowed: true, remaining: 0, retryAfterSeconds: 0, degraded: false }
  }
  const results = await Promise.all(checks.map((c) => consumeRateLimit(c.bucket, c.policy)))
  const denied = results.filter((r) => !r.allowed)
  if (denied.length === 0) {
    return {
      allowed: true,
      remaining: Math.min(...results.map((r) => r.remaining)),
      retryAfterSeconds: 0,
      degraded: results.some((r) => r.degraded),
    }
  }
  return {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: Math.max(...denied.map((r) => r.retryAfterSeconds)),
    degraded: denied.some((r) => r.degraded),
  }
}

// ---------------------------------------------------------------------------
// IP do cliente
// ---------------------------------------------------------------------------

/**
 * Cabeçalho de valor único que a camada de borda desta instalação sobrescreve,
 * ou null quando esse cabeçalho não existe e só podemos confiar em
 * `x-forwarded-for`.
 *
 * Só devemos ler um cabeçalho se algum componente à nossa frente o SUBSTITUIR em
 * toda requisição. `x-vercel-forwarded-for` atende a esse critério na Vercel e
 * em nenhum outro lugar: nenhum outro proxy o define; fora da Vercel, é apenas
 * um nome que o invasor pode escolher, e usá-lo daria a cada chamada um grupo
 * privado de limite. O mesmo vale para `x-real-ip`, que um proxy reverso pode
 * ou não sobrescrever. Por isso, seu uso exige configuração explícita em
 * BILLR_TRUSTED_IP_HEADER, em vez de ser confiável por padrão.
 */
function trustedIpHeader(): string | null {
  const configured = process.env.BILLR_TRUSTED_IP_HEADER?.trim().toLowerCase()
  if (configured) return configured
  if (process.env.VERCEL || process.env.VERCEL_ENV) return 'x-vercel-forwarded-for'
  return null
}

/**
 * Resolve o endereço IP de quem chama a partir dos cabeçalhos do proxy.
 *
 * A ordem importa, e a escolha mais óbvia está errada. `x-forwarded-for` é uma
 * lista à qual cada proxy ACRESCENTA valores; portanto, o PRIMEIRO item é o que
 * o cliente enviou, e qualquer pessoa pode defini-lo como quiser:
 *
 *     curl -H 'x-forwarded-for: 1.2.3.4' https://invoices.example.org/...
 *
 * Usar esse primeiro item como chave dá ao invasor uma cota nova para cada
 * cabeçalho falsificado - ou seja, elimina o limite. Isso acontecia antes com
 * `forwarded.split(',')[0]` nas rotas do Stripe.
 *
 * Portanto: primeiro use o cabeçalho da plataforma, se esta instalação tiver
 * um; depois, use o ÚLTIMO item de `x-forwarded-for`, que representa o salto
 * observado pelo proxy confiável mais próximo, e não algo declarado pelo
 * cliente. Se nenhum estiver disponível, a implantação retorna null e ipKey
 * coloca todas essas chamadas no MESMO grupo compartilhado: até uma enxurrada
 * sem IP identificável continua limitada, que é a opção segura.
 */
export function clientIpFrom(headers: Headers): string | null {
  const trusted = trustedIpHeader()
  if (trusted) {
    const fromDirect = normaliseIp(headers.get(trusted)?.split(',').pop())
    if (fromDirect) return fromDirect
  }

  const forwarded = headers.get('x-forwarded-for')
  if (!forwarded) return null
  // Último, nunca o primeiro. Veja acima.
  return normaliseIp(forwarded.split(',').pop())
}

function normaliseIp(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  // Somente caracteres válidos em um literal IPv4/IPv6 (mais um identificador
  // de zona), com tamanho limitado para impedir chaves de grupo ilimitadas.
  if (!trimmed || trimmed.length > 45 || !/^[0-9a-fA-F.:%]+$/.test(trimmed)) return null
  return trimmed.toLowerCase()
}

/**
 * Chave de grupo para um IP. Se não for possível resolver o IP, todas essas
 * chamadas compartilham um grupo em vez de serem liberadas; assim, até uma
 * enxurrada não identificável continua limitada. Na prática, a Vercel sempre
 * fornece um IP.
 */
export function ipKey(namespace: string, ip: string | null): string {
  return rateLimitKey(namespace, ip ?? 'unknown')
}

// ---------------------------------------------------------------------------
// Políticas
// ---------------------------------------------------------------------------

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/**
 * Todos os limites do produto em um só lugar, para que nenhum ponto de chamada
 * introduza silenciosamente um limite mais permissivo.
 */
export const RATE_LIMITS = {
  /** Por chave de API, para tráfego que não seja de MCP. */
  apiKey: { limit: 60, windowMs: MINUTE } as RateLimitPolicy,
  /** Por chave de API para MCP. Aplicado no próprio grupo do resolvedor, para cada requisição MCP contar exatamente uma vez. */
  mcp: { limit: 120, windowMs: MINUTE } as RateLimitPolicy,

  /** Por id público de fatura/orçamento, nos endpoints públicos de pagamento. */
  publicDocument: { limit: 10, windowMs: MINUTE } as RateLimitPolicy,
  /** Por IP, nos endpoints públicos de pagamento. Maior que o limite por documento, pois um escritório compartilha o mesmo IP. */
  publicDocumentIp: { limit: 30, windowMs: MINUTE } as RateLimitPolicy,

  /** Por endereço de e-mail, para todas as tentativas de entrar, cadastrar-se ou redefinir a senha. */
  authIdentifier: { limit: 10, windowMs: 15 * MINUTE } as RateLimitPolicy,
  /** Por IP, para todas as tentativas de autenticação. Limita ataques de tentativa de credenciais com identificadores alternados. */
  authIp: { limit: 30, windowMs: 15 * MINUTE } as RateLimitPolicy,
  /** Por endereço de e-mail, somente tentativas FALHAS. Ativa um bloqueio de uma hora para a conta. */
  authIdentifierLockout: { limit: 8, windowMs: HOUR } as RateLimitPolicy,
  /** Por IP, somente tentativas FALHAS. Ativa um bloqueio de uma hora para essa origem. */
  authIpLockout: { limit: 20, windowMs: HOUR } as RateLimitPolicy,

  /** Por IP, no envio de solicitação ao suporte. A RPC já limita por endereço de e-mail. */
  supportIp: { limit: 10, windowMs: HOUR } as RateLimitPolicy,

  /**
   * Por IP, para registro dinâmico de cliente OAuth. O registro é necessariamente
   * não autenticado (um agente que recebeu uma URL ainda não tem credenciais),
   * então este limite evita um número ilimitado de linhas. Vinte por hora é
   * muito mais do que qualquer cliente real precisa: basta um registro.
   */
  oauthRegisterIp: { limit: 20, windowMs: HOUR } as RateLimitPolicy,
  /**
   * Por IP, no endpoint de token OAuth. Abrange a troca do código e a renovação.
   * Uma conexão consome uma unidade, assim como cada renovação; portanto, sessenta
   * por minuto só bloqueia atividades de tentativa e erro.
   */
  oauthTokenIp: { limit: 60, windowMs: MINUTE } as RateLimitPolicy,
} as const
