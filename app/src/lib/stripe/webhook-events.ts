/**
 * Eventos Stripe necessários ao webhook do Faturador. Configure o endpoint em
 * /api/stripe/webhook para enviar exatamente estes eventos.
 */
export const STRIPE_WEBHOOK_EVENTS = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
  'charge.dispute.created',
] as const
