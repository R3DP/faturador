import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /api/stripe/config', () => {
  it('informa que o pagamento com cartão está disponível quando as três chaves estão definidas e são compatíveis', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_example')
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_test_example')
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_example')
    const response = await GET()
    expect(await response.json()).toEqual({ available: true })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('informa apenas que está indisponível quando falta uma chave', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_example')
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', '')
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '')
    expect(await (await GET()).json()).toEqual({ available: false })
  })
})
