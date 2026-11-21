import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { z } from 'zod'
import { stripe } from '@/lib/stripe/client'
import { stripePaymentsConfigured } from '@/lib/stripe/config'
import { amountToMinorUnits } from '@/lib/stripe/money'
import { NOT_PAYABLE, loadPayableInvoice } from '@/lib/stripe/payable'
import { buildPaymentIntentParams, decidePaymentIntentReuse } from '@/lib/stripe/payment-intent'
import { RATE_LIMITS, clientIpFrom, consumeRateLimits, ipKey, rateLimitKey } from '@/lib/rate-limit'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'

const bodySchema = z.object({ public_id: z.string().min(1).max(64) })

function unavailable(status: number, error = NOT_PAYABLE) {
  return NextResponse.json({ error, unavailable: true }, { status })
}

/**
 * Cria ou reutiliza com segurança a PaymentIntent por trás do formulário de cartão
 * da página pública da fatura. As cobranças são feitas na própria conta Stripe
 * desta instalação. Qualquer situação que não possa ser resolvida com segurança retorna
 * `unavailable: true`, e a página exibe as instruções de pagamento da fatura.
 */
export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'O parâmetro public_id é obrigatório.' }, { status: 400 })
  }
  const { public_id } = parsed.data

  if (!stripePaymentsConfigured()) return unavailable(503)

  // Durável e em camadas: por fatura, para evitar excesso de requisições a um link, e por IP,
  // para impedir que uma origem percorra vários links. Em caso de falha, bloqueia: este endpoint
  // sem autenticação cria objetos Stripe.
  const ip = clientIpFrom(request.headers)
  const limited = await consumeRateLimits([
    { bucket: rateLimitKey('pay:intent', public_id), policy: RATE_LIMITS.publicDocument },
    { bucket: ipKey('pay:intent:ip', ip), policy: RATE_LIMITS.publicDocumentIp },
  ])
  if (!limited.allowed) {
    return NextResponse.json(
      { error: 'Muitas tentativas. Aguarde um momento e tente novamente.' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } },
    )
  }

  const service = createServiceClient()
  const payable = await loadPayableInvoice(service, public_id)
  if (!payable.ok) return unavailable(payable.status, payable.error)
  const { invoice } = payable
  const amount = amountToMinorUnits(invoice.balanceDue, invoice.currency)

  // Reutilize a intenção de pagamento da fatura quando possível, para que recarregamentos não
  // deixem intenções abandonadas na conta e para que o ID usado em reembolsos e
  // contestações permaneça estável. Se um ID salvo não existir mais
  // (as chaves foram trocadas de conta ou modo), comece novamente; qualquer outro erro
  // interrompe o processo, pois tentar adivinhar poderia gerar uma segunda cobrança.
  let existing: Stripe.PaymentIntent | null = null
  if (invoice.stripe_payment_intent_id) {
    try {
      existing = await stripe.paymentIntents.retrieve(invoice.stripe_payment_intent_id)
    } catch (err) {
      if ((err as { code?: string }).code !== 'resource_missing') {
        console.error('stripe payment-intent: não foi possível verificar a tentativa anterior', err)
        return unavailable(502, 'Não foi possível verificar a tentativa de pagamento anterior. Tente novamente.')
      }
    }
  }

  let decision = decidePaymentIntentReuse(existing, amount, invoice.currency)
  if (decision === 'already_paid' && existing?.status === 'succeeded') {
    // Depois que o webhook registrar o pagamento, um saldo ainda exibido representa
    // um novo valor devido (o total foi aumentado depois), não a mesma cobrança
    // em duplicidade. Inicie uma nova tentativa; a chave de idempotência identifica a intenção anterior.
    const { data: booked, error } = await service
      .from('payments')
      .select('id')
      .eq('invoice_id', invoice.id)
      .eq('stripe_payment_id', existing.id)
      .maybeSingle()
    if (error) {
      console.error('stripe payment-intent: não foi possível consultar o livro de pagamentos', error.message)
      return unavailable(503, 'Não foi possível verificar a tentativa de pagamento anterior. Tente novamente.')
    }
    if (booked) decision = 'create'
  }
  if (decision === 'already_paid') {
    // A cobrança foi concluída, mas o webhook ainda não chegou. Um novo
    // formulário faria com que alguém que recarregasse a página fosse cobrado duas vezes.
    return NextResponse.json(
      { error: 'Este pagamento já foi processado. Estamos confirmando a transação.', status: 'processing' },
      { status: 409 },
    )
  }

  let intent: Stripe.PaymentIntent
  try {
    if (decision === 'reuse' && existing) {
      intent = existing
    } else if (decision === 'update' && existing) {
      intent = await stripe.paymentIntents.update(existing.id, { amount })
    } else {
      intent = await stripe.paymentIntents.create(
        buildPaymentIntentParams({
          currency: invoice.currency,
          invoiceNumber: invoice.invoice_number,
          balanceDue: invoice.balanceDue,
          invoiceId: invoice.id,
          businessId: invoice.business_id,
          publicId: public_id,
        }),
        {
          idempotencyKey: `billr:${invoice.id}:${existing?.id ?? 'initial'}:${invoice.currency}:${amount}`,
        },
      )
    }
  } catch (err) {
    console.error('stripe payment-intent: falha ao criar ou atualizar', err)
    return unavailable(502)
  }

  if (!intent.client_secret) {
    console.error('stripe payment-intent: PaymentIntent sem client_secret', intent.id)
    return unavailable(502)
  }

  if (intent.id !== invoice.stripe_payment_intent_id) {
    // Uma nova tentativa limpa o resultado da anterior. O ID precisa ser
    // salvo antes de a pessoa pagar: reembolsos e contestações usam esse ID. A
    // chave de idempotência acima faz uma nova tentativa retornar a mesma intenção.
    const { error } = await service
      .from('invoices')
      .update({ stripe_payment_intent_id: intent.id, stripe_payment_status: null })
      .eq('id', invoice.id)
    if (error) {
      console.error('stripe payment-intent: não foi possível salvar a tentativa', error.message)
      return unavailable(503, 'Não foi possível iniciar o pagamento. Tente novamente.')
    }
  }

  return NextResponse.json({
    client_secret: intent.client_secret,
    publishable_key: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim(),
    amount,
    currency: invoice.currency,
  })
}
