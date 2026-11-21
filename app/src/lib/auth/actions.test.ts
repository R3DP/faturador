import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Testes de integração da ação de servidor de cadastro.
 *
 * Eles chamam a ação real e verificam a integração entre a validação do aceite,
 * a proteção de limite de tentativas e o Supabase Auth: o aceite deve interromper
 * uma solicitação antes de qualquer chamada de autenticação, e as versões e o
 * registro de data e hora devem vir do servidor, não de quem fez a solicitação.
 */

const {
  createClientMock,
  guardAuthAttempt,
  recordAuthFailure,
  signUp,
  signOut,
  signInWithPassword,
  signupIsOpen,
  admitAccount,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  guardAuthAttempt: vi.fn(),
  recordAuthFailure: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  signInWithPassword: vi.fn(),
  signupIsOpen: vi.fn(),
  admitAccount: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('./guard', () => ({ guardAuthAttempt, recordAuthFailure }))
vi.mock('./admission', () => ({ signupIsOpen, admitAccount }))

import { signInAction, signUpAction } from './actions'
import { ACCESS_CHECK_FAILED_MESSAGE, SIGNUP_CLOSED_MESSAGE } from './signup-closed'

const VALID = {
  email: 'person@example.com',
  password: 'correct-horse-battery',
  fullName: 'Harper Lane',
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-20T22:00:00Z'))
  createClientMock.mockReset()
  createClientMock.mockResolvedValue({ auth: { signUp, signOut, signInWithPassword } })
  guardAuthAttempt.mockReset()
  guardAuthAttempt.mockResolvedValue({ blocked: false, ip: '203.0.113.5' })
  recordAuthFailure.mockReset()
  signUp.mockReset()
  signUp.mockResolvedValue({
    data: { user: { id: 'user-1' }, session: { access_token: 'x' } },
    error: null,
  })
  signupIsOpen.mockReset()
  signupIsOpen.mockResolvedValue(true)
  admitAccount.mockReset()
  admitAccount.mockResolvedValue(true)
  signOut.mockReset()
  signInWithPassword.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('signUpAction', () => {
  it('cria a conta usando o nome como único metadado', async () => {
    const result = await signUpAction(VALID)

    expect(result).toEqual({ success: true, hasSession: true })
    expect(signUp).toHaveBeenCalledTimes(1)
    expect(signUp).toHaveBeenCalledWith({
      email: 'person@example.com',
      password: 'correct-horse-battery',
      options: { data: { full_name: 'Harper Lane' } },
    })
  })

  it('informa que não há sessão quando é necessário confirmar o e-mail', async () => {
    signUp.mockResolvedValue({ data: { session: null }, error: null })
    expect(await signUpAction(VALID)).toEqual({ success: true, hasSession: false })
  })

  it('informa o limite de tentativas sem acessar o Supabase Auth', async () => {
    guardAuthAttempt.mockResolvedValue({
      blocked: true,
      message: 'Muitas tentativas.',
      retryAfterSeconds: 900,
    })

    const result = await signUpAction(VALID)

    expect(result).toEqual({
      success: false,
      error: 'Muitas tentativas.',
      retryAfterSeconds: 900,
    })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('registra uma tentativa malsucedida quando o Supabase rejeita o cadastro', async () => {
    signUp.mockResolvedValue({ data: null, error: { message: 'already registered' } })

    const result = await signUpAction(VALID)

    expect(result).toEqual({ success: false, error: 'already registered' })
    expect(recordAuthFailure).toHaveBeenCalledWith(VALID.email, '203.0.113.5')
  })
})

describe('cadastro após a primeira conta', () => {
  it('recusa antes de criar qualquer coisa quando o cadastro está fechado', async () => {
    signupIsOpen.mockResolvedValue(false)
    expect(await signUpAction(VALID)).toEqual({ success: false, error: SIGNUP_CLOSED_MESSAGE })
    expect(signUp).not.toHaveBeenCalled()
  })

  it('encerra a sessão de uma conta que perdeu a disputa para ser a primeira', async () => {
    admitAccount.mockResolvedValue(false)
    expect(await signUpAction(VALID)).toEqual({ success: false, error: SIGNUP_CLOSED_MESSAGE })
    expect(signOut).toHaveBeenCalled()
  })

  it('admite a pessoa responsável e mantém a sessão', async () => {
    expect(await signUpAction(VALID)).toEqual({ success: true, hasSession: true })
    expect(admitAccount).toHaveBeenCalledWith('user-1')
  })

  it('permite que um usuário provisório de endereço existente receba a mensagem para verificar o e-mail', async () => {
    signUp.mockResolvedValue({ data: { user: { id: 'placeholder' }, session: null }, error: null })
    admitAccount.mockResolvedValue(null)
    expect(await signUpAction(VALID)).toEqual({ success: true, hasSession: false })
    expect(signOut).not.toHaveBeenCalled()
  })

  it('encerra a sessão e pede uma nova tentativa quando não é possível verificar o acesso', async () => {
    admitAccount.mockRejectedValue(new Error('não foi possível verificar o acesso'))
    expect(await signUpAction(VALID)).toEqual({ success: false, error: ACCESS_CHECK_FAILED_MESSAGE })
    expect(signOut).toHaveBeenCalled()
  })
})

describe('signInAction', () => {
  it('autentica uma conta admitida', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'owner' } }, error: null })
    expect(await signInAction({ email: 'person@example.com', password: 'pw' })).toEqual({ success: true })
  })

  it('encerra a sessão de uma conta que nunca foi admitida', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'stranger' } }, error: null })
    admitAccount.mockResolvedValue(false)
    expect(await signInAction({ email: 'person@example.com', password: 'pw' })).toEqual({
      success: false,
      error: SIGNUP_CLOSED_MESSAGE,
    })
    expect(signOut).toHaveBeenCalled()
  })

  it('encerra a sessão sem afirmar que o cadastro está fechado quando não é possível verificar o acesso', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'owner' } }, error: null })
    admitAccount.mockRejectedValue(new Error('não foi possível verificar o acesso'))
    expect(await signInAction({ email: 'person@example.com', password: 'pw' })).toEqual({
      success: false,
      error: ACCESS_CHECK_FAILED_MESSAGE,
    })
    expect(signOut).toHaveBeenCalled()
  })
})
