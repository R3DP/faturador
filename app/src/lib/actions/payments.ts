'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { correctionMessage } from '@/lib/payments/messages'
import { failure, type WriteResult } from './result'

/**
 * Registro, correção e anulação de pagamentos por server actions que validam
 * os dados antes de qualquer gravação. Consulte src/lib/actions/time.ts para
 * o mesmo formato aplicado aos lançamentos de trabalho.
 *
 * Cada chamada usa o próprio cliente Supabase de quem a iniciou. O RLS decide
 * a associação em record_payment_once, que é SECURITY INVOKER; nas duas
 * correções SECURITY DEFINER, a decisão cabe a resolve_payment_actor.
 *
 * Valores recebidos pelo Stripe não passam por aqui: o webhook os registra
 * com record_stripe_payment usando a função de serviço.
 */

const uuid = z.string().uuid()
/** TEXT no SQL, não uuid: as correções aceitam qualquer request id estável. */
const requestText = z.string().trim().min(1).max(200)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const amount = z.number().finite().positive().max(99999999)
const optionalText = z.string().trim().max(2000).nullish()

const recordInput = z.object({
  invoice_id: uuid,
  amount,
  payment_date: isoDate,
  payment_method: z.string().trim().min(1).max(50),
  reference_number: z.string().trim().max(200).nullish(),
  notes: optionalText,
})

export type RecordPaymentInput = z.input<typeof recordInput>

const updateInput = z.object({
  payment_date: isoDate.nullish(),
  method: z.string().trim().min(1).max(50).nullish(),
  notes: optionalText,
  reference_number: z.string().trim().max(200).nullish(),
  amount: amount.nullish(),
})

export type UpdatePaymentInput = z.input<typeof updateInput>

export async function recordPaymentAction(
  businessId: string,
  input: RecordPaymentInput,
  requestId: string,
): Promise<WriteResult> {
  try {
    const data = recordInput.parse(input)
    const supabase = await createClient()

    // O request id é criado uma vez por formulário e reutilizado em cada nova
    // tentativa, para que record_payment_once retorne o primeiro pagamento em
    // vez de registrar o mesmo valor duas vezes. business_id, client_id e
    // currency vêm da fatura dentro da RPC, nunca do navegador.
    const { error } = await supabase.rpc('record_payment_once', {
      p_request_id: uuid.parse(requestId),
      p_invoice_id: data.invoice_id,
      p_amount: data.amount,
      p_payment_date: data.payment_date,
      p_payment_method: data.payment_method,
      p_reference_number: data.reference_number || undefined,
      p_notes: data.notes || undefined,
      p_created_via: 'web',
    })
    if (error) return { error: correctionMessage(error.message, 'Não foi possível registrar esse pagamento.') }

    revalidatePath('/payments')
    revalidatePath(`/invoices/${data.invoice_id}`)
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (error) {
    return failure(error, 'Não foi possível registrar esse pagamento.')
  }
}

export async function updatePaymentAction(
  paymentId: string,
  input: UpdatePaymentInput,
  requestId: string,
): Promise<WriteResult> {
  try {
    const data = updateInput.parse(input)
    const supabase = await createClient()

    // Um request id por diálogo aberto, reutilizado a cada tentativa: update_payment
    // identifica a linha de auditoria por (payment_id, request_id), para que um
    // envio duplicado retorne a primeira resposta em vez de aplicar a alteração duas vezes.
    const { error } = await supabase.rpc('update_payment', {
      p_payment_id: uuid.parse(paymentId),
      p_request_id: requestText.parse(requestId),
      p_payment_date: data.payment_date || undefined,
      p_method: data.method || undefined,
      p_notes: data.notes || undefined,
      p_reference_number: data.reference_number || undefined,
      p_amount: data.amount ?? undefined,
    })
    if (error) return { error: correctionMessage(error.message, 'Não foi possível atualizar esse pagamento.') }

    revalidatePath('/payments')
    revalidatePath('/invoices')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (error) {
    return failure(error, 'Não foi possível atualizar esse pagamento.')
  }
}

export async function voidPaymentAction(
  paymentId: string,
  reason: string,
  requestId: string,
): Promise<WriteResult> {
  try {
    const voidReason = z.string().trim().min(1).max(2000).safeParse(reason)
    if (!voidReason.success) return { error: 'Informe um motivo para anular este pagamento.' }

    const supabase = await createClient()

    const { error } = await supabase.rpc('void_payment', {
      p_payment_id: uuid.parse(paymentId),
      p_request_id: requestText.parse(requestId),
      p_reason: voidReason.data,
    })
    if (error) return { error: correctionMessage(error.message, 'Não foi possível anular esse pagamento.') }

    revalidatePath('/payments')
    revalidatePath('/invoices')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (error) {
    return failure(error, 'Não foi possível anular esse pagamento.')
  }
}
