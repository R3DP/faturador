import 'server-only'
import { prepareDelivery, finishDelivery } from '@/lib/email/delivery'
import { EmailQuotaError } from '@/lib/email/quota'
import { Resend } from 'resend'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { buildInvoicePdfData, renderInvoicePdf } from '@/lib/pdf/invoice-pdf'
import { stripePaymentsConfigured } from '@/lib/stripe/config'
import { appUrl } from '@/lib/mcp/shared'
import { parseDay } from '@/lib/dates'
import { formatFromAddress, invoiceFromEmail } from '@/lib/email/from'
import { safeSubject } from '@/lib/email/subject'

/**
 * Lógica compartilhada de envio de e-mails de faturas. Extraída da server
 * action web "Enviar fatura" (src/lib/actions/send-invoice.ts) para também
 * ser usada pela ferramenta MCP send_invoice (src/lib/mcp/tools/invoices-send.ts).
 * Contém tudo entre "buscar a fatura" e "avançar o status": busca de
 * relações, corpo do e-mail em HTML, anexo PDF (via renderInvoicePdf), envio
 * pelo Resend e avanço do status de rascunho para enviado, além da atualização
 * de last_sent_at.
 *
 * CONTRATO DO BANCO (leia antes de chamar): o parâmetro `db` é usado tanto
 * para buscar a fatura quanto para atualizar seu status ao final. Esta função
 * NÃO verifica autorização nem escopo por conta própria; confia que quem
 * chama já verificou o acesso a `invoiceId` por meio do cliente fornecido.
 *   - A server action web usa um cliente autenticado por cookie (`createClient()`
 *     de '@/lib/supabase/server'); o RLS limita naturalmente a busca da fatura
 *     ao usuário conectado, sem precisar de uma verificação adicional.
 *   - A ferramenta MCP DEVE usar `ctx.db.svc` (cliente service-role) somente
 *     APÓS chamar `ctx.db.assertInvoiceAccess(invoiceId)`. Sem essa verificação
 *     prévia, quem chama poderia enviar um e-mail e alterar o status de uma
 *     fatura fora do escopo da sua chave de API, pois o cliente service-role
 *     ignora completamente o RLS.
 *
 * CONTRATO DE ENTRADA: presume-se que `opts.to`/`opts.cc`/`opts.bcc` já sejam
 * endereços de e-mail validados e aparados. Esta função não valida novamente
 * o formato nem verifica a presença de RESEND_API_KEY além da proteção abaixo.
 * Espera-se que quem chama já tenha analisado as opções (a server action web
 * pelas verificações EMAIL_RE e a ferramenta MCP pelo esquema Zod) antes
 * de chamar esta função.
 */

export type SendInvoiceEmailErrorCode =
  | 'not_configured'
  | 'invoice_not_found'
  | 'send_failed'
  /** A empresa esgotou sua cota diária de envios de e-mail. */
  | 'quota_exceeded'

export class SendInvoiceEmailError extends Error {
  code: SendInvoiceEmailErrorCode
  constructor(code: SendInvoiceEmailErrorCode, message: string) {
    super(message)
    this.name = 'SendInvoiceEmailError'
    this.code = code
  }
}

export interface SendInvoiceEmailOptions {
  requestId: string
  to: string
  cc?: string[]
  bcc?: string[]
  subject?: string
  message?: string
}

export interface SendInvoiceEmailResult {
  sent: true
  to: string
}

const formatCurrency = (amount: number, currency = 'USD') =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount)

const formatDate = (date: string) =>
  parseDay(date).toLocaleDateString('pt-BR', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// business.primary_color é controlado pelo usuário e interpolado em um atributo
// de estilo; permita apenas uma cor hexadecimal estrita, caso contrário use o azul da marca.
const safeHexColor = (c: string | null | undefined) =>
  typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#2563eb'

// O nome de exibição From vai para um cabeçalho de e-mail: remova CR/LF (
// injeção de cabeçalho) e sinais de menor/maior (que delimitam o endereço).
const safeDisplayName = (s: string) => s.replace(/[\r\n<>]/g, '').trim()

export async function sendInvoiceEmail(
  db: SupabaseClient<Database>,
  invoiceId: string,
  opts: SendInvoiceEmailOptions,
): Promise<SendInvoiceEmailResult> {
  if (!process.env.RESEND_API_KEY) {
    throw new SendInvoiceEmailError(
      'not_configured',
      'O e-mail não está configurado (RESEND_API_KEY ausente)',
    )
  }

  const to = opts.to.trim()
  const cc = opts.cc ?? []
  const bcc = opts.bcc ?? []

  const { data: invoice, error } = await db
    .from('invoices')
    .select(
      `*, client:clients(*), line_items:invoice_line_items(*), business:businesses(*)`,
    )
    .eq('id', invoiceId)
    .single()

  if (error || !invoice) {
    throw new SendInvoiceEmailError('invoice_not_found', 'Fatura não encontrada')
  }

  if (invoice.status === 'cancelled')
    throw new SendInvoiceEmailError(
      'send_failed',
      'Documentos cancelados não podem ser enviados',
    )
  const business =
    invoice.business_snapshot && typeof invoice.business_snapshot === 'object'
      ? ({
          ...invoice.business,
          ...invoice.business_snapshot,
        } as typeof invoice.business)
      : invoice.business
  const publicUrl = `${appUrl()}/i/${invoice.public_id}`
  const paymentsEnabled = stripePaymentsConfigured()
  const from = formatFromAddress(
    safeDisplayName(business?.name || 'Faturador') || 'Faturador',
    invoiceFromEmail(),
  )
  const amountDue = invoice.balance_due ?? invoice.total
  // Cabeçalho sanitizado ao montar o assunto, e não no transporte.
  const subject = safeSubject(
    opts.subject,
    `Fatura ${invoice.invoice_number} de ${business?.name || 'Faturador'}`,
  )

  const lineRows = (invoice.line_items || [])
    .sort(
      (a: { sort_order: number }, b: { sort_order: number }) =>
        a.sort_order - b.sort_order,
    )
    .map(
      (li: { description: string; amount: number }) => `
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #eee;">${escapeHtml(li.description)}</td>
            <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">${formatCurrency(li.amount, invoice.currency)}</td>
          </tr>`,
    )
    .join('')

  const messageBlock = opts.message
    ? `<p style="margin:0 0 24px;white-space:pre-wrap;">${escapeHtml(opts.message)}</p>`
    : ''

  const html = `
    <div style="background:#f6f7f9;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
        <h2 style="margin:0 0 4px;font-size:20px;">${escapeHtml(business?.name || '')}</h2>
        <p style="margin:0 0 24px;color:#666;">Fatura ${escapeHtml(invoice.invoice_number)}</p>
        ${messageBlock}
        <div style="background:#f6f7f9;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0;color:#666;font-size:13px;">Valor devido</p>
          <p style="margin:4px 0 0;font-size:28px;font-weight:700;">${formatCurrency(amountDue, invoice.currency)}</p>
          <p style="margin:8px 0 0;color:#666;font-size:13px;">Vencimento: ${formatDate(invoice.due_date)}</p>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">${lineRows}</table>
        ${
          paymentsEnabled
            ? `<a href="${publicUrl}" style="display:block;background:${safeHexColor(business?.primary_color)};color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:8px;font-weight:600;margin-bottom:12px;">Pagar on-line</a>
        <a href="${publicUrl}" style="display:block;background:#fff;color:${safeHexColor(business?.primary_color)};text-decoration:none;text-align:center;padding:12px;border-radius:8px;font-weight:600;border:1px solid #e5e5e5;">Ver fatura</a>`
            : `<a href="${publicUrl}" style="display:block;background:${safeHexColor(business?.primary_color)};color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:8px;font-weight:600;">Ver fatura</a>`
        }
        <p style="margin:24px 0 0;color:#999;font-size:12px;text-align:center;">Enviado por <a href="${appUrl()}" style="color:#999;">Faturador</a></p>
      </div>
    </div>`

  // Anexa o mesmo PDF disponibilizado pelos botões de download
  const pdf = await renderInvoicePdf(
    buildInvoicePdfData(
      invoice,
      invoice.line_items,
      business,
      invoice.client,
      paymentsEnabled,
    ),
    business?.logo_url,
  )

  const resend = new Resend(process.env.RESEND_API_KEY)
  const payload = {
    from,
    to,
    cc: cc.length ? cc : undefined,
    bcc: bcc.length ? bcc : undefined,
    replyTo: business?.email || undefined,
    subject,
    html,
    attachments: [
      {
        filename: `${invoice.invoice_number}.pdf`,
        content: pdf.toString('base64'),
      },
    ],
  }
  // A cota diária de envios é verificada em prepareDelivery, cobrindo as
  // duas interfaces com uma única checagem. O erro é relançado com um tipo
  // específico, pois a ferramenta de envio do MCP só repassa esta classe; um
  // Error simples chegaria ao agente como falha genérica, sem indicar que deve aguardar.
  let delivery
  try {
    delivery = await prepareDelivery(
      db,
      invoice.business_id,
      invoiceId,
      'invoice',
      opts.requestId,
      {
        to,
        cc,
        bcc,
        subject,
        message: opts.message || '',
        document_id: invoiceId,
      },
      payload,
    )
  } catch (err) {
    if (err instanceof EmailQuotaError) throw new SendInvoiceEmailError('quota_exceeded', err.message)
    throw err
  }
  if (delivery.alreadySent) return { sent: true, to }
  const { error: sendError } = await resend.emails.send(delivery.payload, {
    idempotencyKey: delivery.key,
  })

  if (sendError) {
    throw new SendInvoiceEmailError(
      'send_failed',
      `Falha ao enviar o e-mail: ${sendError.message}`,
    )
  }

  const { error: stampError } = await db
    .from('invoices')
    .update({ last_sent_at: new Date().toISOString() })
    .eq('id', invoiceId)
  if (stampError)
    throw new Error(
      'E-mail aceito, mas não foi possível salvar o status. Tente novamente usando o mesmo ID de solicitação.',
    )
  const { error: statusError } = await db
    .from('invoices')
    .update({ status: 'sent' })
    .eq('id', invoiceId)
    .eq('status', 'draft')
  if (statusError)
    throw new Error(
      'E-mail aceito, mas não foi possível salvar o status. Tente novamente usando o mesmo ID de solicitação.',
    )
  await finishDelivery(db, invoice.business_id, opts.requestId)

  return { sent: true, to }
}
