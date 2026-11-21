import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const headerStore = { value: new Headers() }

vi.mock('next/headers', () => ({
  headers: async () => headerStore.value,
}))

import { _setRateLimitStore, type RateLimitStore } from '@/lib/rate-limit'
import { guardAuthAttempt, recordAuthFailure } from './guard'

/** Mesmo contrato das RPCs consume_rate_limit / peek_rate_limit. */
function fakeStore() {
  const rows = new Map<string, number>()
  const store: RateLimitStore & { hitsFor: (prefix: string) => number } = {
    hitsFor(prefix) {
      let total = 0
      for (const [k, v] of rows) if (k.startsWith(prefix)) total += v
      return total
    },
    async rpc(fn, args) {
      const bucket = args.p_bucket as string
      const limit = args.p_limit as number
      await Promise.resolve()
      let hits: number
      if (fn === 'peek_rate_limit') {
        hits = rows.get(bucket) ?? 0
      } else {
        hits = (rows.get(bucket) ?? 0) + 1
        rows.set(bucket, hits)
      }
      return {
        data: [
          {
            allowed: fn === 'peek_rate_limit' ? hits < limit : hits <= limit,
            remaining: Math.max(limit - hits, 0),
            retry_after_seconds: 900,
          },
        ],
        error: null,
      }
    },
  }
  return store
}

let store: ReturnType<typeof fakeStore>

beforeEach(() => {
  store = fakeStore()
  _setRateLimitStore(() => store)
  // clientIpFrom só confia em x-vercel-forwarded-for quando está executando
  // na Vercel, plataforma que sobrescreve esse cabeçalho. Estes casos simulam
  // a execução na borda da Vercel, então indicamos isso.
  vi.stubEnv('VERCEL', '1')
  headerStore.value = new Headers({ 'x-vercel-forwarded-for': '203.0.113.5' })
})

afterEach(() => {
  _setRateLimitStore(null)
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('guardAuthAttempt', () => {
  it('permite a primeira tentativa e informa o IP resolvido', async () => {
    const result = await guardAuthAttempt('signin', 'user@example.com')
    expect(result.blocked).toBe(false)
    if (!result.blocked) expect(result.ip).toBe('203.0.113.5')
  })

  it('trata o identificador sem distinção entre maiúsculas e minúsculas', async () => {
    for (let i = 0; i < 10; i += 1) await guardAuthAttempt('signin', 'user@example.com')
    // A 11ª tentativa na mesma conta, escrita de outra forma, ainda deve ser
    // considerada a 11ª tentativa.
    const result = await guardAuthAttempt('signin', 'USER@Example.COM')
    expect(result.blocked).toBe(true)
  })

  it('limita as tentativas por IP para que trocar o endereço de e-mail não adiante', async () => {
    // Cada tentativa usa um endereço novo, então o limite por identificador
    // nunca fica próximo do máximo. O limite por IP (30 / 15 min) ainda deve
    // interromper as tentativas.
    let blockedAt = -1
    for (let i = 0; i < 40; i += 1) {
      const result = await guardAuthAttempt('signin', `throwaway-${i}@example.com`)
      if (result.blocked && blockedAt === -1) blockedAt = i
    }
    expect(blockedAt).toBe(30)
  })

  it('não permite que um IP esgote o limite de outro IP', async () => {
    for (let i = 0; i < 40; i += 1) await guardAuthAttempt('signin', `a-${i}@example.com`)
    headerStore.value = new Headers({ 'x-vercel-forwarded-for': '198.51.100.9' })
    const result = await guardAuthAttempt('signin', 'fresh@example.com')
    expect(result.blocked).toBe(false)
  })

  it('bloqueia a conta após registrar falhas suficientes', async () => {
    // 8 falhas por hora no limite do identificador.
    for (let i = 0; i < 8; i += 1) await recordAuthFailure('victim@example.com', '203.0.113.5')

    const result = await guardAuthAttempt('signin', 'victim@example.com')
    expect(result.blocked).toBe(true)
    if (result.blocked) expect(result.message).toContain('malsucedidas')
  })

  it('verifica um bloqueio ativo sem prolongá-lo', async () => {
    for (let i = 0; i < 8; i += 1) await recordAuthFailure('victim@example.com', '203.0.113.5')
    const before = store.hitsFor('authfail:id')

    for (let i = 0; i < 5; i += 1) await guardAuthAttempt('signin', 'victim@example.com')

    // peek, não consume: quem está bloqueado não pode prolongar o próprio
    // bloqueio indefinidamente insistindo na tentativa.
    expect(store.hitsFor('authfail:id')).toBe(before)
  })

  it('mantém limites de tentativa separados por identificador para entrada, cadastro e redefinição', async () => {
    for (let i = 0; i < 10; i += 1) await guardAuthAttempt('signin', 'user@example.com')
    expect((await guardAuthAttempt('signin', 'user@example.com')).blocked).toBe(true)
    // Outra ação, mesmo endereço: ainda permitido pelo limite do identificador
    // (o limite compartilhado por IP é a camada comum às ações).
    expect((await guardAuthAttempt('reset', 'user@example.com')).blocked).toBe(false)
  })

  it('recusa as tentativas quando o armazenamento do contador está inacessível', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    _setRateLimitStore(() => ({
      rpc: async () => ({ data: null, error: { message: 'connection refused' } }),
    }))

    const result = await guardAuthAttempt('signin', 'user@example.com')
    expect(result.blocked).toBe(true)
  })

  it('continua aplicando um limite quando nenhum IP pode ser resolvido', async () => {
    headerStore.value = new Headers()
    let blocked = false
    for (let i = 0; i < 40; i += 1) {
      const result = await guardAuthAttempt('signin', `nope-${i}@example.com`)
      if (result.blocked) blocked = true
    }
    expect(blocked).toBe(true)
  })
})
