import 'server-only'
import Stripe from 'stripe'

let client: Stripe | undefined

function getStripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY?.trim()
    if (!key) throw new Error('Os pagamentos com Stripe não estão configurados')
    client = new Stripe(key)
  }
  return client
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, property) {
    const sdk = getStripe()
    const value = Reflect.get(sdk, property)
    return typeof value === 'function' ? value.bind(sdk) : value
  },
})
