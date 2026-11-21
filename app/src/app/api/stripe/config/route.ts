import { stripePaymentsConfigured } from '@/lib/stripe/config'

export const dynamic = 'force-dynamic'

/** Indica se o pagamento com cartão está disponível nesta instalação. Nunca expõe valores de chaves. */
export async function GET() {
  return Response.json(
    { available: stripePaymentsConfigured() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
