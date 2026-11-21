import { afterEach, describe, expect, it, vi } from 'vitest'
import { stripePaymentsConfigured, stripeSetup } from './config'

const TEST = {
  STRIPE_SECRET_KEY: 'sk_test_example',
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_example',
  STRIPE_WEBHOOK_SECRET: 'whsec_example',
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('stripeSetup', () => {
  it('está configurado no modo de teste com o par de chaves correspondente e um segredo de webhook', () => {
    expect(stripeSetup(TEST)).toEqual({ configured: true, mode: 'test' })
  })

  it('está configurado no modo de produção com o par de chaves correspondente', () => {
    expect(
      stripeSetup({
        STRIPE_SECRET_KEY: 'sk_live_example',
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_example',
        STRIPE_WEBHOOK_SECRET: 'whsec_example',
      }),
    ).toEqual({ configured: true, mode: 'live' })
  })

  it('aceita uma chave secreta restrita', () => {
    expect(stripeSetup({ ...TEST, STRIPE_SECRET_KEY: 'rk_test_example' })).toEqual({
      configured: true,
      mode: 'test',
    })
  })

  it('indica todas as variáveis ausentes', () => {
    expect(stripeSetup({})).toEqual({
      configured: false,
      missing: ['STRIPE_SECRET_KEY', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET'],
      problem: null,
    })
  })

  it('considera ausente um valor que contém somente espaços', () => {
    expect(stripeSetup({ ...TEST, STRIPE_WEBHOOK_SECRET: '   ' })).toEqual({
      configured: false,
      missing: ['STRIPE_WEBHOOK_SECRET'],
      problem: null,
    })
  })

  it('recusa uma chave secreta de teste com uma chave publicável de produção', () => {
    expect(stripeSetup({ ...TEST, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_example' })).toMatchObject({
      configured: false,
      missing: [],
      problem: expect.stringMatching(/modos diferentes/),
    })
  })

  it('recusa uma chave publicável inserida no campo da chave secreta', () => {
    expect(stripeSetup({ ...TEST, STRIPE_SECRET_KEY: 'pk_test_example' })).toMatchObject({
      configured: false,
      problem: expect.stringMatching(/STRIPE_SECRET_KEY deve começar com/),
    })
  })

  it('recusa uma chave publicável com prefixo desconhecido', () => {
    expect(stripeSetup({ ...TEST, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'test_example' })).toMatchObject({
      configured: false,
      problem: expect.stringMatching(/NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY deve começar com/),
    })
  })

  it('recusa um segredo de webhook que não seja um segredo de assinatura', () => {
    expect(stripeSetup({ ...TEST, STRIPE_WEBHOOK_SECRET: 'sk_test_example' })).toMatchObject({
      configured: false,
      problem: expect.stringMatching(/whsec_/),
    })
  })

  it('lê o ambiente do processo por padrão', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', TEST.STRIPE_SECRET_KEY)
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', TEST.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', TEST.STRIPE_WEBHOOK_SECRET)
    expect(stripePaymentsConfigured()).toBe(true)
  })
})

describe('stripePaymentsConfigured', () => {
  it('responde sim ou não para chamadas que precisam somente dessa informação', () => {
    expect(stripePaymentsConfigured(TEST)).toBe(true)
    expect(stripePaymentsConfigured({})).toBe(false)
  })
})
