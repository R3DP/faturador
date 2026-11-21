'use server'

import { appOrigin, mcpUrl } from '@/lib/deployment'
import { createClient } from '@/lib/supabase/server'
import {
  buildRedirect,
  isValidCodeChallenge,
  matchesRegisteredRedirect,
  resourceMatches,
} from '@/lib/oauth/params'
import { narrowPermissions } from '@/lib/oauth/scopes'
import { findClientByClientId, issueAuthorizationCode } from '@/lib/oauth/store'

/**
 * Decisões de consentimento.
 *
 * Estas são ações de servidor; a verificação de Origin/Host do Next protege contra CSRF, e a
 * pessoa que chama já precisa ter o cookie de sessão. Todo o restante recebido
 * aqui é uma entrada controlada por quem ataca, vinda de um campo do formulário; por isso, cada parâmetro é
 * validado novamente com o banco de dados, em vez de ser considerado confiável só porque a página
 * o exibiu: o cliente precisa existir, a URI de redirecionamento precisa ter sido
 * registrada por ele (correspondência exata), o desafio PKCE precisa ser um digest S256 válido
 * e a empresa precisa ser uma da qual esta pessoa faça parte.
 */

export interface ConsentRequest {
  clientId: string
  redirectUri: string
  codeChallenge: string
  state?: string
  resource?: string
  businessId: string
  permissions: string[]
}

export type ConsentResult = { redirect: string } | { error: string }

interface VerifiedRequest {
  clientRowId: string
  clientName: string
  redirectUri: string
  state?: string
}

async function verifyClient(
  clientId: string,
  redirectUri: string
): Promise<VerifiedRequest | { error: string }> {
  if (!clientId || !redirectUri) return { error: 'Esta solicitação de autorização está incompleta.' }
  const client = await findClientByClientId(clientId)
  if (!client) return { error: 'Este aplicativo não está registrado no Faturador.' }
  if (!matchesRegisteredRedirect(redirectUri, client.redirect_uris)) {
    return { error: 'Este aplicativo solicitou o envio para um endereço que não registrou.' }
  }
  return { clientRowId: client.id, clientName: client.client_name, redirectUri }
}

export async function approveAuthorizationAction(input: ConsentRequest): Promise<ConsentResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Sua sessão expirou. Entre novamente e tente conectar o aplicativo.' }

  const verified = await verifyClient(input.clientId, input.redirectUri)
  if ('error' in verified) return verified

  if (!isValidCodeChallenge(input.codeChallenge)) {
    return { error: 'Este aplicativo não enviou um desafio PKCE válido.' }
  }
  if (!resourceMatches(input.resource, mcpUrl())) {
    return { error: 'Este aplicativo solicitou acesso a outro serviço.' }
  }

  // A associação é verificada no próprio cliente da pessoa que chama; assim, quem decide é o RLS, não esta
  // função.
  const { data: member } = await supabase
    .from('business_members')
    .select('business_id')
    .eq('user_id', user.id)
    .eq('business_id', input.businessId)
    .maybeSingle()
  if (!member) return { error: 'Escolha uma empresa à qual você tenha acesso.' }

  const permissions = narrowPermissions(input.permissions)

  const code = await issueAuthorizationCode({
    clientRowId: verified.clientRowId,
    userId: user.id,
    businessId: input.businessId,
    redirectUri: verified.redirectUri,
    codeChallenge: input.codeChallenge,
    permissions,
    resource: input.resource?.trim() || null,
  })
  if (!code) return { error: 'Não foi possível concluir a conexão. Tente novamente.' }

  return {
    redirect: buildRedirect(verified.redirectUri, {
      code,
      state: input.state,
      // RFC 9207. Está anunciado nos metadados do servidor de autorização, portanto precisa
      // ser enviado.
      iss: appOrigin(),
    }),
  }
}

export async function denyAuthorizationAction(
  input: Pick<ConsentRequest, 'clientId' | 'redirectUri' | 'state'>
): Promise<ConsentResult> {
  const verified = await verifyClient(input.clientId, input.redirectUri)
  if ('error' in verified) return verified
  return {
    redirect: buildRedirect(verified.redirectUri, {
      error: 'access_denied',
      error_description: 'The account holder declined this request.',
      state: input.state,
      iss: appOrigin(),
    }),
  }
}
