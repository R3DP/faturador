'use server'

import { calculateLineItemAmount, calculateInvoiceTotals } from '@/lib/utils/invoice'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'
import type { InvoiceStatus } from '@/types'
import { invoiceSchema } from '@/lib/validations/invoice'
import type { InvoiceFormData } from '@/lib/validations/invoice'
import { engagementErrorMessage } from '@/lib/engagements/errors'

/**
 * Cria uma fatura.
 *
 * engagementEntryIds fatura lançamentos da agenda de um contrato. As linhas
 * são montadas em SQL a partir do valor de cada lançamento, e ele é marcado
 * como faturado na MESMA transação. Assim, toda fatura criada tem seus
 * lançamentos marcados como faturados, e nenhum lançamento aparece em duas
 * faturas. Se qualquer parte da chamada for recusada, nada é marcado.
 */
export async function createInvoiceAction(
  businessId: string,
  input: InvoiceFormData,
  _status: 'draft' | 'sent' = 'draft',
  requestId: string,
  engagementEntryIds: string[] = []
) {
  const data = invoiceSchema.parse(input)
  const supabase = await createClient()
  const { data: invoice, error } = await supabase.rpc('create_invoice_document', {
    p_business_id: businessId, p_client_id: data.client_id,
    p_request_id: requestId,
    p_patch: { ...data, line_items: undefined },
    // Uma fatura composta somente por lançamentos de contrato não recebe linhas
    // explícitas; a RPC as monta e exige pelo menos uma.
    p_lines: data.line_items,
    p_engagement_entry_ids: engagementEntryIds,
  })
  if (error || !invoice) {
    // Recusas de contrato usam um código estável. Converta-o em uma mensagem
    // compreensível para pessoas e agentes, em vez de repassar um erro do Postgres.
    throw new Error(
      engagementErrorMessage(error?.message) || error?.message || 'Não foi possível criar a fatura'
    )
  }
  revalidatePath('/invoices')
  revalidatePath('/dashboard')
  revalidatePath('/engagements')
  return invoice as unknown as Database['public']['Tables']['invoices']['Row']
}

/**
 * Salva uma fatura editada.
 *
 * Toda a gravação é feita em uma única chamada a replace_invoice_line_items,
 * que executa a exclusão, a reinserção e a atualização dos totais na mesma
 * transação. Antes eram três chamadas sem verificação: se a reinserção falhasse,
 * a fatura ficava sem itens, mas ainda exibia um total, e nenhum dos resultados
 * era sequer inspecionado.
 *
 * balance_due não é mais enviado. A RPC o calcula como total - amount_paid,
 * evitando que a edição de uma fatura parcialmente paga apague os pagamentos registrados.
 */
export async function updateInvoiceAction(
  invoiceId: string,
  input: InvoiceFormData
) {
  const supabase = await createClient()

  const data = invoiceSchema.parse(input)
  data.line_items=data.line_items.map(calculateLineItemAmount)
  Object.assign(data,calculateInvoiceTotals(data.line_items,data.discount_type,data.discount_value,data.tax_rate,data.shipping_amount))
  const { data: invoice, error } = await supabase.rpc('replace_invoice_line_items', {
    p_invoice_id: invoiceId,
    p_line_items: data.line_items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      rate: item.rate,
      amount: item.amount,
      tax_rate: item.tax_rate,
      tax_amount: item.tax_amount,
      discount_percent: item.discount_percent,
      discount_amount: item.discount_amount,
    })),
    p_invoice_patch: {
      client_id: data.client_id,
      invoice_number: data.invoice_number,
      issue_date: data.issue_date,
      due_date: data.due_date,
      currency: data.currency,
      po_number: data.po_number || null,
      subtotal: data.subtotal,
      discount_type: data.discount_type,
      discount_value: data.discount_value,
      discount_amount: data.discount_amount,
      tax_rate: data.tax_rate,
      tax_amount: data.tax_amount,
      shipping_amount: data.shipping_amount,
      total: data.total,
      notes: data.notes || null,
      terms: data.terms || null,
      footer: data.footer || null,
      payment_instructions: data.payment_instructions || null,
      is_recurring: data.is_recurring,
      recurring_interval: data.recurring_interval || null,
      recurring_end_date: data.recurring_end_date || null,
    },
  })

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/invoices')
  revalidatePath(`/invoices/${invoiceId}`)
  return invoice
}

export async function deleteInvoiceAction(invoiceId: string) {
  const supabase = await createClient()

  // Permite excluir somente faturas em rascunho
  const { data: invoice } = await supabase
    .from('invoices')
    .select('status')
    .eq('id', invoiceId)
    .single()

  if (invoice?.status !== 'draft') {
    throw new Error('Só é possível excluir faturas em rascunho')
  }

  const { error } = await supabase
    .from('invoices')
    .delete()
    .eq('id', invoiceId)

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/invoices')
}

/**
 * Marca uma fatura em rascunho como enviada sem enviar um e-mail, para que a
 * pessoa responsável possa compartilhar o link público ou o PDF (ou caso não
 * tenha e-mail configurado). Um rascunho não tem página pública nem entra nos
 * totais do cliente; uma fatura enviada, sim. Apenas rascunhos são alterados, e
 * o RLS restringe a operação a membros. Se a fatura já saiu do rascunho, nada
 * muda e o status atual é retornado, tornando um clique repetido inofensivo.
 */
export async function markInvoiceSentAction(invoiceId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('invoices')
    .update({ status: 'sent' })
    .eq('id', invoiceId)
    .eq('status', 'draft')
    .select('id')

  if (error) {
    throw new Error(error.message)
  }
  if (!data?.length) {
    // Já saiu do rascunho: pode ser um clique repetido ou uma página aberta antes de
    // o envio do documento. Informa o status atual em vez de falhar.
    const { data: current, error: readError } = await supabase
      .from('invoices')
      .select('status')
      .eq('id', invoiceId)
      .maybeSingle()
    if (readError) {
      throw new Error(readError.message)
    }
    if (!current) {
      throw new Error('Fatura não encontrada')
    }
    // A restrição CHECK do status da fatura corresponde a InvoiceStatus.
    return { changed: false, status: current.status as InvoiceStatus }
  }

  revalidatePath('/invoices')
  revalidatePath(`/invoices/${invoiceId}`)
  revalidatePath('/dashboard')
  return { changed: true, status: 'sent' as const }
}
