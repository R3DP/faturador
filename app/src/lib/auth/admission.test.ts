import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/mcp/fake-supabase'
import { admitAccount, openSignup, signupIsOpen } from './admission'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('openSignup', () => {
  it('fica ativa somente com a palavra true, sem distinção entre maiúsculas e minúsculas e com espaços', () => {
    expect(openSignup({ BILLR_OPEN_SIGNUP: 'true' })).toBe(true)
    expect(openSignup({ BILLR_OPEN_SIGNUP: ' TRUE ' })).toBe(true)
    expect(openSignup({ BILLR_OPEN_SIGNUP: '1' })).toBe(false)
    expect(openSignup({ BILLR_OPEN_SIGNUP: 'yes' })).toBe(false)
    expect(openSignup({})).toBe(false)
  })
})

describe('signupIsOpen', () => {
  it('fica aberto em uma instalação nova', async () => {
    const db = createFakeSupabase({ 'rpc.install_has_account': { data: false, error: null } })
    expect(await signupIsOpen(db as never)).toBe(true)
  })

  it('fica fechado quando já existe uma pessoa responsável', async () => {
    const db = createFakeSupabase({ 'rpc.install_has_account': { data: true, error: null } })
    expect(await signupIsOpen(db as never)).toBe(false)
  })

  it('permanece aberto com BILLR_OPEN_SIGNUP=true, sem consultar o banco de dados', async () => {
    vi.stubEnv('BILLR_OPEN_SIGNUP', 'true')
    const db = createFakeSupabase({ 'rpc.install_has_account': { data: true, error: null } })
    expect(await signupIsOpen(db as never)).toBe(true)
    expect(db.calls).toHaveLength(0)
  })

  it('recusa o cadastro quando o banco de dados não consegue responder', async () => {
    const db = createFakeSupabase({ 'rpc.install_has_account': { data: null, error: { message: 'down' } } })
    expect(await signupIsOpen(db as never)).toBe(false)
  })
})

describe('admitAccount', () => {
  it('envia a configuração de cadastro aberto e retorna a decisão', async () => {
    vi.stubEnv('BILLR_OPEN_SIGNUP', 'true')
    const db = createFakeSupabase({ 'rpc.admit_install_account': { data: true, error: null } })
    expect(await admitAccount('user-1', db as never)).toBe(true)
    expect(db.calls[0]?.payload).toEqual({ p_user_id: 'user-1', p_open: true })
  })

  it('informa uma recusa', async () => {
    const db = createFakeSupabase({ 'rpc.admit_install_account': { data: false, error: null } })
    expect(await admitAccount('user-2', db as never)).toBe(false)
  })

  it('não retorna uma decisão para um usuário desconhecido', async () => {
    const db = createFakeSupabase({ 'rpc.admit_install_account': { data: null, error: null } })
    expect(await admitAccount('user-3', db as never)).toBeNull()
  })

  it('gera um erro e nunca admite a conta quando o banco de dados não consegue responder', async () => {
    const db = createFakeSupabase({ 'rpc.admit_install_account': { data: null, error: { message: 'down' } } })
    await expect(admitAccount('user-4', db as never)).rejects.toThrow(/não foi possível verificar o acesso/)
  })
})
