import { beforeEach, describe, expect, it, vi } from 'vitest'

const { exchange, getUser, signOut, admitAccount } = vi.hoisted(() => ({
  exchange: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  admitAccount: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { exchangeCodeForSession: exchange, getUser, signOut } })),
}))
vi.mock('@/lib/auth/admission', () => ({ admitAccount }))

import { GET } from './route'

const ORIGIN = 'http://localhost:3000'

function signedIn(id = 'user-1') {
  exchange.mockResolvedValue({ error: null })
  getUser.mockResolvedValue({ data: { user: { id } } })
}

describe('retorno da autenticação', () => {
  beforeEach(() => {
    exchange.mockReset()
    getUser.mockReset()
    signOut.mockReset()
    admitAccount.mockReset()
    admitAccount.mockResolvedValue(true)
  })

  it('troca o código e direciona uma conta aprovada à página local solicitada', async () => {
    signedIn()
    const response = await GET(
      new Request(`${ORIGIN}/api/auth/callback?code=example&next=%2Fagents%3Ftab%3Dkeys`),
    )
    expect(exchange).toHaveBeenCalledWith('example')
    expect(admitAccount).toHaveBeenCalledWith('user-1')
    expect(response.headers.get('location')).toBe(`${ORIGIN}/agents?tab=keys`)
  })

  it('não permite um destino externo após a autenticação', async () => {
    signedIn()
    const response = await GET(
      new Request(`${ORIGIN}/api/auth/callback?code=example&next=%2F%2Fevil.example`),
    )
    expect(response.headers.get('location')).toBe(`${ORIGIN}/dashboard`)
  })

  it('encerra a sessão de uma nova conta do GitHub ou Google quando as inscrições estão fechadas', async () => {
    signedIn('stranger')
    admitAccount.mockResolvedValue(false)
    const response = await GET(new Request(`${ORIGIN}/api/auth/callback?code=example&next=%2Fdashboard`))
    expect(signOut).toHaveBeenCalled()
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login?error=signup_closed`)
  })

  it('encerra a sessão e informa com clareza quando não é possível verificar o acesso', async () => {
    signedIn('owner')
    admitAccount.mockRejectedValue(new Error('could not check access'))
    const response = await GET(new Request(`${ORIGIN}/api/auth/callback?code=example&next=%2Fdashboard`))
    expect(signOut).toHaveBeenCalled()
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login?error=access_check`)
  })

  it('retorna à página de entrada após uma troca malsucedida, preservando o destino', async () => {
    exchange.mockResolvedValue({ error: { message: 'expired' } })
    const response = await GET(
      new Request(`${ORIGIN}/api/auth/callback?code=example&next=%2Finvoices`),
    )
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login?error=auth&redirect=%2Finvoices`)
    expect(admitAccount).not.toHaveBeenCalled()
  })
})
