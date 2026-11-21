import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { revokeRefreshTokensForApiKey } from './store'

/**
 * Conexões que uma pessoa autorizou pela tela de consentimento OAuth.
 *
 * Elas usam o próprio cliente Supabase de quem chamou, não a função de serviço:
 * api_keys já tem RLS por proprietário, então o banco de dados
 * impõe "somente suas chaves" sem que este módulo precise ser confiável para adicionar o
 * filtro. A interface 1b Agents as exibe junto às chaves manuais.
 *
 * A listagem consulta UMA tabela. Antes, incluía `oauth_clients(client_name)`,
 * que nenhuma pessoa autenticada pode ler: o schema declara
 * `REVOKE ALL ON oauth_clients FROM PUBLIC, anon, authenticated`, e o PostgREST
 * exige SELECT na tabela incluída para a função que faz a CONSULTA.
 * Assim, toda requisição real falhava, o erro era ignorado e o painel de aplicativos
 * conectados mostrava o estado vazio, independentemente de quantos apps estivessem conectados. O nome
 * já está na linha que podemos ler: o endpoint de token grava
 * `label: client.client_name` ao criar a chave (src/lib/oauth/store.ts,
 * issueAccessToken). Conceder acesso a oauth_clients às funções de cliente para reativar a
 * junção daria a cada pessoa autenticada acesso a toda a tabela de registros, o que é
 * justamente o oposto do objetivo.
 *
 * A única parte que o RLS não pode resolver é a renovação: oauth_refresh_tokens
 * não tem políticas, então a revogação usa o cliente de serviço de ./store.ts para
 * essa etapa, depois que o próprio cliente da pessoa comprova que a chave é dela.
 */

export interface OauthConnection {
  id: string
  label: string
  businessId: string | null
  permissions: string[]
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  clientName: string | null
}

interface ConnectionRow {
  id: string
  label: string
  business_id: string | null
  permissions: string[]
  created_at: string
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
}

export async function listOauthConnections(userId: string): Promise<OauthConnection[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('api_keys')
    .select(
      'id, label, business_id, permissions, created_at, last_used_at, expires_at, revoked_at'
    )
    .eq('user_id', userId)
    .eq('kind', 'oauth')
    .order('created_at', { ascending: false })

  if (error || !data) {
    if (error) console.error('oauth: listOauthConnections falhou', error.message)
    return []
  }

  return (data as unknown as ConnectionRow[]).map((row) => ({
    id: row.id,
    label: row.label,
    businessId: row.business_id,
    permissions: row.permissions,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    // Nome do aplicativo que concedeu acesso, registrado na chave quando ela foi
    // criada. Não é uma junção: consulte o comentário do módulo.
    clientName: row.label,
  }))
}

/**
 * Revoga uma conexão, incluindo todos os tokens de renovação.
 *
 * O filtro `user_id` complementa o RLS, e o filtro `revoked_at IS NULL`
 * faz com que uma segunda revogação seja informada corretamente, sem alterar silenciosamente o
 * horário. A ordem importa: o UPDATE verificado pelo RLS é a checagem de autorização,
 * então a busca de tokens de renovação com a função de serviço só ocorre para uma chave que a pessoa acabou de
 * comprovar que possui. Sem essa busca, a revogação é apenas cosmética, pois o cliente
 * ainda mantém um token de renovação e a próxima rotação cria uma nova chave de acesso.
 */
export async function revokeOauthConnection(
  userId: string,
  keyId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('user_id', userId)
    .eq('kind', 'oauth')
    .is('revoked_at', null)
    .select('id')

  if (error) {
    console.error('oauth: revokeOauthConnection falhou', error.message)
    return { success: false, error: 'Não foi possível revogar esta conexão' }
  }
  if (!data?.length) return { success: false, error: 'Conexão não encontrada ou já revogada' }

  await revokeRefreshTokensForApiKey(keyId)
  return { success: true }
}
