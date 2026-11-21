'use server'

import { KEY_PROFILES, type KeyProfile } from '@/lib/mcp/permissions'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { generateApiKey } from '@/lib/api-keys/crypto'
import {
  listOauthConnections,
  revokeOauthConnection,
  type OauthConnection,
} from '@/lib/oauth/connections'

export async function createApiKeyAction(
  label: string,
  businessId: string | null,
  profile: KeyProfile = 'draft'
): Promise<{ secret: string } | { error: string }> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { error: 'Sessão não iniciada' }
  if (!Object.hasOwn(KEY_PROFILES, profile)) return { error: 'Perfil de permissões inválido' }
  if (label.length > 200) return { error: 'O rótulo é longo demais' }
  if (!label.trim()) return { error: 'O rótulo é obrigatório' }

  // Valida o acesso à empresa antes de inserir
  if (businessId) {
    const { data: member } = await supabase
      .from('business_members')
      .select('business_id')
      .eq('user_id', auth.user.id)
      .eq('business_id', businessId)
      .maybeSingle()
    if (!member) return { error: 'Você não tem acesso a essa empresa' }
  }

  const { secret, hash, prefix } = generateApiKey()
  const { error } = await supabase.from('api_keys').insert({
    user_id: auth.user.id,
    permissions: [...KEY_PROFILES[profile]],
    expires_at: new Date(Date.now()+90*86400000).toISOString(),
    business_id: businessId,
    label: label.trim(),
    key_hash: hash,
    key_prefix: prefix,
  })
  if (error) {
    console.error('createApiKeyAction:', error)
    return { error: 'Não foi possível criar a chave' }
  }

  revalidatePath('/agents')
  return { secret } // exibido uma única vez; somente o hash é armazenado
}

export async function revokeApiKeyAction(
  keyId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { success: false, error: 'Sessão não iniciada' }

  const { data, error } = await supabase
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('user_id', auth.user.id)
    .is('revoked_at', null)
    .select('id')
  if (error) {
    console.error('revokeApiKeyAction:', error)
    return { success: false, error: 'Não foi possível revogar a chave' }
  }
  if (!data?.length) return { success: false, error: 'Chave não encontrada ou já revogada' }
  revalidatePath('/agents')
  return { success: true }
}

// Somente chaves manuais. Tokens de acesso OAuth também são linhas em api_keys (kind='oauth'),
// e sem este filtro toda conexão MCP aprovada apareceria na lista de chaves
// criadas manualmente com um botão Revogar que manteria ativo o token de atualização.
// Elas têm uma lista própria por meio de listOauthConnectionsAction.
export async function listApiKeysAction() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('api_keys')
    .select('id, label, business_id, key_prefix, last_used_at, created_at, revoked_at, permissions, expires_at')
    .eq('kind', 'manual')
    .order('created_at', { ascending: false })
  return data ?? []
}

export async function listOauthConnectionsAction(): Promise<OauthConnection[]> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return []
  return listOauthConnections(auth.user.id)
}

export async function revokeOauthConnectionAction(
  keyId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { success: false, error: 'Sessão não iniciada' }

  const result = await revokeOauthConnection(auth.user.id, keyId)
  if (result.success) revalidatePath('/agents')
  return result
}
