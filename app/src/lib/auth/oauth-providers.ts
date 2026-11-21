import { createClient } from '@/lib/supabase/client'
import { safeAuthRedirect } from '@/lib/auth/redirect'

/** Provedores sociais pelos quais o Faturador consegue iniciar uma autenticação. */
export type OAuthProviderId = 'github' | 'google'

type OAuthProviderConfig = {
  /** Nome exibido no botão e em mensagens de erro. */
  label: string
  /**
   * Escopos solicitados. Quando omitido, usa o padrão do provedor Supabase,
   * como sempre ocorreu na autenticação pelo GitHub (somente autenticação, sem repositórios).
   */
  scopes?: string
}

export const OAUTH_PROVIDERS: Record<OAuthProviderId, OAuthProviderConfig> = {
  github: { label: 'GitHub' },
  // O Google precisa apenas da identidade. Estes também são os padrões do
  // Supabase, declarados aqui para impedir que uma alteração no provedor amplie os escopos.
  google: { label: 'Google', scopes: 'email profile' },
}

export const OAUTH_PROVIDER_IDS = Object.keys(
  OAUTH_PROVIDERS,
) as OAuthProviderId[]

/**
 * Provedores atualmente configurados no projeto Supabase.
 *
 * O Supabase publica essas informações em `/auth/v1/settings`, então a
 * disponibilidade é consultada em tempo de execução e ativar um provedor não
 * exige nova implantação. Se o documento de configurações estiver inacessível
 * ou ilegível, nenhum provedor é oferecido e o formulário de e-mail abaixo dos
 * botões continua sendo uma opção.
 */
export async function fetchEnabledOAuthProviders(): Promise<OAuthProviderId[]> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`,
      { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! } },
    )
    if (!response.ok) return []
    const settings: { external?: Record<string, boolean> } =
      await response.json()
    return OAUTH_PROVIDER_IDS.filter(
      (provider) => settings.external?.[provider] === true,
    )
  } catch {
    return []
  }
}

/**
 * Inicia o fluxo PKCE e retorna a URL do provedor para redirecionar o navegador.
 *
 * O retorno chega a `/api/auth/callback`, que não depende do provedor:
 * troca o código e encaminha contas novas para a etapa de aceite. `origin` é um
 * parâmetro para permitir testes fora de um navegador.
 */
export async function startOAuthSignIn(
  provider: OAuthProviderId,
  next: string,
  origin: string,
): Promise<string> {
  const { label, scopes } = OAUTH_PROVIDERS[provider]
  const callback = new URL('/api/auth/callback', origin)
  callback.searchParams.set('next', safeAuthRedirect(next))
  const { data, error } = await createClient().auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: callback.toString(),
      skipBrowserRedirect: true,
      ...(scopes ? { scopes } : {}),
    },
  })
  if (error || !data?.url)
    throw new Error(`Não foi possível iniciar a autenticação com ${label}. Tente novamente.`)
  return data.url
}
