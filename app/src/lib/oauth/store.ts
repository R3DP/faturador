// MÓDULO COM FUNÇÃO DE SERVIÇO. Ignora o RLS.
//
// Um dos poucos módulos autorizados a importar a função de serviço, junto de src/lib/api-keys/resolver.ts,
// /api/v1/me e src/lib/mcp/scoped-db.ts. Os endpoints OAuth não têm
// sessão por definição: /api/oauth/register e /api/oauth/token são
// chamados por um processo de agente que não iniciou sessão em nenhum serviço, e as linhas
// que acessam (oauth_clients, oauth_authorization_codes, oauth_refresh_tokens)
// contêm credenciais que o RLS deliberadamente não expõe a ninguém. Manter
// todas essas consultas neste módulo significa que o cliente de serviço tem
// apenas uma nova porta de entrada, que alcança somente as três tabelas OAuth e a
// linha api_keys criada por uma concessão de token. Qualquer ação de uma pessoa autenticada sobre suas
// conexões passa por ./connections.ts, usando o próprio cliente verificado pelo RLS.
// Não adicione outros pontos de chamada com função de serviço sem uma revisão que justifique o motivo.
import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { generateAccessToken } from '@/lib/api-keys/crypto'
import { generateClientId, generateSecret, hashSecret } from './params'
import type { OauthScope } from './scopes'

type ServiceClient = ReturnType<typeof createServiceClient>

let clientFactory: (() => ServiceClient) | null = null

/**
 * Ponto de substituição para testes, semelhante a src/lib/rate-limit.ts. Permite exercitar os fluxos de código/renovação/token
 * com um construtor de consultas falso em vez de um banco de dados. Em produção,
 * nunca é chamado.
 */
export function _setOauthServiceClient(factory: (() => ServiceClient) | null): void {
  clientFactory = factory
}

function svc(): ServiceClient {
  return clientFactory ? clientFactory() : createServiceClient()
}

const CODE_TTL_MS = 10 * 60_000
export const ACCESS_TOKEN_TTL_MS = 30 * 86_400_000
const REFRESH_TOKEN_TTL_MS = 90 * 86_400_000

const REFRESH_PREFIX = 'billr_rt_'

export interface OauthClientRecord {
  id: string
  client_id: string
  client_name: string
  redirect_uris: string[]
  created_at: string
}

interface AuthorizationCodeRecord {
  id: string
  oauth_client_id: string
  user_id: string
  business_id: string
  redirect_uri: string
  code_challenge: string
  permissions: string[]
  resource: string | null
  expires_at: string
}

export interface RefreshTokenRecord {
  id: string
  family_id: string
  oauth_client_id: string
  user_id: string
  business_id: string
  permissions: string[]
  api_key_id: string | null
  resource: string | null
  expires_at: string
  used_at: string | null
  revoked_at: string | null
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

export async function registerClient(input: {
  clientName: string
  redirectUris: string[]
}): Promise<OauthClientRecord | null> {
  const { data, error } = await svc()
    .from('oauth_clients')
    .insert({
      client_id: generateClientId(),
      client_name: input.clientName,
      redirect_uris: input.redirectUris,
    })
    .select('id, client_id, client_name, redirect_uris, created_at')
    .maybeSingle()
  if (error || !data) {
    console.error('oauth: registerClient falhou', error?.message)
    return null
  }
  return data as OauthClientRecord
}

export async function findClientByClientId(clientId: string): Promise<OauthClientRecord | null> {
  const { data, error } = await svc()
    .from('oauth_clients')
    .select('id, client_id, client_name, redirect_uris, created_at')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error || !data) return null
  return data as OauthClientRecord
}

// ---------------------------------------------------------------------------
// Códigos de autorização
// ---------------------------------------------------------------------------

export async function issueAuthorizationCode(input: {
  clientRowId: string
  userId: string
  businessId: string
  redirectUri: string
  codeChallenge: string
  permissions: readonly OauthScope[]
  resource: string | null
}): Promise<string | null> {
  const code = generateSecret(32)
  const { error } = await svc()
    .from('oauth_authorization_codes')
    .insert({
      code_hash: hashSecret(code),
      oauth_client_id: input.clientRowId,
      user_id: input.userId,
      business_id: input.businessId,
      redirect_uri: input.redirectUri,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
      permissions: [...input.permissions],
      resource: input.resource,
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    })
  if (error) {
    console.error('oauth: issueAuthorizationCode falhou', error.message)
    return null
  }
  return code
}

export type CodeLookup =
  | { status: 'ok'; record: AuthorizationCodeRecord }
  | { status: 'reused'; record: AuthorizationCodeRecord }
  | { status: 'unknown' }

const CODE_COLUMNS =
  'id, oauth_client_id, user_id, business_id, redirect_uri, code_challenge, permissions, resource, expires_at'

/**
 * Resgata um código exatamente uma vez.
 *
 * A reivindicação é um UPDATE ... WHERE used_at IS NULL, então duas tentativas simultâneas
 * de resgate são serializadas na linha e somente uma retorna com uma linha. Quando a
 * reivindicação não encontra nada, buscamos o código novamente: se ele existe, mas já foi
 * usado, é uma repetição, e quem chamou revoga tudo o que aquele código emitiu
 * (OAuth 2.1 seção 4.1.3), em vez de apenas recusar esta requisição.
 */
export async function consumeAuthorizationCode(code: string): Promise<CodeLookup> {
  const hash = hashSecret(code)
  const client = svc()
  const { data } = await client
    .from('oauth_authorization_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('code_hash', hash)
    .is('used_at', null)
    .select(CODE_COLUMNS)
    .maybeSingle()

  if (data) return { status: 'ok', record: data as AuthorizationCodeRecord }

  const { data: spent } = await client
    .from('oauth_authorization_codes')
    .select(CODE_COLUMNS)
    .eq('code_hash', hash)
    .maybeSingle()
  if (!spent) return { status: 'unknown' }
  return { status: 'reused', record: spent as AuthorizationCodeRecord }
}

/** Limpeza de melhor esforço; nunca bloqueia uma requisição de token. */
export function pruneExpiredCodes(): void {
  const cutoff = new Date(Date.now() - 86_400_000).toISOString()
  void svc()
    .from('oauth_authorization_codes')
    .delete()
    .lt('expires_at', cutoff)
    .then(
      () => {},
      () => {}
    )
}

// ---------------------------------------------------------------------------
// Tokens de acesso (linhas api_keys; resolveApiKey continua sendo a única barreira)
// ---------------------------------------------------------------------------

export async function issueAccessToken(input: {
  userId: string
  businessId: string
  permissions: readonly string[]
  clientRowId: string
  label: string
}): Promise<{ secret: string; keyId: string; expiresAt: string } | null> {
  const { secret, hash, prefix } = generateAccessToken()
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString()
  const { data, error } = await svc()
    .from('api_keys')
    .insert({
      user_id: input.userId,
      business_id: input.businessId,
      label: input.label,
      key_hash: hash,
      key_prefix: prefix,
      permissions: [...input.permissions],
      expires_at: expiresAt,
      kind: 'oauth',
      oauth_client_id: input.clientRowId,
    })
    .select('id')
    .maybeSingle()
  if (error || !data) {
    console.error('oauth: issueAccessToken falhou', error?.message)
    return null
  }
  return { secret, keyId: (data as { id: string }).id, expiresAt }
}

export async function revokeApiKeyById(keyId: string | null): Promise<void> {
  if (!keyId) return
  const { error } = await svc()
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .is('revoked_at', null)
  if (error) console.error('oauth: revokeApiKeyById falhou', error.message)
}

// ---------------------------------------------------------------------------
// Tokens de renovação
// ---------------------------------------------------------------------------

const REFRESH_COLUMNS =
  'id, family_id, oauth_client_id, user_id, business_id, permissions, api_key_id, resource, expires_at, used_at, revoked_at'

export async function issueRefreshToken(input: {
  familyId: string
  clientRowId: string
  userId: string
  businessId: string
  permissions: readonly string[]
  apiKeyId: string
  resource: string | null
}): Promise<string | null> {
  const token = `${REFRESH_PREFIX}${generateSecret(32)}`
  const { error } = await svc()
    .from('oauth_refresh_tokens')
    .insert({
      token_hash: hashSecret(token),
      family_id: input.familyId,
      oauth_client_id: input.clientRowId,
      user_id: input.userId,
      business_id: input.businessId,
      permissions: [...input.permissions],
      api_key_id: input.apiKeyId,
      resource: input.resource,
      expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString(),
    })
  if (error) {
    console.error('oauth: issueRefreshToken falhou', error.message)
    return null
  }
  return token
}

export async function findRefreshToken(token: string): Promise<RefreshTokenRecord | null> {
  const { data, error } = await svc()
    .from('oauth_refresh_tokens')
    .select(REFRESH_COLUMNS)
    .eq('token_hash', hashSecret(token))
    .maybeSingle()
  if (error || !data) return null
  return data as RefreshTokenRecord
}

/**
 * Reivindica um token de renovação para rotação. Usa o mesmo UPDATE de uso único do fluxo de código,
 * impedindo que dois clientes concorrentes com o mesmo token recebam um novo token.
 */
export async function claimRefreshToken(tokenId: string): Promise<boolean> {
  const { data } = await svc()
    .from('oauth_refresh_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', tokenId)
    .is('used_at', null)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle()
  return !!data
}

/**
 * Invalida toda uma família de rotação: cada token de renovação nela e cada
 * chave de acesso criada por esses tokens. É chamada quando um token de renovação já rotacionado ou um
 * código de autorização já usado é apresentado novamente, indicando que as credenciais vazaram
 * e que não podemos distinguir quem roubou do cliente legítimo.
 */
export async function revokeRefreshFamily(familyId: string): Promise<void> {
  const client = svc()
  const now = new Date().toISOString()
  const { data } = await client
    .from('oauth_refresh_tokens')
    .select('api_key_id')
    .eq('family_id', familyId)

  const keyIds = ((data ?? []) as { api_key_id: string | null }[])
    .map((row) => row.api_key_id)
    .filter((id): id is string => !!id)

  if (keyIds.length > 0) {
    const { error } = await client
      .from('api_keys')
      .update({ revoked_at: now })
      .in('id', keyIds)
      .is('revoked_at', null)
    if (error) console.error('oauth: revokeRefreshFamily keys falhou', error.message)
  }

  const { error } = await client
    .from('oauth_refresh_tokens')
    .update({ revoked_at: now })
    .eq('family_id', familyId)
    .is('revoked_at', null)
  if (error) console.error('oauth: revokeRefreshFamily tokens falhou', error.message)
}

/**
 * Invalida todas as famílias de rotação que possam criar uma substituta para uma
 * chave de acesso. É o que precisa acontecer quando alguém clica em Revogar na interface Agents: limpar
 * apenas `api_keys.revoked_at` interrompe o token atual, mas deixa o cliente
 * com um token de renovação, então a próxima rotação silenciosa lhe entregaria uma nova
 * chave válida por 30 dias e a conexão voltaria a funcionar sozinha.
 *
 * Ela é executada aqui, e não em ./connections.ts, porque oauth_refresh_tokens está
 * bloqueada pelo RLS e não tem políticas: nenhuma sessão de navegador pode lê-la ou alterá-la, então a
 * consulta precisa usar o cliente de serviço deste módulo. Quem chamou já comprovou
 * que a chave lhe pertence por meio do próprio UPDATE verificado pelo RLS.
 */
export async function revokeRefreshTokensForApiKey(keyId: string): Promise<void> {
  const { data, error } = await svc()
    .from('oauth_refresh_tokens')
    .select('family_id')
    .eq('api_key_id', keyId)
  if (error) {
    console.error('oauth: consulta revokeRefreshTokensForApiKey falhou', error.message)
    return
  }

  const families = [
    ...new Set(
      ((data ?? []) as { family_id: string | null }[])
        .map((row) => row.family_id)
        .filter((id): id is string => !!id)
    ),
  ]

  // Abrange a família toda, não apenas o token: tokens rotacionados compartilham a linhagem; caso contrário, um
  // token irmão emitido antes desta chave sobreviveria à revogação.
  for (const familyId of families) await revokeRefreshFamily(familyId)
}
