/**
 * Os escopos OAuth são exatamente os nomes das permissões das chaves de API.
 *
 * Intencionalmente, não há um segundo vocabulário: um escopo concedido vira a
 * lista `permissions` na linha api_keys criada pelo endpoint de token, que é
 * o que src/lib/mcp/permissions.ts já verifica a cada chamada de ferramenta. Inventar
 * nomes de escopo exclusivos do OAuth exigiria manter duas listas sincronizadas, e uma delas
 * acabaria divergindo.
 */
export const OAUTH_SCOPES = ['read', 'write', 'send', 'delete', 'payments'] as const

export type OauthScope = (typeof OAUTH_SCOPES)[number]

/**
 * Concedidas por padrão, correspondendo ao perfil "Leitura e rascunhos (recomendado)" que o
 * painel de chaves de API oferece. Criar rascunhos sem consultar dados é inútil, então `read` é o
 * nível mínimo de toda concessão.
 */
export const DEFAULT_PERMISSIONS: readonly OauthScope[] = ['read', 'write']

/**
 * Caixas de seleção da tela de consentimento, na ordem em que são exibidas. Cada uma traz
 * a consequência resumida necessária para a decisão, redigida como no painel de
 * chaves de API, que descreve a mesma permissão ("criar rascunhos, enviar e registrar pagamentos",
 * "excluir trabalho não faturado").
 */
export interface ConsentChoice {
  permission: OauthScope
  label: string
  consequence: string
  /** Exibido, mas não pode ser desmarcado: leitura é o nível mínimo de qualquer concessão. */
  fixed?: boolean
}

export const CONSENT_CHOICES: readonly ConsentChoice[] = [
  {
    permission: 'read',
    label: 'Consultar os dados da sua empresa',
    consequence: 'Consulta clientes, faturas, orçamentos, horas, despesas e totais de receita.',
    fixed: true,
  },
  {
    permission: 'write',
    label: 'Criar rascunhos e editar',
    consequence: 'Cria e edita rascunhos, clientes, itens, horas e despesas. Nada é enviado.',
  },
  {
    permission: 'send',
    label: 'Enviar faturas e orçamentos',
    consequence: 'Envia faturas e orçamentos por e-mail aos seus clientes em seu nome.',
  },
  {
    permission: 'payments',
    label: 'Registrar pagamentos',
    consequence: 'Registra pagamentos nas faturas e as marca como pagas.',
  },
  {
    permission: 'delete',
    label: 'Excluir trabalho não faturado',
    consequence: 'Exclui permanentemente lançamentos de horas e despesas ainda não faturados.',
  },
]

/** Sempre exibida junto às opções; as ferramentas MCP fazem cumprir esta regra. */
export const CONSENT_FOOTNOTE =
  'A definição de preços e a aprovação de cobranças sempre exigem uma pessoa. O acesso expira em 30 dias, a menos que o agente o renove.'

function isOauthScope(value: string): value is OauthScope {
  return (OAUTH_SCOPES as readonly string[]).includes(value)
}

/** Interpreta o parâmetro `scope`, separado por espaços, descartando valores desconhecidos. */
export function parseScope(scope: string | null | undefined): OauthScope[] {
  if (!scope) return []
  const seen = new Set<OauthScope>()
  for (const token of scope.split(/\s+/)) {
    if (isOauthScope(token)) seen.add(token)
  }
  return OAUTH_SCOPES.filter((s) => seen.has(s))
}

/**
 * Seleção inicial da tela de consentimento.
 *
 * Sem escopos solicitados, usa o perfil recomendado. Quando a requisição pede mais permissões,
 * essas opções são pré-selecionadas; a pessoa ainda pode desmarcá-las, que é justamente
 * o objetivo de exibi-las. `read` é obrigatório porque qualquer outra permissão implica
 * consultar os dados sobre os quais atua.
 */
export function requestedPermissions(scope: string | null | undefined): OauthScope[] {
  const asked = parseScope(scope)
  if (asked.length === 0) return [...DEFAULT_PERMISSIONS]
  const withRead = new Set<OauthScope>([...asked, 'read'])
  return OAUTH_SCOPES.filter((s) => withRead.has(s))
}

/**
 * Normaliza o que foi solicitado no formulário de consentimento (ou em uma renovação) para
 * uma concessão que podemos armazenar: apenas escopos conhecidos, sempre com `read`,
 * nunca mais ampla que `allowed` quando houver um limite.
 */
export function narrowPermissions(
  requested: readonly string[],
  allowed?: readonly string[]
): OauthScope[] {
  const ceiling = allowed ? new Set(allowed) : null
  const granted = new Set<OauthScope>()
  for (const value of requested) {
    if (!isOauthScope(value)) continue
    if (ceiling && !ceiling.has(value)) continue
    granted.add(value)
  }
  if (!ceiling || ceiling.has('read')) granted.add('read')
  return OAUTH_SCOPES.filter((s) => granted.has(s))
}

/** Retorna true quando todos os escopos solicitados estão entre os concedidos. */
export function isSubsetOf(requested: readonly string[], granted: readonly string[]): boolean {
  return requested.every((value) => granted.includes(value))
}

export function formatScope(permissions: readonly string[]): string {
  return permissions.join(' ')
}
