import { mcpUrl } from '@/lib/deployment'
import {
  RATE_LIMITS,
  clientIpFrom,
  consumeRateLimit,
  ipKey,
} from '@/lib/rate-limit'
import { resourceMatches, verifyPkce } from '@/lib/oauth/params'
import { formatScope, isSubsetOf, narrowPermissions, parseScope } from '@/lib/oauth/scopes'
import {
  ACCESS_TOKEN_TTL_MS,
  claimRefreshToken,
  consumeAuthorizationCode,
  findClientByClientId,
  findRefreshToken,
  issueAccessToken,
  issueRefreshToken,
  pruneExpiredCodes,
  revokeApiKeyById,
  revokeRefreshFamily,
} from '@/lib/oauth/store'

/**
 * Endpoint de token OAuth 2.1: clientes públicos, prova PKCE e tokens de atualização rotativos.
 *
 * O token de acesso retornado corresponde a uma linha real de api_keys (kind oauth), o que
 * é essencial: resolveApiKey continua sendo a única barreira diante da interface MCP
 * e nenhum componente posterior precisa conhecer o conceito de token OAuth.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE: Record<string, string> = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/**
 * Seção 5.2 da RFC 6749. A resposta é propositalmente breve e igual para qualquer motivo pelo qual
 * uma concessão falhe: informar "qual das três coisas você errou" é justamente o que um
 * atacante que testa material roubado gostaria de saber.
 */
function oauthError(code: string, description: string, status = 400): Response {
  return new Response(JSON.stringify({ error: code, error_description: description }), {
    status,
    headers: NO_STORE,
  })
}

async function readForm(req: Request): Promise<Record<string, string>> {
  const contentType = req.headers.get('content-type') ?? ''
  const out: Record<string, string> = {}
  if (contentType.includes('application/json')) {
    try {
      const body = (await req.json()) as Record<string, unknown>
      for (const [key, value] of Object.entries(body ?? {})) {
        if (typeof value === 'string') out[key] = value
      }
    } catch {
      return out
    }
    return out
  }
  // application/x-www-form-urlencoded é o formato exigido pela RFC 6749 e enviado por todo
  // cliente MCP.
  const text = await req.text()
  for (const [key, value] of new URLSearchParams(text)) out[key] = value
  return out
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: NO_STORE })
}

export async function POST(req: Request): Promise<Response> {
  const decision = await consumeRateLimit(
    ipKey('oauth:token:ip', clientIpFrom(req.headers)),
    RATE_LIMITS.oauthTokenIp
  )
  if (!decision.allowed) {
    return new Response(
      JSON.stringify({
        error: 'temporarily_unavailable',
        error_description: 'Muitas solicitações de token deste endereço. Tente novamente em instantes.',
      }),
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(decision.retryAfterSeconds) } }
    )
  }

  const form = await readForm(req)
  const grantType = form.grant_type

  if (grantType === 'authorization_code') return exchangeCode(form)
  if (grantType === 'refresh_token') return refresh(form)
  if (!grantType) return oauthError('invalid_request', 'O parâmetro grant_type é obrigatório.')
  return oauthError('unsupported_grant_type', `grant_type incompatível: "${grantType}"`)
}

function tokenResponse(input: {
  accessToken: string
  refreshToken: string
  permissions: readonly string[]
}): Response {
  return new Response(
    JSON.stringify({
      access_token: input.accessToken,
      token_type: 'Bearer',
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: input.refreshToken,
      scope: formatScope(input.permissions),
    }),
    { status: 200, headers: NO_STORE }
  )
}

async function exchangeCode(form: Record<string, string>): Promise<Response> {
  const { code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier } = form

  if (!code || !clientId || !redirectUri) {
    return oauthError('invalid_request', 'Os parâmetros code, client_id e redirect_uri são obrigatórios.')
  }
  if (!verifier) return oauthError('invalid_request', 'O parâmetro code_verifier é obrigatório.')

  const client = await findClientByClientId(clientId)
  if (!client) return oauthError('invalid_client', 'Cliente desconhecido.', 401)

  const lookup = await consumeAuthorizationCode(code)
  if (lookup.status === 'unknown') {
    return oauthError('invalid_grant', 'Código de autorização inválido ou expirado.')
  }
  if (lookup.status === 'reused') {
    // Uma segunda troca indica que o código vazou. Tudo o que ele emitiu será revogado
    // junto: o ID da família É o ID da linha do código, então uma única chamada cobre todos os
    // tokens emitidos por esta autorização.
    await revokeRefreshFamily(lookup.record.id)
    return oauthError('invalid_grant', 'Código de autorização inválido ou expirado.')
  }

  const record = lookup.record
  if (Date.parse(record.expires_at) <= Date.now()) {
    return oauthError('invalid_grant', 'Código de autorização inválido ou expirado.')
  }
  if (record.oauth_client_id !== client.id) {
    return oauthError('invalid_grant', 'Código de autorização inválido ou expirado.')
  }
  if (record.redirect_uri !== redirectUri) {
    return oauthError('invalid_grant', 'redirect_uri não corresponde à solicitação de autorização.')
  }
  if (!verifyPkce(verifier, record.code_challenge)) {
    return oauthError('invalid_grant', 'Falha na verificação do PKCE.')
  }
  if (!resourceMatches(form.resource, mcpUrl())) {
    return oauthError('invalid_target', 'Recurso desconhecido.')
  }

  const permissions = narrowPermissions(record.permissions)
  const access = await issueAccessToken({
    userId: record.user_id,
    businessId: record.business_id,
    permissions,
    clientRowId: client.id,
    label: client.client_name,
  })
  if (!access) return oauthError('temporarily_unavailable', 'Não foi possível emitir um token.', 503)

  const refreshToken = await issueRefreshToken({
    // O ID da linha do código de autorização também é o ID da família de rotação; assim, um código
    // reutilizado e um token de atualização reutilizado revogam exatamente o mesmo conjunto.
    familyId: record.id,
    clientRowId: client.id,
    userId: record.user_id,
    businessId: record.business_id,
    permissions,
    apiKeyId: access.keyId,
    resource: record.resource,
  })
  if (!refreshToken) {
    await revokeApiKeyById(access.keyId)
    return oauthError('temporarily_unavailable', 'Não foi possível emitir um token.', 503)
  }

  pruneExpiredCodes()
  return tokenResponse({ accessToken: access.secret, refreshToken, permissions })
}

async function refresh(form: Record<string, string>): Promise<Response> {
  const { refresh_token: presented, client_id: clientId } = form
  if (!presented || !clientId) {
    return oauthError('invalid_request', 'Os parâmetros refresh_token e client_id são obrigatórios.')
  }

  const client = await findClientByClientId(clientId)
  if (!client) return oauthError('invalid_client', 'Cliente desconhecido.', 401)

  const record = await findRefreshToken(presented)
  if (!record) return oauthError('invalid_grant', 'Token de atualização inválido ou expirado.')

  if (record.used_at || record.revoked_at) {
    // Reutilização de um token rotacionado: o cliente guardou uma cópia que deveria ter descartado
    // ou outra pessoa teve acesso a ela. Não é possível saber qual dos casos ocorreu, então toda a
    // família é revogada e o cliente legítimo precisa solicitar novamente o consentimento do usuário.
    await revokeRefreshFamily(record.family_id)
    return oauthError('invalid_grant', 'Token de atualização inválido ou expirado.')
  }
  if (record.oauth_client_id !== client.id) {
    return oauthError('invalid_grant', 'Token de atualização inválido ou expirado.')
  }
  if (Date.parse(record.expires_at) <= Date.now()) {
    return oauthError('invalid_grant', 'Token de atualização inválido ou expirado.')
  }
  if (!resourceMatches(form.resource, mcpUrl())) {
    return oauthError('invalid_target', 'Recurso desconhecido.')
  }

  // Uma atualização pode restringir a concessão, mas nunca ampliá-la.
  let permissions = narrowPermissions(record.permissions)
  if (form.scope) {
    const asked = parseScope(form.scope)
    if (asked.length === 0 || !isSubsetOf(asked, permissions)) {
      return oauthError('invalid_scope', 'O escopo solicitado excede a concessão original.')
    }
    permissions = narrowPermissions(asked, record.permissions)
  }

  if (!(await claimRefreshToken(record.id))) {
    // Perdeu a corrida para uma rotação concorrente do mesmo token; trate como
    // reutilização.
    await revokeRefreshFamily(record.family_id)
    return oauthError('invalid_grant', 'Token de atualização inválido ou expirado.')
  }

  const access = await issueAccessToken({
    userId: record.user_id,
    businessId: record.business_id,
    permissions,
    clientRowId: client.id,
    label: client.client_name,
  })
  if (!access) return oauthError('temporarily_unavailable', 'Não foi possível emitir um token.', 503)

  const next = await issueRefreshToken({
    familyId: record.family_id,
    clientRowId: client.id,
    userId: record.user_id,
    businessId: record.business_id,
    permissions,
    apiKeyId: access.keyId,
    resource: record.resource,
  })
  if (!next) {
    await revokeApiKeyById(access.keyId)
    return oauthError('temporarily_unavailable', 'Não foi possível emitir um token.', 503)
  }

  // A chave de acesso substituída deixa de funcionar assim que a nova existe,
  // para que um token rotacionado não continue chamando ferramentas por mais 30 dias.
  await revokeApiKeyById(record.api_key_id)

  return tokenResponse({ accessToken: access.secret, refreshToken: next, permissions })
}
