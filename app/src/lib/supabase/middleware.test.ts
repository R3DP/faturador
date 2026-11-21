import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createServerClientMock } = vi.hoisted(() => ({ createServerClientMock: vi.fn() }))
vi.mock('@supabase/ssr', () => ({ createServerClient: createServerClientMock }))

import { NextRequest } from 'next/server'
import { updateSession } from './middleware'

type Cookie = { name: string; value: string; options?: Record<string, unknown> }

/** Configura o cliente Supabase simulado para retornar a conta informada. */
function mockSession(user: unknown, refreshedCookies: Cookie[] = []) {
  createServerClientMock.mockImplementation(
    (_url: string, _key: string, options: { cookies: { setAll: (c: Cookie[]) => void } }) => {
      if (refreshedCookies.length) options.cookies.setAll(refreshedCookies)
      return { auth: { getUser: async () => ({ data: { user } }) } }
    },
  )
}

function request(path: string) {
  return new NextRequest(new URL(path, 'http://localhost:3000'))
}

beforeEach(() => {
  createServerClientMock.mockReset()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:56421')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_publishable_test')
})

// Os valores simulados do ambiente são isolados por teste, para que um não afete o outro.
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('updateSession', () => {
  it('redireciona uma pessoa anônima que acessa uma página do espaço de trabalho para o login, preservando o destino', async () => {
    mockSession(null)
    const response = await updateSession(request('/invoices'))
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/login?redirect=%2Finvoices',
    )
  })

  it('permite que uma pessoa autenticada acesse uma página do espaço de trabalho', async () => {
    mockSession({ id: 'u1' })
    const response = await updateSession(request('/invoices'))
    expect(response.headers.get('location')).toBeNull()
  })

  it('abre o espaço de trabalho na raiz para uma pessoa autenticada', async () => {
    mockSession({ id: 'u1' })
    const response = await updateSession(request('/'))
    expect(response.headers.get('location')).toBe('http://localhost:3000/dashboard')
  })

  it('redireciona para o login uma pessoa anônima que acessa a raiz', async () => {
    mockSession(null)
    const response = await updateSession(request('/'))
    expect(response.headers.get('location')).toBe('http://localhost:3000/login')
  })

  it('mantém os cookies de autenticação atualizados no redirecionamento da raiz', async () => {
    mockSession({ id: 'u1' }, [{ name: 'sb-refreshed', value: 'v' }])
    const response = await updateSession(request('/'))
    expect(response.cookies.get('sb-refreshed')?.value).toBe('v')
  })

  it('redireciona uma pessoa autenticada da tela de login para a página solicitada', async () => {
    mockSession({ id: 'u1' })
    const response = await updateSession(request('/login?redirect=%2Fclients'))
    expect(response.headers.get('location')).toBe('http://localhost:3000/clients')
  })

  it('permite que uma pessoa anônima acesse a página pública da fatura', async () => {
    mockSession(null)
    const response = await updateSession(request('/i/abc123xyz'))
    expect(response.headers.get('location')).toBeNull()
  })
})
