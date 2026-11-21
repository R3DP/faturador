import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import type { McpCtx } from '@/lib/mcp/context'
import { ScopeError } from '@/lib/mcp/scoped-db'
import { stripePaymentsConfigured } from '@/lib/stripe/config'
import { appUrl, errorResult, jsonResult, formatCurrency, publicUrl, isOverdue } from '@/lib/mcp/shared'

const PAYMENT_HISTORY_LIMIT = 100

const DATE_FIELD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD')

/**
 * Métodos que uma correção pode definir. "stripe" foi omitido de propósito:
 * somente o fluxo verificado de webhook do Stripe pode registrar um pagamento
 * com cartão; de todo modo, o banco recusaria uma correção que tentasse fazê-lo.
 */
const EDITABLE_PAYMENT_METHODS = ['cash', 'check', 'bank_transfer', 'credit_card', 'paypal', 'other'] as const

/**
 * Converte os códigos de erro da RPC em mensagens que o agente solicitante
 * pode resolver. Códigos desconhecidos usam a mensagem genérica, sem expor
 * erros do Postgres à pessoa usuária.
 */
function correctionError(error: { message?: string } | null, fallback: string): string {
  const code = error?.message ?? ''
  if (code.includes('stripe_payment_locked')) {
    return 'Este pagamento foi recebido pelo Stripe e não pode ser editado nem anulado aqui. Emita o reembolso no Stripe. Ele aparecerá no Faturador como um lançamento separado no histórico.'
  }
  if (code.includes('payment_already_voided')) {
    return 'Este pagamento já foi anulado. Não há mais nada a alterar.'
  }
  if (code.includes('amount_exceeds_invoice_total')) {
    return 'Com esse valor, o total da fatura seria ultrapassado ao considerar os outros pagamentos. Reduza o valor ou anule primeiro um pagamento duplicado.'
  }
  if (code.includes('request_id_reused')) {
    return 'Esse request_id já foi usado em outra correção deste pagamento. Use um novo request_id.'
  }
  if (code.includes('key_cannot_edit_payments')) {
    return 'Esta chave de API não tem a permissão payments, necessária para corrigir ou anular um pagamento.'
  }
  if (code.includes('void_reason_required')) {
    return 'É necessário informar um motivo para anular o pagamento.'
  }
  if (code.includes('invalid_amount')) {
    return 'O valor deve ser maior que zero.'
  }
  if (code.includes('payment_not_found')) {
    return 'Pagamento não encontrado'
  }
  console.error('payment correction (rpc):', error)
  return fallback
}

interface CorrectionRpcResult {
  payment: {
    id: string
    amount: number
    payment_date: string
    payment_method: string
    reference_number: string | null
    notes: string | null
    currency: string
    source: string
    voided_at: string | null
    void_reason: string | null
  }
  invoice: { invoice_number: string; status: string; amount_paid: number; balance_due: number; currency: string }
  replayed: boolean
}

/** Formato de resultado compartilhado pelas duas correções. */
function correctionResult(data: unknown, verb: 'Pagamento atualizado' | 'Pagamento anulado') {
  const result = data as CorrectionRpcResult
  const { payment, invoice } = result
  const amount = formatCurrency(payment.amount, invoice.currency)
  const balance = formatCurrency(invoice.balance_due, invoice.currency)
  const replayNote = result.replayed ? ' Esta solicitação repetiu uma solicitação anterior idêntica; nenhuma alteração foi aplicada novamente.' : ''
  return {
    summary: `${verb} de ${amount} na fatura ${invoice.invoice_number}. O status da fatura agora é ${invoice.status}, com saldo de ${balance} a pagar.${replayNote}`,
    payment: {
      payment_id: payment.id,
      amount: payment.amount,
      payment_date: payment.payment_date,
      method: payment.payment_method,
      reference_number: payment.reference_number,
      notes: payment.notes,
      source: payment.source,
      voided_at: payment.voided_at,
      void_reason: payment.void_reason,
    },
    invoice: {
      invoice_number: invoice.invoice_number,
      status: invoice.status,
      amount_paid: invoice.amount_paid,
      balance_due: invoice.balance_due,
    },
    replayed: result.replayed,
  }
}

/**
 * Os pagamentos com cartão são controlados pelo fluxo do Stripe. A verificação
 * aqui gera uma mensagem clara; o banco também os recusa de qualquer forma.
 */
const STRIPE_LOCKED =
  'Este pagamento foi recebido pelo Stripe e não pode ser editado nem anulado aqui. Emita o reembolso no Stripe. Ele aparecerá no Faturador como um lançamento separado no histórico.'

export interface PaymentLedgerRow {
  id: string
  amount: number
  payment_date: string
  payment_method: string
  reference_number: string | null
  notes: string | null
  created_via: string | null
  stripe_payment_id: string | null
  source: string
  voided_at: string | null
  void_reason: string | null
}

export interface PaymentReconciliation {
  ledger_total: number
  recorded_amount_paid: number
  /**
   * Indica que amount_paid armazenado na fatura difere da soma do histórico
   * de pagamentos. A divergência é exibida, em vez de escolher um valor em
   * silêncio, para evitar informar com confiança um total incorreto.
   */
  mismatch: boolean
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Conciliação pura entre o histórico de pagamentos e amount_paid armazenado
 * na fatura. Extraída para permitir testes unitários sem banco de dados.
 */
export function reconcilePayments(payments: Pick<PaymentLedgerRow, 'amount'>[], amountPaid: number): PaymentReconciliation {
  const ledgerTotal = round2(payments.reduce((sum, payment) => sum + payment.amount, 0))
  const recorded = round2(amountPaid)
  return {
    ledger_total: ledgerTotal,
    recorded_amount_paid: recorded,
    mismatch: ledgerTotal !== recorded,
  }
}

/**
 * Registra get_payment_status, limitado às empresas em ctx.db.scope.
 *
 * FONTE DO RAZÃO: os valores ficam somente na tabela `payments`.
 */
export function registerPaymentTools(server: McpServer, ctx: McpCtx) {
  server.registerTool(
    'get_payment_status',
    {
      title: 'Consultar situação dos pagamentos',
      description:
        'Informa a situação financeira de uma fatura: valores a pagar e pagos, cada pagamento registrado com seu payment_id, se o pagamento on-line com cartão está habilitado e o link de pagamento do cliente. Use para responder "se X já pagou" ou "quanto ainda falta pagar". Pagamentos anulados ficam fora da lista e dos totais, a menos que include_voided seja true. Somente leitura: use record_payment para registrar pagamentos recebidos fora do Stripe, update_payment para corrigi-los e void_payment para anulá-los.',
      inputSchema: z.object({
        invoice_id: z
          .string()
          .uuid()
          .describe('ID da fatura a consultar, obtido por list_invoices, create_invoice ou get_invoice.'),
        include_voided: z
          .boolean()
          .optional()
          .describe('Inclui pagamentos anulados na lista retornada. O padrão é false. Pagamentos anulados nunca entram nos totais.'),
      }),
    },
    async ({ invoice_id, include_voided }) => {
      let invoice
      try {
        invoice = await ctx.db.assertInvoiceAccess(invoice_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível acessar a fatura.')
      }

      const { data: payments, error: paymentsError } = await ctx.db.svc
        .from('payments')
        .select('id, amount, payment_date, payment_method, reference_number, notes, created_via, stripe_payment_id, source, voided_at, void_reason')
        .eq('invoice_id', invoice_id)
        .eq('business_id', invoice.business_id)
        .order('payment_date', { ascending: true })
        .limit(PAYMENT_HISTORY_LIMIT)

      if (paymentsError) {
        console.error('get_payment_status (payments):', paymentsError)
        return errorResult('Não foi possível carregar o histórico de pagamentos desta fatura.')
      }

      const allPayments = (payments ?? []) as PaymentLedgerRow[]
      // Um pagamento anulado não representa dinheiro recebido. Nunca entra em
      // um total e fica fora da lista, a menos que a pessoa solicite sua exibição.
      const live = allPayments.filter((payment) => payment.voided_at === null)
      const listed = include_voided ? allPayments : live
      const history = listed.map((payment) => ({
        /** ID estável. Informe-o em update_payment ou void_payment. */
        payment_id: payment.id,
        amount: payment.amount,
        payment_date: payment.payment_date,
        method: payment.payment_method,
        reference_number: payment.reference_number,
        notes: payment.notes,
        /** "stripe" indica recebimento pelo link de pagamento on-line; não pode ser editado nem anulado. */
        source: payment.source,
        voided_at: payment.voided_at,
        void_reason: payment.void_reason,
      }))

      const reconciliation = reconcilePayments(live, invoice.amount_paid)
      const overdue = isOverdue(invoice.status, invoice.due_date)
      const onlinePaymentsEnabled = stripePaymentsConfigured()

      const paidLabel = formatCurrency(invoice.amount_paid, invoice.currency)
      const dueLabel = formatCurrency(invoice.balance_due, invoice.currency)
      const overdueNote = overdue ? `, em atraso desde ${invoice.due_date}` : ''
      const mismatchNote = reconciliation.mismatch
        ? ` Atenção: os pagamentos registrados somam ${formatCurrency(reconciliation.ledger_total, invoice.currency)}, valor diferente do total pago armazenado na fatura (${paidLabel}). Confira a fatura no aplicativo antes de informar um valor.`
        : ''

      return jsonResult({
        summary: `A fatura ${invoice.invoice_number} está com status ${invoice.status}${overdueNote}: ${paidLabel} pagos e ${dueLabel} ainda a pagar.${mismatchNote}`,
        invoice: {
          id: invoice.id,
          invoice_number: invoice.invoice_number,
          status: invoice.status,
          is_overdue: overdue,
          currency: invoice.currency,
          total: invoice.total,
          amount_paid: invoice.amount_paid,
          balance_due: invoice.balance_due,
          due_date: invoice.due_date,
          paid_at: invoice.paid_at,
        },
        payments: history,
        payments_count: history.length,
        voided_count: allPayments.length - live.length,
        payments_truncated: allPayments.length === PAYMENT_HISTORY_LIMIT,
        reconciliation,
        online_payments_enabled: onlinePaymentsEnabled,
        pay_url: onlinePaymentsEnabled ? publicUrl(invoice.public_id) : null,
        public_url: publicUrl(invoice.public_id),
        app_url: `${appUrl()}/invoices/${invoice.id}`,
      })
    }
  )
  // -------------------------------------------------------------------------
  // Correções
  // -------------------------------------------------------------------------
  // Ambas passam por RPCs SECURITY DEFINER. As regras pertencem à RPC,
  // não a este arquivo: ela verifica a autoridade da chave sobre a empresa do
  // pagamento, recusa valores recebidos pelo Stripe e pagamentos já anulados,
  // é idempotente em (payment_id, request_id), grava a linha de auditoria com
  // os dados do pagamento antes e depois e recalcula amount_paid, balance_due e
  // status da fatura com base nos pagamentos ativos restantes.
  //
  // O ator chega ao banco exatamente como em record_payment: a chamada é
  // executada pelo cliente de serviço de ScopedDb e leva ctx.keyId; a RPC
  // resolve a chave para seu titular e verifica novamente a permissão
  // "payments" no SQL. O escopo continua sendo estabelecido primeiro aqui,
  // por ctx.db.assertPaymentAccess, para que um ID de pagamento fora do escopo
  // nunca chegue à RPC.
  server.registerTool(
    'update_payment',
    {
      title: 'Corrigir pagamento',
      description:
        'Corrige um pagamento registrado: data de recebimento, método, número de referência, observações ou valor digitado incorretamente. A fatura é recalculada com os pagamentos ativos; um valor menor reabre o saldo e muda uma fatura paga para parcial. Use para corrigir a data de um pagamento, que poderia colocar o recebimento no mês errado nos relatórios de receita. Pagamentos recebidos pelo Stripe não podem ser editados: faça o reembolso no Stripe, que aparecerá aqui como um lançamento separado. Os campos omitidos permanecem inalterados.',
      inputSchema: z.object({
        request_id: z
          .string()
          .min(1)
          .max(200)
          .describe('ID estável da correção. Reutilize nas tentativas com os mesmos dados para receber a mesma resposta sem aplicar a alteração novamente.'),
        payment_id: z
          .string()
          .uuid()
          .describe('ID do pagamento a corrigir, obtido na lista de pagamentos de get_payment_status.'),
        payment_date: DATE_FIELD.optional().describe('Data corrigida de recebimento do pagamento, no formato YYYY-MM-DD.'),
        method: z.enum(EDITABLE_PAYMENT_METHODS).optional().describe('Método de pagamento corrigido. "stripe" não é aceito aqui, pois somente o fluxo verificado do Stripe pode registrar pagamentos com cartão.'),
        notes: z.string().max(2000).optional().describe('Observações corrigidas sobre o pagamento.'),
        reference_number: z.string().max(100).optional().describe('Número corrigido de referência, cheque ou transação.'),
        amount: z
          .number()
          .positive()
          .optional()
          .describe('Valor corrigido. Deve ser maior que zero e não pode ultrapassar o total da fatura ao considerar os outros pagamentos ativos.'),
      }),
    },
    async ({ request_id, payment_id, payment_date, method, notes, reference_number, amount }) => {
      let payment
      try {
        payment = await ctx.db.assertPaymentAccess(payment_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível acessar o pagamento.')
      }

      if (payment.source === 'stripe') {
        return errorResult(STRIPE_LOCKED)
      }

      if (
        payment_date === undefined &&
        method === undefined &&
        notes === undefined &&
        reference_number === undefined &&
        amount === undefined
      ) {
        return errorResult('Informe pelo menos um campo para alterar.')
      }

      const { data, error } = await ctx.db.svc.rpc('update_payment', {
        p_payment_id: payment_id,
        p_request_id: request_id,
        p_payment_date: payment_date,
        p_method: method,
        p_notes: notes,
        p_reference_number: reference_number,
        p_amount: amount,
        p_actor_key_id: ctx.keyId,
      })

      if (error || !data) {
        return errorResult(correctionError(error, 'Não foi possível corrigir esse pagamento.'))
      }

      return jsonResult(correctionResult(data, 'Pagamento atualizado'))
    }
  )

  server.registerTool(
    'void_payment',
    {
      title: 'Anular pagamento',
      description:
        'Anula, com justificativa, um pagamento que nunca deveria ter sido registrado. O registro é mantido e continua visível, riscado e acompanhado do motivo, mas deixa de contar como valor recebido: a fatura reabre pelo mesmo valor, e totais, relatórios e listas o desconsideram. Use quando um pagamento foi registrado duas vezes, associado à fatura errada ou referente a um valor que não foi recebido. Pagamentos recebidos pelo Stripe não podem ser anulados: reembolse a cobrança no Stripe, e o reembolso aparecerá aqui como um lançamento separado.',
      inputSchema: z.object({
        request_id: z
          .string()
          .min(1)
          .max(200)
          .describe('ID estável da anulação. Reutilize nas tentativas com o mesmo motivo para receber a mesma resposta sem anular novamente.'),
        payment_id: z
          .string()
          .uuid()
          .describe('ID do pagamento a anular, obtido na lista de pagamentos de get_payment_status.'),
        reason: z
          .string()
          .min(1)
          .max(2000)
          .describe('Motivo da anulação. Fica registrado no pagamento e na auditoria e é exibido no aplicativo.'),
      }),
    },
    async ({ request_id, payment_id, reason }) => {
      let payment
      try {
        payment = await ctx.db.assertPaymentAccess(payment_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível acessar o pagamento.')
      }
      if (payment.source === 'stripe') {
        return errorResult(STRIPE_LOCKED)
      }

      const { data, error } = await ctx.db.svc.rpc('void_payment', {
        p_payment_id: payment_id,
        p_request_id: request_id,
        p_reason: reason,
        p_actor_key_id: ctx.keyId,
      })

      if (error || !data) {
        return errorResult(correctionError(error, 'Não foi possível anular esse pagamento.'))
      }

      return jsonResult(correctionResult(data, 'Pagamento anulado'))
    }
  )
}
