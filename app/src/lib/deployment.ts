/** Configurações públicas da instalação. Nunca coloque credenciais neste módulo. */
export function appOrigin(): string {
  const value = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const url = new URL(value)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'NEXT_PUBLIC_APP_URL deve ser uma origem HTTP(S), sem caminho nem credenciais',
    )
  }
  return url.origin
}

/** Endpoint MCP ao qual os agentes se conectam nesta instalação. */
export function mcpUrl(): string {
  return `${appOrigin()}/api/mcp`
}

/** Documentação pública usada pelos links de ajuda no aplicativo. */
export const DOCS_URL = 'https://github.com/R3DP/faturador/tree/pt-br/docs'

/** Guia passo a passo de conexão de agentes para cada cliente. */
export const AGENT_DOCS_URL =
  'https://github.com/R3DP/faturador/blob/pt-br/plugins/README.md#instalações-auto-hospedadas'
