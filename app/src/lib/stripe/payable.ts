import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { amountToMinorUnits } from '@/lib/stripe/money'

/**
 * Uma mensagem intencionalmente genérica para qualquer situação em que
 * não faremos a cobrança neste cartão. Quem paga é um visitante anônimo; por isso, o motivo não deve ser revelado.
 */
export const NOT_PAYABLE =
  'Esta fatura não pode ser paga online neste momento. Use as instruções de pagamento da fatura ou entre em contato com quem a enviou.'

const PAYABLE_COLUMNS =
  'id, business_id, invoice_number, status, currency, balance_due, stripe_payment_intent_id'

interface PayableInvoice {
  id: string
  business_id: string
  invoice_number: string
  status: string
  currency: string
  /** Valor pendente autoritativo do servidor, em unidades principais da moeda. */
  balanceDue: number
  stripe_payment_intent_id: string | null
}

export type PayableResult =
  | { ok: true; invoice: PayableInvoice }
  | { ok: false; status: number; error: string }

/**
 * Todas as verificações que precisam ser aprovadas antes de o Faturador cobrar
 * uma fatura pública. Busca a fatura pelo próprio public_id imprevisível (nunca
 * por um id interno fornecido por quem chama) e recalcula o valor a partir dessa
 * linha, em vez de confiar em qualquer dado enviado pelo navegador.
 */
export async function loadPayableInvoice(
  db: SupabaseClient<Database>,
  publicId: string,
): Promise<PayableResult> {
  const { data: invoice, error } = await db
    .from('invoices')
    .select(PAYABLE_COLUMNS)
    .eq('public_id', publicId)
    .maybeSingle()

  if (error) return { ok: false, status: 503, error: NOT_PAYABLE }
  if (!invoice) return { ok: false, status: 404, error: 'Fatura não encontrada.' }
  if (['draft', 'cancelled', 'paid'].includes(invoice.status))
    return { ok: false, status: 409, error: NOT_PAYABLE }

  const balanceDue = Number(invoice.balance_due)
  if (!(balanceDue > 0)) return { ok: false, status: 409, error: NOT_PAYABLE }
  try {
    amountToMinorUnits(balanceDue, invoice.currency)
  } catch {
    return { ok: false, status: 409, error: NOT_PAYABLE }
  }

  return {
    ok: true,
    invoice: {
      id: invoice.id,
      business_id: invoice.business_id,
      invoice_number: invoice.invoice_number,
      status: invoice.status,
      currency: invoice.currency,
      balanceDue,
      stripe_payment_intent_id: invoice.stripe_payment_intent_id ?? null,
    },
  }
}
