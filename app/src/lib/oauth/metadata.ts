import { DOCS_URL, appOrigin, mcpUrl } from '@/lib/deployment'
import { OAUTH_SCOPES } from './scopes'

/**
 * Documentos de descoberta para a especificação de autorização MCP (2025-06-18).
 *
 * O recurso é https://<origin>/api/mcp, portanto aplica-se o formato de sufixo
 * de caminho da RFC 9728: https://<origin>/.well-known/oauth-protected-resource/api/mcp
 *
 * O servidor de autorização é a origem do app: o consentimento precisa da sessão
 * autenticada, e o cookie de sessão pertence à origem do app.
 */

const OAUTH_ENDPOINT_PATHS = {
  authorize: '/oauth/authorize',
  token: '/api/oauth/token',
  register: '/api/oauth/register',
  protectedResource: '/.well-known/oauth-protected-resource',
  authorizationServer: '/.well-known/oauth-authorization-server',
} as const

export interface ProtectedResourceMetadata {
  resource: string
  authorization_servers: string[]
  scopes_supported: string[]
  bearer_methods_supported: string[]
  resource_documentation?: string
}

export interface AuthorizationServerMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint: string
  response_types_supported: string[]
  response_modes_supported: string[]
  grant_types_supported: string[]
  token_endpoint_auth_methods_supported: string[]
  code_challenge_methods_supported: string[]
  scopes_supported: string[]
  authorization_response_iss_parameter_supported: boolean
  /** RFC 8707: o endpoint de token aceita e verifica `resource`. */
  resource_indicators_supported: boolean
  service_documentation?: string
}

export function protectedResourceMetadata(): ProtectedResourceMetadata {
  return {
    resource: mcpUrl(),
    authorization_servers: [appOrigin()],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ['header'],
    resource_documentation: DOCS_URL,
  }
}

export function authorizationServerMetadata(): AuthorizationServerMetadata {
  const origin = appOrigin()
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${OAUTH_ENDPOINT_PATHS.authorize}`,
    token_endpoint: `${origin}${OAUTH_ENDPOINT_PATHS.token}`,
    registration_endpoint: `${origin}${OAUTH_ENDPOINT_PATHS.register}`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    // Apenas clientes públicos. Não há como guardar um segredo em um agente de
    // desktop ou CLI, então o PKCE serve como prova.
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: [...OAUTH_SCOPES],
    authorization_response_iss_parameter_supported: true,
    resource_indicators_supported: true,
    service_documentation: DOCS_URL,
  }
}

/**
 * A parte do caminho do recurso MCP, sem barra final. "" quando o recurso
 * é apenas uma origem.
 */
export function mcpResourcePath(): string {
  const path = new URL(mcpUrl()).pathname.replace(/\/+$/, '')
  return path === '/' ? '' : path
}

/**
 * URL absoluta dos metadados do recurso protegido desta instalação, enviada em
 * WWW-Authenticate: o formato de sufixo de caminho da RFC 9728 na origem do app.
 */
export function protectedResourceMetadataUrl(): string {
  const resource = new URL(mcpUrl())
  const path = mcpResourcePath()
  return `${resource.origin}${OAUTH_ENDPOINT_PATHS.protectedResource}${path}`
}

/**
 * Retorna true quando `suffix` (os segmentos abrangidos após
 * /.well-known/oauth-protected-resource) aponta para o servidor MCP desta
 * instalação. Em caso de divergência, deve retornar 404 em vez de fornecer
 * metadados de um recurso que este servidor não protege.
 */
export function matchesResourceSuffix(segments: string[] | undefined): boolean {
  const requested = `/${(segments ?? []).join('/')}`.replace(/\/+$/, '')
  return (requested === '' ? '' : requested) === mcpResourcePath()
}

/** Auxiliar de resposta: documentos de descoberta são públicos, armazenáveis em cache e permitem CORS. */
export function metadataResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // Documentos públicos, sem segredos. Os clientes os buscam a cada conexão.
      'Cache-Control': 'public, max-age=300',
      // Clientes MCP executados no navegador leem estes documentos entre origens
      // antes de existir qualquer token; não há nada a proteger aqui.
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
  })
}
