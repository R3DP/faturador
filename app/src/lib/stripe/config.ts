import 'server-only'

/**
 * Os pagamentos com cartão usam a própria conta Stripe desta instalação,
 * configurada exclusivamente por três variáveis de ambiente. Nenhum dado da
 * Stripe fica no banco de dados, e uma única conta atende todas as empresas
 * desta instalação.
 */
const STRIPE_ENV_KEYS = [
  'STRIPE_SECRET_KEY',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'STRIPE_WEBHOOK_SECRET',
] as const

type StripeEnvKey = (typeof STRIPE_ENV_KEYS)[number]
type StripeMode = 'test' | 'live'
export type StripeSetup =
  | { configured: true; mode: StripeMode }
  | { configured: false; missing: StripeEnvKey[]; problem: string | null }

type StripeEnv = Partial<Record<StripeEnvKey, string | undefined>>

function readStripeEnv(): StripeEnv {
  // Declaradas uma a uma: o Next.js só incorpora valores NEXT_PUBLIC_ que consegue identificar.
  return {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  }
}

function keyMode(value: string, prefixes: string[]): StripeMode | null {
  for (const prefix of prefixes) {
    if (value.startsWith(`${prefix}_test_`)) return 'test'
    if (value.startsWith(`${prefix}_live_`)) return 'live'
  }
  return null
}

function off(problem: string): StripeSetup {
  return { configured: false, missing: [], problem }
}

/** Informa se os pagamentos com cartão estão ativos e, se não estiverem, o motivo exato. Nunca retorna uma chave. */
export function stripeSetup(env: StripeEnv = readStripeEnv()): StripeSetup {
  const value = (key: StripeEnvKey) => env[key]?.trim() ?? ''
  const missing = STRIPE_ENV_KEYS.filter((key) => !value(key))
  if (missing.length) return { configured: false, missing, problem: null }

  const secretMode = keyMode(value('STRIPE_SECRET_KEY'), ['sk', 'rk'])
  if (!secretMode)
    return off('STRIPE_SECRET_KEY deve começar com sk_test_, sk_live_, rk_test_ ou rk_live_.')
  const publishableMode = keyMode(value('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'), ['pk'])
  if (!publishableMode)
    return off('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY deve começar com pk_test_ ou pk_live_.')
  if (secretMode !== publishableMode)
    return off(
      'A chave secreta e a chave publicável estão em modos diferentes (uma de teste e outra de produção). Use um par correspondente.',
    )
  if (!value('STRIPE_WEBHOOK_SECRET').startsWith('whsec_'))
    return off('STRIPE_WEBHOOK_SECRET deve começar com whsec_ (o segredo de assinatura do endpoint).')
  return { configured: true, mode: secretMode }
}

export function stripePaymentsConfigured(env?: StripeEnv): boolean {
  return stripeSetup(env).configured
}
