import 'server-only'
import { prepareDelivery, finishDelivery } from '@/lib/email/delivery'
import { EmailQuotaError } from '@/lib/email/quota'
import { Resend } from 'resend'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { appUrl } from '@/lib/mcp/shared'
import { parseDay } from '@/lib/dates'
import { formatFromAddress, invoiceFromEmail } from '@/lib/email/from'
import { safeSubject } from '@/lib/email/subject'

/**
 * Lógica compartilhada de envio de e-mails de orçamentos, baseada diretamente
 * em src/lib/invoices/send-email.ts (mesmo tratamento de From/reply-to, mesmas
 * regras de escape e avanço de status que só tira o rascunho dessa etapa).
 *
 * Diferença em relação à versão de faturas: este código não tem um gerador de
 * PDF para orçamentos (src/lib/pdf contém apenas invoice-pdf.tsx); por isso,
 * o e-mail inclui os itens em linha e um link para a página pública do orçamento,
 * onde o cliente pode aceitá-lo ou recusá-lo. Nada é simulado: sem configuração
 * do Resend, a chamada falha explicitamente em vez de informar um envio que não
 * aconteceu.
 *
 * CONTRATO DO BANCO (leia antes de chamar): `db` é usado tanto para buscar o
 * orçamento quanto para atualizar o status, e esta função NÃO verifica a
 * autorização por conta própria. Quem passar o cliente service-role (a ferramenta
 * MCP) DEVE chamar ctx.db.assertEstimateAccess(estimateId) antes, pois esse
 * cliente ignora completamente o RLS.
 */

export type SendEstimateEmailErrorCode =
  | 'not_configured'
  | 'estimate_not_found'
  | 'send_failed'
  /** A empresa esgotou sua cota diária de envios de e-mail. */
  | 'quota_exceeded'

export class SendEstimateEmailError extends Error {
  code: SendEstimateEmailErrorCode
  constructor(code: SendEstimateEmailErrorCode, message: string) {
    super(message)
    this.name = 'SendEstimateEmailError'
    this.code = code
  }
}

export interface SendEstimateEmailOptions {
  requestId: string
  to: string
  cc?: string[]
  bcc?: string[]
  subject?: string
  message?: string
}

export interface SendEstimateEmailResult {
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

// O nome de exibição From vai para um cabeçalho de e-mail: remova CR/LF
// (injeção de cabeçalho) e sinais de menor/maior (que delimitam o endereço).
const safeDisplayName = (s: string) => s.replace(/[\r\n<>]/g, '').trim()

export async function sendEstimateEmail(
  db: SupabaseClient<Database>,
  estimateId: string,
  opts: SendEstimateEmailOptions,
): Promise<SendEstimateEmailResult> {
  if (!process.env.RESEND_API_KEY) {
    throw new SendEstimateEmailError(
      'not_configured',
      'O e-mail não está configurado (RESEND_API_KEY ausente)',
    )
  }

  const to = opts.to.trim()
  const cc = opts.cc ?? []
  const bcc = opts.bcc ?? []

  const { data: estimate, error } = await db
    .from('estimates')
    .select(
      `*, client:clients(*), line_items:estimate_line_items(*), business:businesses(*)`,
    )
    .eq('id', estimateId)
    .single()

  if (error || !estimate) {
    throw new SendEstimateEmailError('estimate_not_found', 'Orçamento não encontrado')
  }

  if (['declined', 'expired', 'converted'].includes(estimate.status))
    throw new SendEstimateEmailError(
      'send_failed',
      'Este orçamento não pode ser enviado no status atual',
    )
  const business =
    estimate.business_snapshot && typeof estimate.business_snapshot === 'object'
      ? ({
          ...estimate.business,
          ...estimate.business_snapshot,
        } as typeof estimate.business)
      : estimate.business
  const publicEstimateUrl = `${appUrl()}/e/${estimate.public_id}`
  // Os e-mails enviados a clientes usam RESEND_INVOICE_FROM. Consulte src/lib/email/from.ts.
  const from = formatFromAddress(
    safeDisplayName(business?.name || 'Faturador') || 'Faturador',
    invoiceFromEmail(),
  )
  // Cabeçalho sanitizado ao montar o assunto, e não no transporte.
  const subject = safeSubject(
    opts.subject,
    `Orçamento ${estimate.estimate_number} de ${business?.name || 'Faturador'}`,
  )

  const lineRows = (estimate.line_items || [])
    .sort(
      (a: { sort_order: number }, b: { sort_order: number }) =>
        a.sort_order - b.sort_order,
    )
    .map(
      (li: { description: string; amount: number }) => `
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #eee;">${escapeHtml(li.description)}</td>
            <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">${formatCurrency(li.amount, estimate.currency)}</td>
          </tr>`,
    )
    .join('')

  const messageBlock = opts.message
    ? `<p style="margin:0 0 24px;white-space:pre-wrap;">${escapeHtml(opts.message)}</p>`
    : ''

  const expiryBlock = estimate.expiry_date
    ? `<p style="margin:8px 0 0;color:#666;font-size:13px;">Válido até ${formatDate(estimate.expiry_date)}</p>`
    : ''

  const html = `
    <div style="background:#f6f7f9;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
        <h2 style="margin:0 0 4px;font-size:20px;">${escapeHtml(business?.name || '')}</h2>
        <p style="margin:0 0 24px;color:#666;">Orçamento ${escapeHtml(estimate.estimate_number)}</p>
        ${messageBlock}
        <div style="background:#f6f7f9;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0;color:#666;font-size:13px;">Total estimado</p>
          <p style="margin:4px 0 0;font-size:28px;font-weight:700;">${formatCurrency(estimate.total, estimate.currency)}</p>
          ${expiryBlock}
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">${lineRows}</table>
        <a href="${publicEstimateUrl}" style="display:block;background:${safeHexColor(business?.primary_color)};color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:8px;font-weight:600;">Revisar orçamento</a>
        <p style="margin:24px 0 0;color:#999;font-size:12px;text-align:center;">Enviado por <a href="${appUrl()}" style="color:#999;">Faturador</a></p>
      </div>
    </div>`

  const resend = new Resend(process.env.RESEND_API_KEY)
  const payload = {
    from,
    to,
    cc: cc.length ? cc : undefined,
    bcc: bcc.length ? bcc : undefined,
    replyTo: business?.email || undefined,
    subject,
    html,
  }
  // A cota diária de envios é verificada em prepareDelivery, cobrindo as
  // duas interfaces com uma única checagem. O erro é relançado com um tipo
  // específico, pois a ferramenta de envio do MCP só repassa esta classe; um
  // Error simples chegaria ao agente como falha genérica, sem indicar que deve aguardar.
  let delivery
  try {
    delivery = await prepareDelivery(
      db,
      estimate.business_id,
      estimateId,
      'estimate',
      opts.requestId,
      {
        to,
        cc,
        bcc,
        subject,
        message: opts.message || '',
        document_id: estimateId,
      },
      payload,
    )
  } catch (err) {
    if (err instanceof EmailQuotaError) throw new SendEstimateEmailError('quota_exceeded', err.message)
    throw err
  }
  if (delivery.alreadySent) return { sent: true, to }
  const { error: sendError } = await resend.emails.send(delivery.payload, {
    idempotencyKey: delivery.key,
  })

  if (sendError) {
    throw new SendEstimateEmailError(
      'send_failed',
      `Falha ao enviar o e-mail: ${sendError.message}`,
    )
  }

  const { error: statusError } = await db
    .from('estimates')
    .update({ status: 'sent' })
    .eq('id', estimateId)
    .eq('status', 'draft')
  if (statusError)
    throw new Error(
      'E-mail aceito, mas não foi possível salvar o status. Tente novamente usando o mesmo ID de solicitação.',
    )
  await finishDelivery(db, estimate.business_id, opts.requestId)

  return { sent: true, to }
}
