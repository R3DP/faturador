import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { signInWithOAuth } = vi.hoisted(() => ({ signInWithOAuth: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({ auth: { signInWithOAuth } })),
}))

import {
  OAUTH_PROVIDER_IDS,
  fetchEnabledOAuthProviders,
  startOAuthSignIn,
} from './oauth-providers'

/** Resposta do Supabase `/auth/v1/settings` com os provedores indicados ativos. */
function settings(external: Record<string, boolean>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ external }) })),
  )
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
  signInWithOAuth.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('disponibilidade dos provedores', () => {
  it('oferece os dois botões quando GitHub e Google estão configurados', async () => {
    settings({ github: true, google: true, email: true })
    expect(await fetchEnabledOAuthProviders()).toEqual(['github', 'google'])
  })

  it('oferece apenas o Google quando o GitHub está desativado', async () => {
    settings({ github: false, google: true })
    expect(await fetchEnabledOAuthProviders()).toEqual(['google'])
  })

  it('oferece apenas o GitHub quando o Google está desativado', async () => {
    settings({ github: true, google: false })
    expect(await fetchEnabledOAuthProviders()).toEqual(['github'])
  })

  it('não oferece opções quando nenhum provedor social está configurado', async () => {
    settings({ email: true })
    expect(await fetchEnabledOAuthProviders()).toEqual([])
  })

  it('ignora provedores que o Faturador não implementa', async () => {
    settings({ google: true, gitlab: true, azure: true })
    expect(await fetchEnabledOAuthProviders()).toEqual(['google'])
  })

  it('consulta a disponibilidade no documento de configurações do Supabase', async () => {
    settings({ google: true })
    await fetchEnabledOAuthProviders()
    expect(fetch).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/settings',
      { headers: { apikey: 'anon-key' } },
    )
  })

  it('não oferece opções quando o documento de configurações é rejeitado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    expect(await fetchEnabledOAuthProviders()).toEqual([])
  })

  it('não oferece opções quando o Supabase está inacessível', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await fetchEnabledOAuthProviders()).toEqual([])
  })

  it('reconhece exatamente os dois provedores exibidos nos botões', () => {
    expect(OAUTH_PROVIDER_IDS).toEqual(['github', 'google'])
  })
})

describe('início da autenticação', () => {
  it('envia o GitHub pelo callback do app com o destino solicitado', async () => {
    signInWithOAuth.mockResolvedValue({
      data: { url: 'https://github.com/login/oauth/authorize?x=1' },
      error: null,
    })
    const url = await startOAuthSignIn('github', '/agents', 'https://invoices.example.org')
    expect(url).toBe('https://github.com/login/oauth/authorize?x=1')
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'github',
      options: {
        redirectTo: 'https://invoices.example.org/api/auth/callback?next=%2Fagents',
        skipBrowserRedirect: true,
      },
    })
  })

  it('solicita apenas a identidade ao Google', async () => {
    signInWithOAuth.mockResolvedValue({
      data: { url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' },
      error: null,
    })
    await startOAuthSignIn('google', '/dashboard', 'https://invoices.example.org')
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'https://invoices.example.org/api/auth/callback?next=%2Fdashboard',
        skipBrowserRedirect: true,
        scopes: 'email profile',
      },
    })
  })

  it('não permite enviar um destino externo pelo provedor', async () => {
    signInWithOAuth.mockResolvedValue({ data: { url: 'https://provider.example' }, error: null })
    await startOAuthSignIn('google', '//evil.example', 'https://invoices.example.org')
    expect(signInWithOAuth.mock.calls[0][0].options.redirectTo).toBe(
      'https://invoices.example.org/api/auth/callback?next=%2Fdashboard',
    )
  })

  it('identifica o provedor quando não é possível iniciar o fluxo', async () => {
    signInWithOAuth.mockResolvedValue({ data: { url: null }, error: null })
    await expect(
      startOAuthSignIn('google', '/dashboard', 'https://invoices.example.org'),
    ).rejects.toThrow('Não foi possível iniciar a autenticação com Google. Tente novamente.')
  })

  it('apresenta um erro do provedor como uma mensagem que permite nova tentativa', async () => {
    signInWithOAuth.mockResolvedValue({ data: null, error: new Error('provider down') })
    await expect(
      startOAuthSignIn('github', '/dashboard', 'https://invoices.example.org'),
    ).rejects.toThrow('Não foi possível iniciar a autenticação com GitHub. Tente novamente.')
  })
})
