import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { appOrigin, mcpUrl } from '@/lib/deployment'
import { safeAuthRedirect } from '@/lib/auth/redirect'
import { createClient } from '@/lib/supabase/server'
import {
  buildRedirect,
  isValidCodeChallenge,
  matchesRegisteredRedirect,
  resourceMatches,
} from '@/lib/oauth/params'
import { requestedPermissions } from '@/lib/oauth/scopes'
import { findClientByClientId } from '@/lib/oauth/store'
import { ConsentForm } from './consent-form'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Autorizar acesso',
  robots: { index: false, follow: false },
}

type SearchParams = Record<string, string | string[] | undefined>

function first(params: SearchParams, key: string): string {
  const value = params[key]
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

/** Reconstrói a URL desta requisição para que o login possa retornar a ela sem alterações. */
function currentPath(params: SearchParams): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') query.set(key, value)
    else if (Array.isArray(value) && value[0] != null) query.set(key, value[0])
  }
  const search = query.toString()
  return search ? `/oauth/authorize?${search}` : '/oauth/authorize'
}

function Problem({ title, detail }: { title: string; detail: string }) {
  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight text-foreground">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{detail}</p>
      <p className="mt-6 text-sm">
        <Link href="/agents" className="font-medium text-primary hover:underline">
          Acessar as configurações de agentes do Faturador
        </Link>
      </p>
    </div>
  )
}

/**
 * Endpoint de autorização OAuth 2.1 (tela de consentimento).
 *
 * A ordem é importante. O cliente e sua URI de redirecionamento são verificados PRIMEIRO,
 * com base no registro; se houver falha, ela é exibida nesta página em vez de
 * redirecionar. Enviar um erro para um endereço que o cliente nunca registrou é
 * o que transforma um endpoint de autorização em um redirecionamento aberto. Só depois que a
 * URI de redirecionamento é considerada confiável os erros de protocolo voltam para o
 * cliente, conforme exige a RFC 6749.
 */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const clientId = first(params, 'client_id')
  const redirectUri = first(params, 'redirect_uri')
  const state = first(params, 'state')
  const resource = first(params, 'resource')

  if (!clientId || !redirectUri) {
    return (
      <Problem
        title="Solicitação incompleta"
        detail="Esta solicitação de conexão não informa o identificador do aplicativo ou o endereço de retorno, então o Faturador não consegue identificar quem está solicitando. Inicie a conexão novamente pelo aplicativo."
      />
    )
  }

  const client = await findClientByClientId(clientId)
  if (!client) {
    return (
      <Problem
        title="Aplicativo desconhecido"
        detail="Não há nenhum aplicativo registrado no Faturador com esse identificador de cliente. Inicie a conexão novamente pelo aplicativo, que fará o próprio registro."
      />
    )
  }
  if (!matchesRegisteredRedirect(redirectUri, client.redirect_uris)) {
    return (
      <Problem
        title="O endereço de retorno não corresponde"
        detail="Este aplicativo solicitou o redirecionamento para um endereço que nunca registrou. Esse é exatamente o padrão de um ataque com código roubado, então o Faturador interrompeu o processo."
      />
    )
  }

  // A partir daqui, a URI de redirecionamento é confiável, então os erros do protocolo voltam para
  // o cliente, em vez de terminarem numa página que ninguém está acompanhando.
  const fail = (error: string, description: string) =>
    redirect(
      buildRedirect(redirectUri, {
        error,
        error_description: description,
        state,
        iss: appOrigin(),
      })
    )

  if (first(params, 'response_type') !== 'code') {
    fail('unsupported_response_type', 'Only the authorization code flow is supported')
  }
  const codeChallenge = first(params, 'code_challenge')
  const method = first(params, 'code_challenge_method')
  if (!codeChallenge || !isValidCodeChallenge(codeChallenge)) {
    fail('invalid_request', 'A base64url S256 code_challenge is required')
  }
  if (method !== 'S256') {
    fail('invalid_request', 'code_challenge_method must be S256')
  }
  if (!resourceMatches(resource, mcpUrl())) {
    fail('invalid_target', 'Unknown resource')
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const returnTo = safeAuthRedirect(currentPath(params))
  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent(returnTo)}`)
  }

  const { data: memberships } = await supabase
    .from('business_members')
    .select('business_id')
    .eq('user_id', user.id)

  const businessIds = (memberships ?? []).map((row) => row.business_id)
  const { data: businesses } = businessIds.length
    ? await supabase
        .from('businesses')
        .select('id, name')
        .in('id', businessIds)
        .eq('is_active', true)
        .order('name')
    : { data: [] as { id: string; name: string }[] }

  if (!businesses || businesses.length === 0) {
    return (
      <Problem
        title="Crie uma empresa primeiro"
        detail="A conexão com um agente é concedida para uma empresa, e esta conta ainda não tem nenhuma. Cadastre uma empresa e depois inicie a conexão novamente."
      />
    )
  }

  return (
    <ConsentForm
      clientName={client.client_name}
      clientId={clientId}
      redirectUri={redirectUri}
      codeChallenge={codeChallenge}
      state={state}
      resource={resource}
      resourceLabel={mcpUrl()}
      businesses={businesses}
      preselected={requestedPermissions(first(params, 'scope'))}
    />
  )
}
