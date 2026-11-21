import 'server-only'
import { minorUnitsToAmount } from './money'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import { computePaymentUpdate } from '@/lib/invoices/payment-math'
import type { Database } from '@/types/database'
import { todayISO } from '@/lib/dates'

export interface ReconcileInvoiceRow {
  id: string
  business_id: string
  client_id: string
  currency: string
  total: number
  amount_paid: number
  status: string
  /**
   * A tentativa para a qual a fatura aponta atualmente. Lida somente pelo
   * handler de falha, que deve ignorar eventos de tentativas já substituídas.
   */
  stripe_payment_intent_id?: string | null
}

export interface PaymentInsert {
  business_id: string
  client_id: string
  invoice_id: string
  amount: number
  currency: string
  payment_method: 'stripe'
  stripe_payment_id: string | null
  payment_date: string
  notes?: string
  created_via: 'stripe'
}

export interface InvoiceUpdate {
  amount_paid: number
  balance_due: number
  status: 'paid' | 'partial' | 'sent'
  paid_at: string | null
  /**
   * Presente somente quando um evento de pagamento fornece o ID payment_intent
   * oficial; nesse caso, ele é gravado retroativamente na fatura, mesmo que a
   * gravação feita ao criar o intent tenha falhado. A associação de estornos e
   * contestações por stripe_payment_intent_id depende disso.
   */
  stripe_payment_intent_id?: string
}

/** O valor próprio (incremental, não acumulado) de um objeto de estorno da Stripe. */
export interface RefundEventInput {
  /** ID próprio do estorno, por exemplo `re_...` - NÃO o ID da cobrança nem do payment_intent. */
  id: string
  /** Valor próprio deste estorno em centavos (Refund.amount da Stripe já é incremental, não acumulado). */
  amountCents: number
}

/**
 * Monta a linha de pagamento para um evento payment_intent.succeeded. É uma
 * função pura: não acessa o banco nem trata o caso "already paid".
 * `stripePaymentId` (o ID payment_intent) é a chave de idempotência da linha:
 * o índice exclusivo do banco em `payments.stripe_payment_id` é o que impede
 * uma inserção duplicada quando a Stripe reentrega o mesmo evento. A fatura
 * nunca é calculada a partir desta única linha; sempre é recalculada a partir
 * do livro-razão completo por meio de `recomputeInvoiceFromSum`.
 */
export function buildPaidPaymentInsert(
  invoice: ReconcileInvoiceRow,
  amountCents: number,
  stripePaymentId: string | null,
  today: string
): PaymentInsert {
  return {
    business_id: invoice.business_id,
    client_id: invoice.client_id,
    invoice_id: invoice.id,
    amount: minorUnitsToAmount(amountCents, invoice.currency),
    currency: invoice.currency,
    payment_method: 'stripe',
    stripe_payment_id: stripePaymentId,
    payment_date: today,
    created_via: 'stripe',
  }
}

/**
 * Monta uma linha de pagamento de valor negativo para cada objeto de estorno,
 * usando o ID próprio do estorno (não o ID da cobrança; assim, vários estornos
 * da mesma cobrança - e reentregas do mesmo estorno - são idempotentes de forma
 * independente). Usa o `amount` próprio de cada estorno (Refund.amount da
 * Stripe já é o valor incremental daquele estorno, nunca o `amount_refunded`
 * acumulado da cobrança), então a soma das linhas sempre corresponde ao total
 * realmente estornado, inclusive em eventos repetidos ou de estornos parciais.
 */
export function buildRefundPaymentInserts(
  invoice: ReconcileInvoiceRow,
  refunds: RefundEventInput[],
  today: string
): PaymentInsert[] {
  return refunds.map((refund) => ({
    business_id: invoice.business_id,
    client_id: invoice.client_id,
    invoice_id: invoice.id,
    amount: -minorUnitsToAmount(refund.amountCents, invoice.currency),
    currency: invoice.currency,
    payment_method: 'stripe',
    stripe_payment_id: refund.id,
    payment_date: today,
    notes: 'Stripe refund',
    created_via: 'stripe',
  }))
}

/**
 * Filtra e mapeia uma lista de objetos Refund da Stripe (retornada por
 * `stripe.refunds.list`, a fonte oficial - veja o comentário de orquestração
 * no handler charge.refunded para saber por que não confiamos em
 * `charge.refunds.data` incorporado ao payload do webhook) para o formato
 * `RefundEventInput` esperado por `buildRefundPaymentInserts`. É uma função
 * pura e recebe somente os campos usados, permitindo testes com dados no
 * formato da lista obtida, sem chamar a Stripe em tempo real.
 */
export function refundEventInputsFromStripeRefunds(
  refunds: Array<Pick<Stripe.Refund, 'id' | 'status' | 'amount'>>
): RefundEventInput[] {
  return refunds
    .filter((r) => r.status === 'succeeded' && r.amount > 0)
    .map((r) => ({ id: r.id, amountCents: r.amount }))
}

/**
 * Recalcula do zero amount_paid/balance_due/status/paid_at da fatura a partir
 * da SOMA de todas as linhas de pagamento (que já desconta automaticamente os
 * estornos, pois suas linhas são negativas). Isso torna a conciliação
 * autorreparável: reproduzir o mesmo evento ou tentar novamente após uma falha
 * parcial (linha de pagamento inserida, mas atualização da fatura não executada)
 * sempre converge para o estado final correto, pois o cálculo nunca é
 * "estado anterior + variação deste evento", e sim "total de tudo que foi
 * registrado até agora". `computePaymentUpdate` é reutilizada com amount_paid
 * fixado em 0 para que a lógica de limite/status opere sobre a soma absoluta.
 */
export function recomputeInvoiceFromSum(
  invoice: { total: number },
  sumPaidDecimal: number,
  today: string,
  backfillPaymentIntentId?: string | null
): InvoiceUpdate {
  const update = computePaymentUpdate({ total: invoice.total, amount_paid: 0 }, sumPaidDecimal)
  const result: InvoiceUpdate = {
    ...update,
    paid_at: update.status === 'paid' ? today : null,
  }
  if (backfillPaymentIntentId) {
    result.stripe_payment_intent_id = backfillPaymentIntentId
  }
  return result
}

/**
 * Vocabulário armazenado pelo Faturador em `invoices.stripe_payment_status`: o
 * estado da ÚLTIMA tentativa com cartão, nunca um fato do livro-razão. Uma
 * tentativa com falha não movimentou dinheiro, portanto não altera `payments`
 * nem amount_paid, balance_due ou status da fatura. `succeeded` é gravado
 * junto com a linha do livro-razão apenas para que um `failed` antigo não
 * permaneça após uma nova tentativa bem-sucedida.
 */
type PaymentAttemptStatus = 'succeeded' | 'failed'

/**
 * Decide se um evento payment_intent.payment_failed deve ser gravado na fatura;
 * por isso, é seguro reproduzi-lo. Uma fatura paga nunca tem seu status
 * rebaixado, e o evento precisa descrever a tentativa para a qual a fatura
 * aponta atualmente, pois a Stripe entrega eventos fora de ordem. Retorna null
 * para indicar "ignorar este evento".
 */
export function decideFailedAttempt(
  invoice: Pick<ReconcileInvoiceRow, 'status' | 'stripe_payment_intent_id'>,
  paymentIntentId: string | null | undefined,
): { stripe_payment_status: 'failed' } | null {
  if (invoice.status === 'paid') return null
  if (!paymentIntentId) return null
  if (invoice.stripe_payment_intent_id && invoice.stripe_payment_intent_id !== paymentIntentId) return null
  return { stripe_payment_status: 'failed' }
}

// ---------------------------------------------------------------------------
// Orquestração (não é pura: acessa o Supabase). Mantida enxuta; todas as
// ramificações e os cálculos acima são testados sem banco de dados.
// ---------------------------------------------------------------------------

type DbClient = SupabaseClient<Database>

const INVOICE_COLUMNS = 'id, business_id, client_id, currency, total, amount_paid, status, stripe_payment_intent_id'

async function loadInvoiceById(db: DbClient, invoiceId: string): Promise<ReconcileInvoiceRow | null> {
  const { data, error } = await db.from('invoices').select(INVOICE_COLUMNS).eq('id', invoiceId).maybeSingle()
  if (error) throw error
  return (data as ReconcileInvoiceRow | null) ?? null
}

/**
 * Encontra a fatura descrita por um evento: primeiro pelo ID da fatura gravado
 * pelo Faturador no PaymentIntent, depois pela tentativa para a qual a fatura
 * aponta e, por fim, por um pagamento já registrado com esse PaymentIntent.
 * Esta última etapa é importante quando a fatura passa para uma nova tentativa
 * (o total aumentou depois de um pagamento), para que um estorno ou contestação
 * do pagamento anterior ainda seja associado a ela. Null significa que o evento
 * não se refere a nenhuma das nossas faturas.
 */
async function loadInvoiceForEvent(
  db: DbClient,
  metadataInvoiceId: string | undefined,
  paymentIntentId: string | null | undefined,
): Promise<ReconcileInvoiceRow | null> {
  if (metadataInvoiceId) {
    const invoice = await loadInvoiceById(db, metadataInvoiceId)
    if (invoice) return invoice
  }
  if (!paymentIntentId) return null
  const { data, error } = await db
    .from('invoices')
    .select(INVOICE_COLUMNS)
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle()
  if (error) throw error
  if (data) return data as ReconcileInvoiceRow
  const { data: booked, error: ledgerError } = await db
    .from('payments')
    .select('invoice_id')
    .eq('stripe_payment_id', paymentIntentId)
    .maybeSingle()
  if (ledgerError) throw ledgerError
  return booked?.invoice_id ? loadInvoiceById(db, booked.invoice_id) : null
}

/**
 * Registra uma tentativa com falha na fatura: sem linha de pagamento, sem alterar
 * valores nem status. O filtro `neq('status','paid')` repete no banco a
 * proteção aplicada em memória, fechando a janela em que um pagamento poderia
 * ser concluído entre a leitura e a gravação.
 */
async function recordFailedAttempt(db: DbClient, invoiceId: string): Promise<void> {
  const { error } = await db
    .from('invoices')
    .update({ stripe_payment_status: 'failed' })
    .eq('id', invoiceId)
    .neq('status', 'paid')
  if (error) {
    console.error('stripe reconcile: falha ao registrar a tentativa de pagamento com cartão', error.message)
    throw error
  }
}

/**
 * Remove a marca `failed` remanescente quando um pagamento é registrado, para
 * que a página da fatura e as ferramentas MCP de pagamento não exibam "última
 * tentativa falhou" em uma fatura já paga. Aplica-se ao intent atual da
 * fatura: o sucesso reentregue de um intent anterior não deve sobrescrever o
 * estado da tentativa mais recente.
 */
async function markAttemptSucceeded(db: DbClient, invoiceId: string, paymentIntentId: string): Promise<void> {
  const status: PaymentAttemptStatus = 'succeeded'
  const { error } = await db
    .from('invoices')
    .update({ stripe_payment_status: status })
    .eq('id', invoiceId)
    .eq('stripe_payment_intent_id', paymentIntentId)
  if (error) {
    console.error('stripe reconcile: falha ao limpar o estado da tentativa de pagamento com cartão', error.message)
    throw error
  }
}

/**
 * Registra uma linha no livro-razão por meio de record_stripe_payment, que
 * considera já registrado um ID de provedor repetido. Esse ID exclusivo do
 * provedor é a chave de idempotência do livro-razão.
 */
async function insertPaymentIdempotent(db: DbClient, row: PaymentInsert): Promise<void> {
  if (!row.stripe_payment_id) throw new Error('O ID de pagamento do provedor é obrigatório')
  const { error } = await db.rpc('record_stripe_payment', {
    p_invoice_id: row.invoice_id,
    p_amount: row.amount,
    p_payment_date: row.payment_date,
    p_provider_id: row.stripe_payment_id,
    p_notes: row.notes,
  })
  if (error) throw error
}

/**
 * Extrai de forma pura o ID payment_intent de um objeto de evento Dispute
 * (que o contém diretamente, sem precisar obter a cobrança). Exportada para
 * permitir testes unitários sem chamar a Stripe em tempo real.
 */
export function extractDisputePaymentIntentId(dispute: Pick<Stripe.Dispute, 'payment_intent'>): string | null {
  if (!dispute.payment_intent) return null
  return typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent.id
}

/**
 * Um evento só altera uma fatura quando realmente se refere a ela: deve ter a
 * mesma moeda e, se o Faturador gravou a empresa no PaymentIntent, a mesma empresa.
 * Lançar uma exceção faz o webhook responder 500, para que uma incompatibilidade
 * real apareça no registro de entregas da Stripe em vez de ser gravada.
 */
function assertInvoiceBinding(
  invoice: ReconcileInvoiceRow,
  currency: string | null | undefined,
  metadata: Stripe.Metadata | null | undefined,
): void {
  const businessId = metadata?.business_id
  if (
    currency?.toLowerCase() !== invoice.currency.toLowerCase() ||
    (businessId && businessId !== invoice.business_id)
  )
    throw new Error('A moeda ou a empresa do evento Stripe não corresponde à fatura')
}

/**
 * Encaminha um evento Stripe verificado e ainda não processado ao handler
 * correspondente. Tipos de evento fora de STRIPE_WEBHOOK_EVENTS são ignorados
 * (a chamada responde 200).
 */
export async function reconcileEvent(db: DbClient, event: Stripe.Event): Promise<void> {
  // O Faturador cobra pela própria conta Stripe desta instalação. Um evento que
  // identifica uma conta conectada veio de um endpoint configurado para Connect
  // e descreve valores que não pertencem a esta instalação para registro.
  if (event.account) {
    console.error('stripe reconcile: ignorando evento de uma conta conectada', event.id)
    return
  }
  const day = todayISO()
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const intent = event.data.object as Stripe.PaymentIntent
      const invoice = await loadInvoiceForEvent(db, intent.metadata?.invoice_id, intent.id)
      // Outro aplicativo na mesma conta Stripe: não é uma das nossas faturas.
      if (!invoice) return
      assertInvoiceBinding(invoice, intent.currency, intent.metadata)
      const amountCents = intent.amount_received ?? intent.amount ?? 0
      await insertPaymentIdempotent(db, buildPaidPaymentInsert(invoice, amountCents, intent.id, day))
      await markAttemptSucceeded(db, invoice.id, intent.id)
      return
    }
    case 'payment_intent.payment_failed': {
      const intent = event.data.object as Stripe.PaymentIntent
      const invoice = await loadInvoiceForEvent(db, intent.metadata?.invoice_id, intent.id)
      if (!invoice) return
      assertInvoiceBinding(invoice, intent.currency, intent.metadata)
      if (!decideFailedAttempt(invoice, intent.id)) return
      await recordFailedAttempt(db, invoice.id)
      return
    }
    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge
      const paymentIntentId =
        typeof charge.payment_intent === 'string' ? charge.payment_intent : (charge.payment_intent?.id ?? null)
      const invoice = await loadInvoiceForEvent(db, charge.metadata?.invoice_id, paymentIntentId)
      if (!invoice) return
      assertInvoiceBinding(invoice, charge.currency, charge.metadata)
      // A lista de estornos incorporada ao payload pode estar ausente ou truncada;
      // obtenha a lista completa. Se a consulta falhar, uma exceção fará a Stripe tentar novamente.
      const { stripe } = await import('@/lib/stripe/client')
      let page = await stripe.refunds.list({ charge: charge.id, limit: 100 })
      const all = [...page.data]
      while (page.has_more) {
        page = await stripe.refunds.list({ charge: charge.id, limit: 100, starting_after: all[all.length - 1].id })
        all.push(...page.data)
      }
      const refunds = refundEventInputsFromStripeRefunds(all)
      for (const row of buildRefundPaymentInserts(invoice, refunds, day)) {
        await insertPaymentIdempotent(db, row)
      }
      return
    }
    case 'charge.dispute.created': {
      const dispute = event.data.object as Stripe.Dispute
      const paymentIntentId = extractDisputePaymentIntentId(dispute)
      if (!paymentIntentId) return
      const invoice = await loadInvoiceForEvent(db, undefined, paymentIntentId)
      if (!invoice) return
      assertInvoiceBinding(invoice, dispute.currency, undefined)
      // Pela fatura, não por stripe_payment_intent_id: uma contestação de um
      // pagamento anterior ainda deve sinalizar a fatura, mesmo após uma nova tentativa.
      const { error } = await db.from('invoices').update({ disputed: true }).eq('id', invoice.id)
      if (error) {
        console.error('stripe reconcile: falha ao sinalizar fatura contestada', error.message)
        throw error
      }
      return
    }
    default:
      return
  }
}
