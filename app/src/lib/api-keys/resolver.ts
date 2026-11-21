import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { hashApiKey, isValidKeyFormat } from './crypto'
import { RATE_LIMITS, consumeRateLimit, rateLimitKey, type RateLimitPolicy } from '@/lib/rate-limit'

export interface ResolvedKey {
  userId: string
  keyId: string
  businessIds: string[]
  permissions: string[]
}

export interface ResolveApiKeyOptions {
  /**
   * Substitui a política de limite de taxa por chave para este ponto de chamada.
   * O padrão é RATE_LIMITS.apiKey (60 solicitações / 60s). O servidor MCP usa
   * um limite maior (RATE_LIMITS.mcp, 120/60s) em vez de manter um segundo
   * contador próprio, para que cada solicitação seja contabilizada uma única vez.
   */
  rateLimit?: RateLimitPolicy
}

export async function resolveApiKey(
  secret: string,
  opts?: ResolveApiKeyOptions
): Promise<ResolvedKey | { error: 'invalid' | 'rate_limited' }> {
  if (!isValidKeyFormat(secret)) return { error: 'invalid' }

  const hash = hashApiKey(secret)
  // Persistente e compartilhado entre instâncias. Falha de forma restritiva:
  // se o armazenamento do contador estiver inacessível, a chave é tratada como
  // limitada por taxa, em vez de liberada, pois esta é a única barreira diante
  // da interface MCP.
  const decision = await consumeRateLimit(rateLimitKey('apikey', hash), opts?.rateLimit ?? RATE_LIMITS.apiKey)
  if (!decision.allowed) return { error: 'rate_limited' }

  const supabase = createServiceClient()
  const { data: key } = await supabase
    .from('api_keys')
    .select('id, user_id, business_id, revoked_at, expires_at, permissions')
    .eq('key_hash', hash)
    .maybeSingle()

  if (!key || key.revoked_at || (key.expires_at && Date.parse(key.expires_at) <= Date.now())) return { error: 'invalid' }

  let businessIds: string[]
  if (key.business_id) {
    const { data: member } = await supabase
      .from('business_members')
      .select('business_id')
      .eq('user_id', key.user_id)
      .eq('business_id', key.business_id)
      .maybeSingle()
    if (!member) return { error: 'invalid' }
    businessIds = [key.business_id]
  } else {
    const { data: memberships } = await supabase
      .from('business_members')
      .select('business_id')
      .eq('user_id', key.user_id)
    businessIds = (memberships ?? []).map((m) => m.business_id)
  }

  // Registro de uso de melhor esforço; nunca bloqueie a solicitação por causa dele
  void supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', key.id)
    .then(() => {}, () => {})

  return { userId: key.user_id, keyId: key.id, businessIds, permissions: key.permissions }
}
