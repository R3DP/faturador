import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { _setRateLimitStore } from '@/lib/rate-limit'
import {
  EmailQuotaError,
  consumeEmailQuota,
  emailDailyLimit,
  emailQuotaBucket,
} from './quota'

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

/** Registra o que foi solicitado ao limitador e responde com uma cota fixa. */
function fakeStore(limitHit = false) {
  const calls: Record<string, unknown>[] = []
  _setRateLimitStore(() => ({
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      calls.push(args)
      return {
        data: [{ allowed: !limitHit, remaining: 0, retry_after_seconds: 7 * 3600 + 100 }],
        error: null,
      }
    },
  }))
  return calls
}

const ORIGINAL = {
  BILLR_EMAIL_DAILY_LIMIT: process.env.BILLR_EMAIL_DAILY_LIMIT,
}

beforeEach(() => setEnv({ ...ORIGINAL, BILLR_EMAIL_DAILY_LIMIT: undefined }))
afterEach(() => {
  _setRateLimitStore(null)
  setEnv(ORIGINAL)
})

describe('emailDailyLimit', () => {
  it('não aplica limite quando BILLR_EMAIL_DAILY_LIMIT não está definido', () => {
    expect(emailDailyLimit({} as NodeJS.ProcessEnv)).toBeNull()
  })

  it('respeita o valor definido na variável de ambiente', () => {
    setEnv({ BILLR_EMAIL_DAILY_LIMIT: '25' })
    expect(emailDailyLimit()).toBe(25)
  })

  it('ignora um valor que desativaria os e-mails silenciosamente', () => {
    for (const bad of ['0', '-5', 'abc', '2.5', '   ']) {
      setEnv({ BILLR_EMAIL_DAILY_LIMIT: bad })
      expect(emailDailyLimit()).toBeNull()
    }
  })
})

describe('consumeEmailQuota', () => {
  it('consome um envio por empresa por dia quando há um limite definido', async () => {
    setEnv({ BILLR_EMAIL_DAILY_LIMIT: '200' })
    const calls = fakeStore()
    await consumeEmailQuota('business-1')
    expect(calls).toEqual([
      {
        p_bucket: emailQuotaBucket('business-1'),
        p_limit: 200,
        p_window_seconds: 86400,
        p_cost: 1,
      },
    ])
  })

  it('mantém uma cota separada para cada empresa', async () => {
    setEnv({ BILLR_EMAIL_DAILY_LIMIT: '200' })
    const calls = fakeStore()
    await consumeEmailQuota('business-1')
    await consumeEmailQuota('business-2')
    expect(calls[0].p_bucket).not.toBe(calls[1].p_bucket)
  })

  it('nem sequer consulta o limitador quando não há limite', async () => {
    const calls = fakeStore()
    await consumeEmailQuota('business-1')
    expect(calls).toEqual([])
  })

  it('informa o tempo de espera em vez de falhar com uma mensagem genérica', async () => {
    setEnv({ BILLR_EMAIL_DAILY_LIMIT: '200' })
    fakeStore(true)
    await expect(consumeEmailQuota('business-1')).rejects.toThrow(
      'O limite diário de e-mails desta empresa foi atingido. A cota será renovada em cerca de 7 horas.'
    )
    await expect(consumeEmailQuota('business-1')).rejects.toBeInstanceOf(EmailQuotaError)
  })

  it('bloqueia o envio quando o armazenamento do limitador está inacessível', async () => {
    setEnv({ BILLR_EMAIL_DAILY_LIMIT: '200' })
    _setRateLimitStore(() => ({
      rpc: async () => ({ data: null, error: { message: 'banco de dados indisponível' } }),
    }))
    await expect(consumeEmailQuota('business-1')).rejects.toBeInstanceOf(EmailQuotaError)
  })
})
