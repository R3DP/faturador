import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import type { McpCtx } from '@/lib/mcp/context'
import { ScopeError } from '@/lib/mcp/scoped-db'
import { sendInvoiceEmail, SendInvoiceEmailError } from '@/lib/invoices/send-email'
import { errorResult, jsonResult, formatCurrency, publicUrl } from '@/lib/mcp/shared'
import { todayISO } from '@/lib/dates'

const DATE_FIELD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use uma data no formato YYYY-MM-DD')

const PAYMENT_METHODS = ['cash', 'check', 'bank_transfer', 'credit_card', 'stripe', 'paypal', 'other'] as const

/**
 * Registra as ferramentas de envio e pagamento de faturas (send_invoice, record_payment) no
 * servidor MCP informado, limitadas às empresas em ctx.db.scope.
 */
export function registerInvoiceSendTools(server: McpServer, ctx: McpCtx) {
  server.registerTool(
    'send_invoice',
    {
      title: 'Enviar fatura',
      description:
        'Envia uma fatura por e-mail (com o PDF anexado) ao cliente, alterando o status de um rascunho para "sent"; se `to` não for informado, usa o e-mail do próprio cliente. Recusa o envio de faturas já pagas ou canceladas.',
      inputSchema: z.object({
        request_id: z.uuid().describe('ID estável de entrega. Reutilize nas tentativas com os mesmos destinatários e conteúdo.'),
        invoice_id: z.string().uuid().describe('ID da fatura a enviar.'),
        to: z
          .string()
          .email()
          .optional()
          .describe("E-mail do destinatário. Se omitido, usa o e-mail do cliente da fatura."),
        cc: z
          .array(z.string().email())
          .max(10)
          .optional()
          .describe('Destinatários em cópia (Cc). No máximo 10; divida envios maiores em várias chamadas.'),
        bcc: z
          .array(z.string().email())
          .max(10)
          .optional()
          .describe('Destinatários em cópia oculta (Bcc). No máximo 10; divida envios maiores em várias chamadas.'),
        subject: z.string().max(200).optional().describe('Assunto do e-mail. O padrão segue o formato "Fatura <number> de <business>".'),
        message: z.string().max(2000).optional().describe('Mensagem pessoal opcional, exibida antes do resumo da fatura.'),
      }),
    },
    async ({ request_id, invoice_id, to, cc, bcc, subject, message }) => {
      let invoice
      try {
        invoice = await ctx.db.assertInvoiceAccess(invoice_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível acessar a fatura.')
      }

      if (invoice.status === 'paid') {
        return errorResult(
          `A fatura ${invoice.invoice_number} já está paga. Não há nada a enviar.`
        )
      }
      if (invoice.status === 'cancelled') {
        return errorResult(
          `A fatura ${invoice.invoice_number} está cancelada. Faturas canceladas não podem ser enviadas.`
        )
      }

      let recipient = to
      if (!recipient) {
        const { data: client, error: clientError } = await ctx.db.svc
          .from('clients')
          .select('email')
          .eq('id', invoice.client_id)
          .eq('business_id', invoice.business_id)
          .maybeSingle()

        if (clientError) {
          console.error('send_invoice (client lookup):', clientError)
          return errorResult('Não foi possível localizar o e-mail do cliente.')
        }

        if (!client?.email) {
          return errorResult(
            `O cliente da fatura ${invoice.invoice_number} não tem e-mail cadastrado. Informe "to" explicitamente.`
          )
        }

        recipient = client.email
      }

      try {
        const result = await sendInvoiceEmail(ctx.db.svc, invoice_id, {
          requestId: request_id,
          to: recipient,
          cc,
          bcc,
          subject,
          message,
        })

        const resultBody = {
          summary: `Fatura ${invoice.invoice_number} enviada para ${result.to} com o PDF anexado.`,
          to: result.to,
          public_url: publicUrl(invoice.public_id),
        }

        return jsonResult(resultBody)
      } catch (err) {
        if (err instanceof SendInvoiceEmailError) {
          return errorResult(err.message)
        }
        console.error('send_invoice (send):', err)
        return errorResult('Não foi possível enviar a fatura.')
      }
    }
  )

  server.registerTool(
    'record_payment',
    {
      title: 'Registrar pagamento',
      description:
        "Registra um pagamento recebido para uma fatura, atualizando amount_paid/balance_due e o status (\"paid\" quando o saldo chegar a zero; caso contrário, \"partial\"). Segue o mesmo fluxo de registro de pagamento do aplicativo.",
      inputSchema: z.object({
        request_id: z.uuid().describe('ID estável do pagamento; reutilize nas tentativas com os mesmos dados.'),
        invoice_id: z.string().uuid().describe('ID da fatura à qual o pagamento se aplica.'),
        amount: z.number().positive().describe('Valor do pagamento recebido (deve ser > 0).'),
        payment_date: DATE_FIELD.optional().describe('Data em que o pagamento foi recebido, no formato YYYY-MM-DD. Por padrão, usa a data de hoje.'),
        method: z
          .enum(PAYMENT_METHODS)
          .optional()
          .describe('Forma de pagamento. Por padrão, usa "other".'),
        notes: z.string().max(2000).optional().describe('Observações opcionais sobre o pagamento.'),
        reference_number: z.string().max(100).optional().describe('Número opcional de referência, cheque ou transação.'),
      }),
    },
    async ({ request_id, invoice_id, amount, payment_date, method, notes, reference_number }) => {
      let invoice
      try {
        invoice = await ctx.db.assertInvoiceAccess(invoice_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível acessar a fatura.')
      }

      if (invoice.status === 'cancelled') {
        return errorResult(
          `A fatura ${invoice.invoice_number} está cancelada. Não é possível registrar pagamentos para ela.`
        )
      }

      const resolvedPaymentDate = payment_date || todayISO()

      // Uma única transação. record_invoice_payment insere a linha no
      // razão e recalcula a fatura a partir de SUM(payments), eliminando
      // a janela em que o pagamento já existe, mas a fatura ainda aparece
      // como unpaid; o cálculo usa valores absolutos, não incrementais.
      const { data: recorded, error: recordError } = await ctx.db.svc.rpc('record_payment_once', {
        p_request_id: request_id,
        p_invoice_id: invoice_id,
        p_amount: amount,
        p_payment_date: resolvedPaymentDate,
        p_payment_method: method ?? 'other',
        p_reference_number: reference_number || undefined,
        p_notes: notes || undefined,
        p_created_via: 'agent',
        p_created_by_key_id: ctx.keyId,
      })

      if (recordError || !recorded) {
        console.error('record_payment (rpc):', recordError)
        return errorResult('Não foi possível registrar o pagamento.')
      }

      const updated = (recorded as { invoice: { status: string; amount_paid: number; balance_due: number } })
        .invoice

      const result = {
        summary: `Pagamento de ${formatCurrency(amount, invoice.currency)} registrado na fatura ${invoice.invoice_number}. O status agora é ${updated.status}, com saldo de ${formatCurrency(updated.balance_due, invoice.currency)} a pagar.`,
        invoice: {
          status: updated.status,
          amount_paid: updated.amount_paid,
          balance_due: updated.balance_due,
        },
      }

      return jsonResult(result)
    }
  )
}
