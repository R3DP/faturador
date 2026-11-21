import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  RATE_LIMITS,
  _setRateLimitStore,
  clientIpFrom,
  consumeRateLimit,
  consumeRateLimits,
  ipKey,
  peekRateLimit,
  rateLimitKey,
  type RateLimitStore,
} from './rate-limit'

/**
 * Implementação simulada que reproduz o contrato da RPC consume_rate_limit: janelas fixas indexadas por (bucket, floor(now / window)) e uma
 * única operação atômica de leitura-modificação-gravação, como INSERT ... ON CONFLICT DO UPDATE.
 *
 * O `await` antes de acessar o contador simula a ida e volta pela rede.
 * A alteração do contador em si é síncrona, o que a torna atômica:
 * nenhuma outra chamada pendente pode se intercalar entre a leitura e a gravação. Essa é
 * exatamente a propriedade da instrução SQL que a antiga sequência do limitador em memória
 * com filter/push/set não tinha.
 */
function atomicStore(clock: { now: number }) {
  const rows = new Map<string, { windowStart: number; hits: number }>()

  const key = (bucket: string, windowSeconds: number) => {
    const windowStart = Math.floor(clock.now / (windowSeconds * 1000)) * (windowSeconds * 1000)
    return { rowKey: `${bucket}@${windowStart}`, windowStart }
  }

  const store: RateLimitStore & { rowCount: () => number } = {
    rowCount: () => rows.size,
    async rpc(fn, args) {
      const bucket = args.p_bucket as string
      const limit = args.p_limit as number
      const windowSeconds = args.p_window_seconds as number
      // Ida e volta. Tudo depois deste ponto é executado sem intercalação.
      await Promise.resolve()
      const { rowKey, windowStart } = key(bucket, windowSeconds)
      const existing = rows.get(rowKey)

      let hits: number
      if (fn === 'peek_rate_limit') {
        hits = existing?.hits ?? 0
      } else {
        hits = (existing?.hits ?? 0) + 1
        rows.set(rowKey, { windowStart, hits })
      }

      const allowed = fn === 'peek_rate_limit' ? hits < limit : hits <= limit
      const windowEnd = windowStart + windowSeconds * 1000
      return {
        data: [
          {
            allowed,
            remaining: Math.max(limit - hits, 0),
            retry_after_seconds: Math.max(Math.ceil((windowEnd - clock.now) / 1000), 1),
          },
        ],
        error: null,
      }
    },
  }
  return store
}

/** Um armazenamento que lê, cede a execução e depois grava: a condição de corrida que a RPC evita. */
function racyStore() {
  const rows = new Map<string, number>()
  const store: RateLimitStore = {
    async rpc(_fn, args) {
      const bucket = args.p_bucket as string
      const limit = args.p_limit as number
      const hits = rows.get(bucket) ?? 0
      await Promise.resolve()
      await Promise.resolve()
      const next = hits + 1
      rows.set(bucket, next)
      return {
        data: [{ allowed: next <= limit, remaining: Math.max(limit - next, 0), retry_after_seconds: 60 }],
        error: null,
      }
    },
  }
  return store
}

const POLICY = { limit: 3, windowMs: 60_000 }

/** Instala um armazenamento simulado compartilhado (uma única instância da fábrica, como em produção). */
function useAtomicStore() {
  const clock = { now: 1_700_000_000_000 }
  const store = atomicStore(clock)
  _setRateLimitStore(() => store)
  return { clock, store }
}

afterEach(() => {
  _setRateLimitStore(null)
  vi.restoreAllMocks()
})

describe('rateLimitKey', () => {
  it('é determinística', () => {
    expect(rateLimitKey('auth', 'a@b.com')).toBe(rateLimitKey('auth', 'a@b.com'))
  })

  it('não expõe o identificador na chave armazenada', () => {
    const key = rateLimitKey('auth', 'victim@example.com')
    expect(key.startsWith('auth:')).toBe(true)
    expect(key).not.toContain('victim@example.com')
  })

  it('produz uma chave de tamanho limitado, independentemente do comprimento do identificador', () => {
    const key = rateLimitKey('auth', 'x'.repeat(10_000))
    expect(key.length).toBeLessThanOrEqual(200)
  })

  it('separa espaços de nomes', () => {
    expect(rateLimitKey('auth', 'same')).not.toBe(rateLimitKey('support', 'same'))
  })
})

describe('clientIpFrom', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('prioriza o cabeçalho definido pela Vercel em vez de qualquer valor enviado pelo cliente', () => {
    vi.stubEnv('VERCEL', '1')
    const headers = new Headers({
      'x-vercel-forwarded-for': '9.9.9.9',
      'x-forwarded-for': '1.2.3.4, 9.9.9.9',
      'x-real-ip': '8.8.8.8',
    })
    expect(clientIpFrom(headers)).toBe('9.9.9.9')
  })

  it('ignora os cabeçalhos da plataforma fora dela', () => {
    // Fora da Vercel, nada na frente do aplicativo define x-vercel-forwarded-for nem
    // necessariamente sobrescreve x-real-ip; confiar em qualquer um deles daria a quem chama um
    // bucket privado de limite de requisições para cada valor forjado - ou seja, nenhum limite.
    vi.stubEnv('VERCEL', '')
    vi.stubEnv('VERCEL_ENV', '')
    const headers = new Headers({
      'x-vercel-forwarded-for': '203.0.113.7',
      'x-real-ip': '203.0.113.8',
      'x-forwarded-for': '1.2.3.4, 198.51.100.9',
    })
    expect(clientIpFrom(headers)).toBe('198.51.100.9')
  })

  it('compartilha um bucket quando a instalação não recebe nenhum cabeçalho de proxy', () => {
    vi.stubEnv('VERCEL', '')
    vi.stubEnv('VERCEL_ENV', '')
    const forged = new Headers({ 'x-vercel-forwarded-for': '203.0.113.7' })
    const other = new Headers({ 'x-real-ip': '203.0.113.8' })
    expect(clientIpFrom(forged)).toBeNull()
    expect(clientIpFrom(other)).toBeNull()
    expect(ipKey('probe', clientIpFrom(forged))).toBe(ipKey('probe', clientIpFrom(other)))
  })

  it('permite que a pessoa operadora informe qual cabeçalho o próprio proxy sobrescreve', () => {
    vi.stubEnv('VERCEL', '')
    vi.stubEnv('VERCEL_ENV', '')
    vi.stubEnv('BILLR_TRUSTED_IP_HEADER', 'X-Real-IP')
    const headers = new Headers({
      'x-real-ip': '203.0.113.8',
      'x-forwarded-for': '1.2.3.4, 198.51.100.9',
    })
    expect(clientIpFrom(headers)).toBe('203.0.113.8')
  })

  it('nunca usa a primeira entrada falsificável de x-forwarded-for', () => {
    // Um invasor envia `x-forwarded-for: 1.2.3.4`; o proxy acrescenta o endereço real
    // do cliente. Usar a primeira entrada concederia uma nova cota para cada
    // valor forjado.
    const headers = new Headers({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' })
    expect(clientIpFrom(headers)).toBe('203.0.113.7')
  })

  it('usa x-forwarded-for como alternativa quando falta o cabeçalho da plataforma', () => {
    vi.stubEnv('VERCEL', '1')
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9')
  })

  it('retorna null quando não há dados para usar', () => {
    expect(clientIpFrom(new Headers())).toBeNull()
  })

  it('recusa um valor de cabeçalho inválido ou grande demais', () => {
    vi.stubEnv('VERCEL', '1')
    expect(clientIpFrom(new Headers({ 'x-vercel-forwarded-for': 'not-an-ip' }))).toBeNull()
    expect(clientIpFrom(new Headers({ 'x-vercel-forwarded-for': '1'.repeat(100) }))).toBeNull()
  })

  it('trata IPv6', () => {
    vi.stubEnv('VERCEL', '1')
    expect(clientIpFrom(new Headers({ 'x-vercel-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1')
  })
})

describe('ipKey', () => {
  it('coloca chamadas sem identificação em um bucket compartilhado, em vez de liberá-las', () => {
    expect(ipKey('ns', null)).toBe(ipKey('ns', null))
    expect(ipKey('ns', null)).not.toBe(ipKey('ns', '1.2.3.4'))
  })
})

describe('consumeRateLimit', () => {
  beforeEach(() => {
    useAtomicStore()
  })

  it('permite até o limite e depois bloqueia', async () => {
    expect((await consumeRateLimit('b', POLICY)).allowed).toBe(true)
    expect((await consumeRateLimit('b', POLICY)).allowed).toBe(true)
    const third = await consumeRateLimit('b', POLICY)
    expect(third.allowed).toBe(true)
    expect(third.remaining).toBe(0)
    expect((await consumeRateLimit('b', POLICY)).allowed).toBe(false)
  })

  it('mantém bloqueado um bucket que atingiu o limite: requisições bloqueadas continuam sendo contabilizadas', async () => {
    for (let i = 0; i < 10; i += 1) await consumeRateLimit('b', POLICY)
    // Aguardar antes de uma requisição não deve restaurar nenhuma cota.
    expect((await consumeRateLimit('b', POLICY)).allowed).toBe(false)
  })

  it('reinicia ao atingir o limite da janela', async () => {
    const { clock } = useAtomicStore()

    for (let i = 0; i < 4; i += 1) await consumeRateLimit('b', POLICY)
    expect((await consumeRateLimit('b', POLICY)).allowed).toBe(false)

    clock.now += 60_000
    expect((await consumeRateLimit('b', POLICY)).allowed).toBe(true)
  })

  it('mantém os buckets independentes', async () => {
    for (let i = 0; i < 4; i += 1) await consumeRateLimit('one', POLICY)
    expect((await consumeRateLimit('two', POLICY)).allowed).toBe(true)
  })

  it('informa o tempo de espera restante dentro da janela', async () => {
    const result = await consumeRateLimit('b', POLICY)
    expect(result.retryAfterSeconds).toBeGreaterThan(0)
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(60)
  })
})

describe('atomicidade sob concorrência', () => {
  it('admite exatamente o limite quando 200 requisições disputam o mesmo bucket', async () => {
    useAtomicStore()

    const results = await Promise.all(
      Array.from({ length: 200 }, () => consumeRateLimit('hot', { limit: 5, windowMs: 60_000 }))
    )
    expect(results.filter((r) => r.allowed).length).toBe(5)
  })

  it('um armazenamento que lê e depois grava admite além do limite; por isso o contador usa uma única instrução', async () => {
    // Documenta a falha evitada pelo contador SQL. Se alguém algum dia
    // reescrever consume_rate_limit como SELECT seguido de UPDATE, é isso que acontece.
    _setRateLimitStore(() => racyStore())

    const results = await Promise.all(
      Array.from({ length: 200 }, () => consumeRateLimit('hot', { limit: 5, windowMs: 60_000 }))
    )
    expect(results.filter((r) => r.allowed).length).toBeGreaterThan(5)
  })
})

describe('falha de modo restritivo', () => {
  it('bloqueia quando o armazenamento retorna um erro', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    _setRateLimitStore(() => ({
      rpc: async () => ({ data: null, error: { message: 'connection refused' } }),
    }))

    const result = await consumeRateLimit('b', POLICY)
    expect(result.allowed).toBe(false)
    expect(result.degraded).toBe(true)
  })

  it('bloqueia quando o armazenamento lança uma exceção', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    _setRateLimitStore(() => ({
      rpc: async () => {
        throw new Error('conexão de socket encerrada')
      },
    }))

    const result = await consumeRateLimit('b', POLICY)
    expect(result.allowed).toBe(false)
    expect(result.degraded).toBe(true)
  })

  it('bloqueia quando o armazenamento retorna um formato inesperado', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    _setRateLimitStore(() => ({ rpc: async () => ({ data: { nope: true }, error: null }) }))

    const result = await consumeRateLimit('b', POLICY)
    expect(result.allowed).toBe(false)
    expect(result.degraded).toBe(true)
  })

  it('permite somente quando o ponto de chamada opta explicitamente por falhar de modo permissivo', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    _setRateLimitStore(() => ({
      rpc: async () => ({ data: null, error: { message: 'down' } }),
    }))

    const result = await consumeRateLimit('b', { ...POLICY, onStoreFailure: 'allow' })
    expect(result.allowed).toBe(true)
    expect(result.degraded).toBe(true)
  })

  it('todas as políticas distribuídas falham de modo restritivo', () => {
    for (const [name, policy] of Object.entries(RATE_LIMITS)) {
      expect(policy.onStoreFailure ?? 'deny', `${name} must fail closed`).toBe('deny')
    }
  })

  it('a consulta prévia também falha de modo restritivo', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    _setRateLimitStore(() => ({
      rpc: async () => ({ data: null, error: { message: 'down' } }),
    }))

    const result = await peekRateLimit('b', POLICY)
    expect(result.allowed).toBe(false)
  })
})

describe('peekRateLimit', () => {
  it('não consome a cota', async () => {
    useAtomicStore()

    for (let i = 0; i < 20; i += 1) await peekRateLimit('b', POLICY)
    expect((await consumeRateLimit('b', POLICY)).allowed).toBe(true)
  })

  it('informa um bloqueio vigente sem prolongá-lo', async () => {
    useAtomicStore()

    for (let i = 0; i < 3; i += 1) await consumeRateLimit('b', POLICY)
    expect((await peekRateLimit('b', POLICY)).allowed).toBe(false)
  })
})

describe('consumeRateLimits (layered)', () => {
  it('consome todas as camadas mesmo quando uma delas já bloqueia', async () => {
    useAtomicStore()

    // Esgota a camada por identificador.
    for (let i = 0; i < 5; i += 1) await consumeRateLimit('id', { limit: 2, windowMs: 60_000 })

    // Duas tentativas em camadas. Ambas são bloqueadas pela camada de ID, mas a camada de IP
    // ainda precisa ter contabilizado as duas, senão alternar o identificador
    // não custaria nada ao invasor.
    await consumeRateLimits([
      { bucket: 'id', policy: { limit: 2, windowMs: 60_000 } },
      { bucket: 'ip', policy: { limit: 3, windowMs: 60_000 } },
    ])
    await consumeRateLimits([
      { bucket: 'id', policy: { limit: 2, windowMs: 60_000 } },
      { bucket: 'ip', policy: { limit: 3, windowMs: 60_000 } },
    ])

    const ipOnly = await consumeRateLimit('ip', { limit: 3, windowMs: 60_000 })
    expect(ipOnly.allowed).toBe(true)
    expect(ipOnly.remaining).toBe(0)
  })

  it('bloqueia quando qualquer camada individual bloqueia', async () => {
    useAtomicStore()

    for (let i = 0; i < 3; i += 1) await consumeRateLimit('ip', { limit: 2, windowMs: 60_000 })

    const result = await consumeRateLimits([
      { bucket: 'id', policy: { limit: 100, windowMs: 60_000 } },
      { bucket: 'ip', policy: { limit: 2, windowMs: 60_000 } },
    ])
    expect(result.allowed).toBe(false)
    expect(result.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('não faz nada quando a lista de verificações está vazia', async () => {
    useAtomicStore()
    expect((await consumeRateLimits([])).allowed).toBe(true)
  })
})
