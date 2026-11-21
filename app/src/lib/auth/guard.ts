import 'server-only'
import { headers } from 'next/headers'
import {
  RATE_LIMITS,
  clientIpFrom,
  consumeRateLimit,
  consumeRateLimits,
  ipKey,
  peekRateLimit,
  rateLimitKey,
} from '@/lib/rate-limit'

/**
 * Limite de tentativas e bloqueio contra abuso nos endpoints de autenticação.
 *
 * As operações de entrada, cadastro e redefinição de senha eram executadas
 * diretamente do navegador contra o Supabase Auth, sem passar por um servidor
 * nosso e sem nada que pudesse limitar. Agora passam primeiro pelas ações de
 * servidor em ./actions.ts, que chamam este módulo.
 *
 * Quatro limites, organizados em camadas:
 *
 *   tentativas por e-mail    impede testar uma conta usando uma lista de palavras
 *   tentativas por IP        impede uma origem de atacar várias contas; trocar
 *                            o endereço de e-mail não renova o limite
 *   falhas por e-mail        bloqueio de uma hora para uma conta sob ataque
 *   falhas por IP            bloqueio de uma hora para uma origem que insiste
 *
 * Os limites de tentativas são consumidos em cada solicitação. Os limites de
 * falhas só são consumidos quando as credenciais estão realmente erradas e são
 * consultados com peek (que não incrementa) antes da tentativa. Assim, verificar
 * um bloqueio nunca o prolonga, e entradas bem-sucedidas de uma pessoa legítima
 * nunca a aproximam de um bloqueio.
 *
 * Em caso de falha, todas as operações recusam o acesso: por padrão, o limitador
 * nega solicitações quando o Postgres está inacessível, e estes pontos de chamada
 * mantêm esse comportamento.
 */

interface AuthGuardBlock {
  blocked: true
  /** Mensagem segura para exibição. É igual para todos os motivos, para impedir sondagens. */
  message: string
  retryAfterSeconds: number
}

interface AuthGuardPass {
  blocked: false
  ip: string | null
}

export type AuthGuardResult = AuthGuardBlock | AuthGuardPass

const BLOCKED_MESSAGE =
  'Muitas tentativas. Aguarde alguns minutos e tente novamente.'

const LOCKED_MESSAGE =
  'Muitas tentativas malsucedidas. O acesso por aqui foi pausado por até uma hora. Tente novamente mais tarde ou redefina sua senha.'

function normaliseIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase()
}

async function clientIp(): Promise<string | null> {
  return clientIpFrom(await headers())
}

/**
 * Executa antes de uma tentativa de autenticação. Retorna um bloqueio que quem
 * chama deve repassar literalmente à pessoa, ou uma autorização com o IP
 * resolvido para que possa fornecê-lo a recordAuthFailure sem resolvê-lo de novo.
 */
export async function guardAuthAttempt(
  action: 'signin' | 'signup' | 'reset',
  identifier: string
): Promise<AuthGuardResult> {
  const ip = await clientIp()
  const id = normaliseIdentifier(identifier)

  // Primeiro, verifica os bloqueios ativos sem gravar dados, para que um invasor
  // bloqueado não possa prolongar o próprio bloqueio indefinidamente e a consulta
  // não tenha custo de gravação.
  const [idLock, ipLock] = await Promise.all([
    peekRateLimit(rateLimitKey('authfail:id', id), RATE_LIMITS.authIdentifierLockout),
    peekRateLimit(ipKey('authfail:ip', ip), RATE_LIMITS.authIpLockout),
  ])

  if (!idLock.allowed || !ipLock.allowed) {
    return {
      blocked: true,
      message: LOCKED_MESSAGE,
      retryAfterSeconds: Math.max(idLock.retryAfterSeconds, ipLock.retryAfterSeconds),
    }
  }

  // Depois, consome o limite de tentativas. As duas camadas são consumidas,
  // mesmo que uma delas negue a solicitação.
  const attempt = await consumeRateLimits([
    { bucket: rateLimitKey(`auth:${action}:id`, id), policy: RATE_LIMITS.authIdentifier },
    { bucket: ipKey('auth:ip', ip), policy: RATE_LIMITS.authIp },
  ])

  if (!attempt.allowed) {
    return {
      blocked: true,
      message: BLOCKED_MESSAGE,
      retryAfterSeconds: attempt.retryAfterSeconds,
    }
  }

  return { blocked: false, ip }
}

/**
 * Registra uma tentativa malsucedida nos dois limites de bloqueio. Chame esta
 * função somente quando as credenciais forem rejeitadas, nunca quando a chamada
 * apresentar outro erro; caso contrário, uma indisponibilidade poderia bloquear
 * toda a base de usuários.
 */
export async function recordAuthFailure(identifier: string, ip: string | null): Promise<void> {
  const id = normaliseIdentifier(identifier)
  await Promise.all([
    consumeRateLimit(rateLimitKey('authfail:id', id), RATE_LIMITS.authIdentifierLockout),
    consumeRateLimit(ipKey('authfail:ip', ip), RATE_LIMITS.authIpLockout),
  ])
}
