import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { challengeFromVerifier, generateSecret, hashSecret } from '@/lib/oauth/params'
import { createFakeDb, type FakeDb } from '@/lib/oauth/fake-db'
import { _setOauthServiceClient, registerClient } from '@/lib/oauth/store'

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'
const USER = '11111111-1111-1111-1111-111111111111'
const BUSINESS = '22222222-2222-2222-2222-222222222222'

let db: FakeDb
let user: { id: string; created_at: string; user_metadata: Record<string, unknown> } | null

// A tela de consentimento e suas ações consultam o próprio cliente do usuário AUTENTICADO, então o RLS
// decide o que ele pode ver. Aqui, esse cliente usa o mesmo armazenamento de linhas fictícias, com
// uma camada simulada de autenticação.
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    ...db.client,
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  }),
}))

const { default: AuthorizePage } = await import('./page')
const { approveAuthorizationAction, denyAuthorizationAction } = await import('./actions')

beforeEach(() => {
  db = createFakeDb({
    business_members: [{ user_id: USER, business_id: BUSINESS }],
    businesses: [{ id: BUSINESS, name: 'Fieldstone Digital', is_active: true }],
  })
  _setOauthServiceClient(() => db.client)
  user = {
    id: USER,
    created_at: '2025-01-01T00:00:00Z',
    user_metadata: {},
  }
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://invoices.example.org')
})

afterEach(() => {
  _setOauthServiceClient(null)
  vi.unstubAllEnvs()
})

async function seedClient(redirectUris = [REDIRECT]) {
  const client = await registerClient({ clientName: 'Claude', redirectUris })
  if (!client) throw new Error('seed failed')
  return client
}

function render(params: Record<string, string>) {
  return AuthorizePage({ searchParams: Promise.resolve(params) })
}

/** redirect() de next/navigation lança uma exceção; o destino fica no digest. */
async function redirectTarget(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? ''
    const parts = digest.split(';')
    if (parts[0] === 'NEXT_REDIRECT') return parts[2]
    throw error
  }
  throw new Error('expected a redirect')
}

function problemTitle(element: unknown): string {
  return (element as { props: { title: string } }).props.title
}

describe('validação da solicitação de autorização', () => {
  const verifier = generateSecret(48)
  const challenge = challengeFromVerifier(verifier)

  it('recusa um cliente desconhecido sem redirecionar para lugar algum', async () => {
    const element = await render({
      client_id: 'billr_client_unknown',
      redirect_uri: REDIRECT,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    expect(problemTitle(element)).toBe('Aplicativo desconhecido')
  })

  it('recusa uma URI de redirecionamento nunca registrada pelo cliente e não redireciona para ela', async () => {
    const client = await seedClient()
    const element = await render({
      client_id: client.client_id,
      redirect_uri: 'https://evil.example/steal',
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    expect(problemTitle(element)).toBe('O endereço de retorno não corresponde')
  })

  it('recusa uma solicitação sem ID de cliente ou endereço de retorno', async () => {
    expect(problemTitle(await render({}))).toBe('Solicitação incompleta')
  })

  it('envia erros do protocolo de volta a uma URI de redirecionamento registrada', async () => {
    const client = await seedClient()
    const base = {
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
    }

    const noPkce = new URL(
      await redirectTarget(render({ ...base, code_challenge: '', code_challenge_method: '' }))
    )
    expect(noPkce.origin + noPkce.pathname).toBe(REDIRECT)
    expect(noPkce.searchParams.get('error')).toBe('invalid_request')
    expect(noPkce.searchParams.get('state')).toBe('xyz')
    expect(noPkce.searchParams.get('iss')).toBe('https://invoices.example.org')

    const plainPkce = new URL(
      await redirectTarget(render({ ...base, code_challenge_method: 'plain' }))
    )
    expect(plainPkce.searchParams.get('error')).toBe('invalid_request')

    const implicit = new URL(await redirectTarget(render({ ...base, response_type: 'token' })))
    expect(implicit.searchParams.get('error')).toBe('unsupported_response_type')

    const wrongAudience = new URL(
      await redirectTarget(render({ ...base, resource: 'https://mcp.evil.example' }))
    )
    expect(wrongAudience.searchParams.get('error')).toBe('invalid_target')
  })

  it('direciona um visitante não autenticado à página de entrada e depois de volta a esta solicitação exata', async () => {
    const client = await seedClient()
    user = null
    const target = await redirectTarget(
      render({
        client_id: client.client_id,
        redirect_uri: REDIRECT,
        response_type: 'code',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 'xyz',
      })
    )
    expect(target.startsWith('/login?redirect=')).toBe(true)
    const back = decodeURIComponent(target.slice('/login?redirect='.length))
    expect(back.startsWith('/oauth/authorize?')).toBe(true)
    expect(back).toContain('state=xyz')
    expect(back).toContain(`client_id=${client.client_id}`)
  })

  it('exibe a tela de consentimento com os escopos solicitados pré-selecionados', async () => {
    const client = await seedClient()
    const element = (await render({
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: 'read write send',
    })) as { props: Record<string, unknown> }

    expect(element.props.clientName).toBe('Claude')
    expect(element.props.preselected).toEqual(['read', 'write', 'send'])
    expect(element.props.businesses).toMatchObject([{ id: BUSINESS, name: 'Fieldstone Digital' }])
  })
})

describe('decisões de consentimento', () => {
  const verifier = generateSecret(48)
  const challenge = challengeFromVerifier(verifier)

  it('emite um código de uso único vinculado ao cliente, à empresa e ao desafio PKCE', async () => {
    const client = await seedClient()
    const result = await approveAuthorizationAction({
      clientId: client.client_id,
      redirectUri: REDIRECT,
      codeChallenge: challenge,
      state: 'xyz',
      businessId: BUSINESS,
      permissions: ['read', 'write', 'send'],
    })
    expect('redirect' in result).toBe(true)

    const url = new URL((result as { redirect: string }).redirect)
    expect(url.origin + url.pathname).toBe(REDIRECT)
    expect(url.searchParams.get('state')).toBe('xyz')
    expect(url.searchParams.get('iss')).toBe('https://invoices.example.org')

    const code = url.searchParams.get('code') ?? ''
    expect(code.length).toBeGreaterThanOrEqual(43)
    const stored = db.tables.oauth_authorization_codes[0]
    expect(stored.code_hash).toBe(hashSecret(code))
    expect(stored).toMatchObject({
      oauth_client_id: client.id,
      user_id: USER,
      business_id: BUSINESS,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      permissions: ['read', 'write', 'send'],
    })
    expect(stored.used_at ?? null).toBeNull()
    // Validade de dez minutos.
    const ttl = Date.parse(stored.expires_at as string) - Date.now()
    expect(ttl).toBeGreaterThan(9 * 60_000)
    expect(ttl).toBeLessThanOrEqual(10 * 60_000)
  })

  it('concede somente as permissões selecionadas pela pessoa, nunca todas as solicitadas', async () => {
    const client = await seedClient()
    await approveAuthorizationAction({
      clientId: client.client_id,
      redirectUri: REDIRECT,
      codeChallenge: challenge,
      businessId: BUSINESS,
      permissions: ['write'],
    })
    expect(db.tables.oauth_authorization_codes[0].permissions).toEqual(['read', 'write'])
  })

  it('recusa uma empresa à qual a pessoa conectada não pertence', async () => {
    const client = await seedClient()
    const result = await approveAuthorizationAction({
      clientId: client.client_id,
      redirectUri: REDIRECT,
      codeChallenge: challenge,
      businessId: '33333333-3333-3333-3333-333333333333',
      permissions: ['read'],
    })
    expect(result).toEqual({ error: 'Escolha uma empresa à qual você tenha acesso.' })
    expect(db.tables.oauth_authorization_codes ?? []).toHaveLength(0)
  })

  it('verifica novamente a URI de redirecionamento e o desafio PKCE na própria ação', async () => {
    const client = await seedClient()
    const forged = await approveAuthorizationAction({
      clientId: client.client_id,
      redirectUri: 'https://evil.example/steal',
      codeChallenge: challenge,
      businessId: BUSINESS,
      permissions: ['read'],
    })
    expect('error' in forged).toBe(true)

    const noPkce = await approveAuthorizationAction({
      clientId: client.client_id,
      redirectUri: REDIRECT,
      codeChallenge: 'plain',
      businessId: BUSINESS,
      permissions: ['read'],
    })
    expect('error' in noPkce).toBe(true)
    expect(db.tables.oauth_authorization_codes ?? []).toHaveLength(0)
  })

  it('recusa emitir um código sem uma sessão', async () => {
    const client = await seedClient()
    user = null
    const result = await approveAuthorizationAction({
      clientId: client.client_id,
      redirectUri: REDIRECT,
      codeChallenge: challenge,
      businessId: BUSINESS,
      permissions: ['read'],
    })
    expect('error' in result).toBe(true)
  })

  it('envia access_denied de volta ao cliente quando a pessoa recusa', async () => {
    const client = await seedClient()
    const result = await denyAuthorizationAction({
      clientId: client.client_id,
      redirectUri: REDIRECT,
      state: 'xyz',
    })
    const url = new URL((result as { redirect: string }).redirect)
    expect(url.searchParams.get('error')).toBe('access_denied')
    expect(url.searchParams.get('state')).toBe('xyz')
    expect(db.tables.oauth_authorization_codes ?? []).toHaveLength(0)
  })

  it('não redireciona uma recusa para um endereço não registrado', async () => {
    const client = await seedClient()
    const result = await denyAuthorizationAction({
      clientId: client.client_id,
      redirectUri: 'https://evil.example/steal',
      state: 'xyz',
    })
    expect('error' in result).toBe(true)
  })
})
