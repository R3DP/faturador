import { loadStripe } from '@stripe/stripe-js/pure'
import type { Stripe } from '@stripe/stripe-js'

/**
 * Stripe.js deve ser carregado uma única vez por chave publicável, e a promise
 * deve ser reutilizada: chamar loadStripe em cada renderização remontaria o
 * iframe do Elements e apagaria o que a pessoa pagadora digitou.
 */
const cache = new Map<string, Promise<Stripe | null>>()

export function loadStripeJs(publishableKey: string): Promise<Stripe | null> {
  let promise = cache.get(publishableKey)
  if (!promise) {
    promise = loadStripe(publishableKey)
    cache.set(publishableKey, promise)
  }
  return promise
}
