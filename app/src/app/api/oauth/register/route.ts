import {
  RATE_LIMITS,
  clientIpFrom,
  consumeRateLimit,
  ipKey,
} from '@/lib/rate-limit'
import { normaliseClientName, validateRedirectUris } from '@/lib/oauth/params'
import { OAUTH_SCOPES } from '@/lib/oauth/scopes'
import { registerClient } from '@/lib/oauth/store'

/**
 * Registro dinâmico de cliente da RFC 7591.
 *
 * O registro aberto é a única forma de um agente que recebeu apenas uma URL
 * se tornar cliente; por isso, ele não exige autenticação. O que o mantém
 * seguro é:
 *
 *   - Somente clientes públicos. Nenhum segredo é emitido, então o registro não vale
 *     nada por si só: ainda precisa passar pela tela de consentimento, que
 *     mostra o nome do cliente à pessoa antes de conceder qualquer acesso.
 *   - As URIs de redirecionamento são limitadas a https:// ou http:// de loopback e verificadas
 *     com correspondência exata na autorização, impedindo que o registro seja usado para redirecionar.
 *   - Limite de frequência por IP, bloqueio em caso de falha e o mesmo limitador persistente usado por todos os outros
 *     endpoints.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function error(status: number, code: string, description: string): Response {
  return new Response(JSON.stringify({ error: code, error_description: description }), {
    status,
    headers: NO_STORE,
  })
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: NO_STORE })
}

export async function POST(req: Request): Promise<Response> {
  const decision = await consumeRateLimit(
    ipKey('oauth:register:ip', clientIpFrom(req.headers)),
    RATE_LIMITS.oauthRegisterIp
  )
  if (!decision.allowed) {
    return new Response(
      JSON.stringify({
        error: 'temporarily_unavailable',
        error_description: 'Muitos registros deste endereço. Tente novamente mais tarde.',
      }),
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(decision.retryAfterSeconds) } }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return error(400, 'invalid_client_metadata', 'O corpo deve estar em formato JSON.')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return error(400, 'invalid_client_metadata', 'O corpo deve ser um objeto JSON.')
  }

  const input = body as Record<string, unknown>

  const redirects = validateRedirectUris(input.redirect_uris)
  if (!redirects.ok) {
    return error(400, 'invalid_redirect_uri', redirects.reason ?? 'redirect_uris inválidas.')
  }

  // Somente clientes públicos: não há onde guardar um segredo em uma CLI ou agente desktop, e
  // a prova de segurança usada é o PKCE.
  const authMethod = input.token_endpoint_auth_method
  if (authMethod !== undefined && authMethod !== 'none') {
    return error(
      400,
      'invalid_client_metadata',
      'Somente clientes públicos são compatíveis; token_endpoint_auth_method deve ser "none".'
    )
  }

  const grantTypes = input.grant_types
  if (grantTypes !== undefined) {
    if (
      !Array.isArray(grantTypes) ||
      !grantTypes.every((g) => g === 'authorization_code' || g === 'refresh_token')
    ) {
      return error(
        400,
        'invalid_client_metadata',
        'grant_types deve ser um subconjunto de ["authorization_code","refresh_token"].'
      )
    }
  }

  const responseTypes = input.response_types
  if (responseTypes !== undefined) {
    if (!Array.isArray(responseTypes) || !responseTypes.every((r) => r === 'code')) {
      return error(400, 'invalid_client_metadata', 'Somente o tipo de resposta "code" é compatível.')
    }
  }

  const clientName = normaliseClientName(input.client_name)
  const client = await registerClient({ clientName, redirectUris: redirects.uris })
  if (!client) {
    return error(500, 'invalid_client_metadata', 'Não foi possível registrar este cliente.')
  }

  return new Response(
    JSON.stringify({
      client_id: client.client_id,
      client_id_issued_at: Math.floor(Date.parse(client.created_at) / 1000),
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: OAUTH_SCOPES.join(' '),
    }),
    { status: 201, headers: NO_STORE }
  )
}
