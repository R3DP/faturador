'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { sendInvoiceEmail } from '@/lib/invoices/send-email'
import { sendEstimateEmail } from '@/lib/estimates/send-email'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function parseEmailList(input: string | undefined, label: string): string[] {
  if (!input?.trim()) return []
  const emails = input.split(',').map((e) => e.trim()).filter(Boolean)
  if (emails.length > 10) throw new Error(`São permitidos no máximo 10 destinatários ${label}`)
  for (const e of emails) {
    if (!EMAIL_RE.test(e)) throw new Error(`Endereço ${label} inválido: ${e}`)
  }
  return emails
}

export interface SendInvoiceOptions {
  requestId: string
  to: string
  cc?: string
  bcc?: string
  subject?: string
  message?: string
}

async function sendDocumentAction(
  invoiceId: string,
  options: SendInvoiceOptions,
  kind: 'invoice' | 'estimate'
): Promise<{ success: boolean; error?: string; to?: string }> {
  try {
    if ((options.subject?.length ?? 0) > 200 || (options.message?.length ?? 0) > 2000) throw new Error('O assunto ou a mensagem é longo demais')
    if (!process.env.RESEND_API_KEY) {
      throw new Error('O e-mail não está configurado (RESEND_API_KEY ausente)')
    }
    if (!options.to || !EMAIL_RE.test(options.to.trim())) {
      throw new Error('Informe um endereço de e-mail válido para o destinatário')
    }
    const to = options.to.trim()
    const cc = parseEmailList(options.cc, 'Cc')
    const bcc = parseEmailList(options.bcc, 'Bcc')

    // O RLS limita a operação às faturas acessíveis à pessoa autenticada
    const supabase = await createClient()

    const sender = kind === 'invoice' ? sendInvoiceEmail : sendEstimateEmail
    const result = await sender(supabase, invoiceId, {
      requestId: options.requestId,
      to,
      cc,
      bcc,
      subject: options.subject,
      message: options.message,
    })

    revalidatePath(`/${kind}s`)
    revalidatePath(`/${kind}s/${invoiceId}`)
    return { success: true, to: result.to }
  } catch (err) {
    // Retorna a mensagem para que o cliente possa exibi-la: erros lançados por
    // server actions são ocultados em produção
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Falha ao enviar a fatura',
    }
  }
}

export async function sendInvoiceAction(invoiceId: string, options: SendInvoiceOptions) {
  return sendDocumentAction(invoiceId, options, 'invoice')
}

export async function sendEstimateAction(estimateId: string, options: SendInvoiceOptions) {
  return sendDocumentAction(estimateId, options, 'estimate')
}
