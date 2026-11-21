import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/client'
import { createServiceClient } from '@/lib/supabase/service'
import { reconcileEvent } from '@/lib/stripe/reconcile'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const signature = request.headers.get('stripe-signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET

  if (!signature || !secret) {
    return NextResponse.json({ error: 'Assinatura ausente.' }, { status: 400 })
  }

  // A verificação da assinatura precisa do corpo bruto exato da requisição - nunca
  // use JSON.parse antes de constructEvent, pois serializar novamente não
  // reproduziria os mesmos bytes assinados pelo Stripe.
  const rawBody = await request.text()

  let event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret)
  } catch (err) {
    // Nunca registre o corpo bruto, a assinatura ou o segredo - apenas que a verificação falhou.
    console.error('stripe webhook: falha na verificação da assinatura', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Assinatura inválida.' }, { status: 400 })
  }

  const service = createServiceClient()

  const { data: processed, error: readError } = await service
    .from('stripe_events')
    .select('id')
    .eq('id', event.id)
    .maybeSingle()
  if (readError) {
    return NextResponse.json({ error: 'Não foi possível verificar o status do evento.' }, { status: 503 })
  }
  if (processed) {
    return NextResponse.json({ received: true, duplicate: true })
  }

  try {
    await reconcileEvent(service, event)
  } catch (err) {
    console.error('stripe webhook: falha na conciliação', event.type, err instanceof Error ? err.message : err)
    // Nenhum marcador de conclusão é gravado, então a nova tentativa automática do Stripe
    // reconcilia o evento novamente, em vez de considerá-lo processado.
    return NextResponse.json({ error: 'Falha na conciliação.' }, { status: 500 })
  }

  const { error: finishError } = await service
    .from('stripe_events')
    .insert({ id: event.id, type: event.type })
  if (finishError && finishError.code !== '23505') {
    return NextResponse.json({ error: 'Não foi possível concluir o evento.' }, { status: 503 })
  }
  return NextResponse.json({ received: true })
}
