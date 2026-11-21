import { describe, it, expect } from 'vitest'
import {
  buildPaidPaymentInsert,
  buildRefundPaymentInserts,
  refundEventInputsFromStripeRefunds,
  recomputeInvoiceFromSum,
  decideFailedAttempt,
  extractDisputePaymentIntentId,
  type ReconcileInvoiceRow,
  type PaymentInsert,
} from './reconcile'

/**
 * Objeto de estorno no formato realmente retornado por `stripe.refunds.list(...)`,
 * com campos adicionais além dos lidos por refundEventInputsFromStripeRefunds,
 * para comprovar que a função depende apenas de id/status/amount e aceita os
 * demais campos do formato real de resposta da API.
 */
function fetchedRefund(overrides: { id: string; amount: number; status?: 'succeeded' | 'pending' | 'failed' }) {
  return {
    id: overrides.id,
    object: 'refund' as const,
    amount: overrides.amount,
    status: overrides.status ?? 'succeeded',
    charge: 'ch_test',
    currency: 'usd',
    created: 1700000000,
    reason: null,
  }
}

const baseInvoice: ReconcileInvoiceRow = {
  id: 'invoice-1',
  business_id: 'business-1',
  client_id: 'client-1',
  currency: 'usd',
  total: 100,
  amount_paid: 0,
  status: 'sent',
}

/**
 * Substituto usado somente nos testes para o índice exclusivo do banco em payments.stripe_payment_id
 * (`ON CONFLICT (stripe_payment_id) DO NOTHING`), que permite exercitar o comportamento idempotente
 * e autorreparável do fluxo real de livro-razão e recálculo
 * sem banco de dados. Reproduz exatamente o que insertPaymentIdempotent +
 * recomputeInvoice fazem na camada de orquestração de reconcile.ts.
 */
function makeLedger() {
  const rows = new Map<string, PaymentInsert>()
  return {
    insert(row: PaymentInsert) {
      const key = row.stripe_payment_id ?? `no-key-${rows.size}`
      if (!rows.has(key)) rows.set(key, row)
    },
    sum() {
      return [...rows.values()].reduce((acc, r) => acc + r.amount, 0)
    },
    size() {
      return rows.size
    },
  }
}

describe('buildPaidPaymentInsert', () => {
  it('monta uma linha de pagamento indexada pelo ID Stripe, independentemente do estado atual da fatura', () => {
    const row = buildPaidPaymentInsert(baseInvoice, 10000, 'pi_123', '2026-08-26')
    expect(row).toEqual({
      business_id: 'business-1',
      client_id: 'client-1',
      invoice_id: 'invoice-1',
      amount: 100,
      currency: 'usd',
      payment_method: 'stripe',
      stripe_payment_id: 'pi_123',
      payment_date: '2026-08-26',
      created_via: 'stripe',
    })
  })

  it('trata um ID de pagamento Stripe null sem lançar exceção', () => {
    const row = buildPaidPaymentInsert(baseInvoice, 10000, null, '2026-08-26')
    expect(row.stripe_payment_id).toBeNull()
  })
})

describe('recomputeInvoiceFromSum', () => {
  it('pagamento integral: a soma corresponde ao total -> paid, paid_at preenchido', () => {
    const update = recomputeInvoiceFromSum(baseInvoice, 100, '2026-08-26')
    expect(update).toEqual({ amount_paid: 100, balance_due: 0, status: 'paid', paid_at: '2026-08-26' })
  })

  it('pagamento parcial: status partial, paid_at null', () => {
    const update = recomputeInvoiceFromSum(baseInvoice, 40, '2026-08-26')
    expect(update).toEqual({ amount_paid: 40, balance_due: 60, status: 'partial', paid_at: null })
  })

  it('soma zero ou negativa: status sent, paid_at null, limitada a 0', () => {
    expect(recomputeInvoiceFromSum(baseInvoice, 0, '2026-08-26')).toEqual({
      amount_paid: 0,
      balance_due: 100,
      status: 'sent',
      paid_at: null,
    })
    expect(recomputeInvoiceFromSum(baseInvoice, -20, '2026-08-26')).toEqual({
      amount_paid: 0,
      balance_due: 100,
      status: 'sent',
      paid_at: null,
    })
  })

  it('sem ID de preenchimento retroativo, a atualização retornada não inclui a chave stripe_payment_intent_id', () => {
    const update = recomputeInvoiceFromSum(baseInvoice, 40, '2026-08-26')
    expect('stripe_payment_intent_id' in update).toBe(false)
  })

  it('preenche stripe_payment_intent_id retroativamente quando o handler de pagamento fornece o ID PI oficial do evento, independentemente da gravação feita ao criar o intent', () => {
    const update = recomputeInvoiceFromSum(baseInvoice, 100, '2026-08-26', 'pi_authoritative')
    expect(update).toEqual({
      amount_paid: 100,
      balance_due: 0,
      status: 'paid',
      paid_at: '2026-08-26',
      stripe_payment_intent_id: 'pi_authoritative',
    })
  })

  it('não preenche retroativamente quando nenhum ID é fornecido (null/undefined), mantendo a chave ausente', () => {
    expect('stripe_payment_intent_id' in recomputeInvoiceFromSum(baseInvoice, 40, '2026-08-26', null)).toBe(false)
    expect('stripe_payment_intent_id' in recomputeInvoiceFromSum(baseInvoice, 40, '2026-08-26', undefined)).toBe(
      false
    )
  })
})

describe('extractDisputePaymentIntentId', () => {
  it('extrai diretamente uma string de ID payment_intent', () => {
    expect(extractDisputePaymentIntentId({ payment_intent: 'pi_disputed' })).toBe('pi_disputed')
  })

  it('extrai o ID de um objeto PaymentIntent expandido', () => {
    expect(
      extractDisputePaymentIntentId({
        payment_intent: { id: 'pi_expanded' } as unknown as import('stripe').default.PaymentIntent,
      })
    ).toBe('pi_expanded')
  })

  it('retorna null quando payment_intent é null', () => {
    expect(extractDisputePaymentIntentId({ payment_intent: null })).toBeNull()
  })
})

describe('associação da contestação pelo ID payment_intent', () => {
  it('um evento de contestação cujo payment_intent corresponde a uma fatura preenchida retroativamente pelo handler de pagamento é associado a essa fatura', () => {
    // Simula a sequência de ponta a ponta: o handler de pagamento preenche retroativamente
    // stripe_payment_intent_id pelo quarto parâmetro de recomputeInvoiceFromSum,
    // então um evento charge.dispute.created posterior para o mesmo PI precisa
    // ser associado ao mesmo ID - comprovando que ambos usam a mesma chave
    // sem precisar chamar stripe.charges.retrieve.
    const invoiceUpdate = recomputeInvoiceFromSum(baseInvoice, 100, '2026-08-26', 'pi_shared')
    const disputePaymentIntentId = extractDisputePaymentIntentId({ payment_intent: 'pi_shared' })
    expect(invoiceUpdate.stripe_payment_intent_id).toBe(disputePaymentIntentId)
  })
})

describe('buildRefundPaymentInserts', () => {
  it('monta uma linha de valor negativo por estorno, indexada pelo ID do estorno (não pelo ID da cobrança)', () => {
    const rows = buildRefundPaymentInserts(
      baseInvoice,
      [
        { id: 're_1', amountCents: 3000 },
        { id: 're_2', amountCents: 2000 },
      ],
      '2026-08-27'
    )
    expect(rows).toEqual([
      {
        business_id: 'business-1',
        client_id: 'client-1',
        invoice_id: 'invoice-1',
        amount: -30,
        currency: 'usd',
        payment_method: 'stripe',
        stripe_payment_id: 're_1',
        payment_date: '2026-08-27',
        notes: 'Stripe refund',
        created_via: 'stripe',
      },
      {
        business_id: 'business-1',
        client_id: 'client-1',
        invoice_id: 'invoice-1',
        amount: -20,
        currency: 'usd',
        payment_method: 'stripe',
        stripe_payment_id: 're_2',
        payment_date: '2026-08-27',
        notes: 'Stripe refund',
        created_via: 'stripe',
      },
    ])
  })
})

describe('refundEventInputsFromStripeRefunds', () => {
  it('converte o formato da lista obtida (resposta de stripe.refunds.list) para RefundEventInput, ignorando campos extras', () => {
    const inputs = refundEventInputsFromStripeRefunds([
      fetchedRefund({ id: 're_1', amount: 3000 }),
      fetchedRefund({ id: 're_2', amount: 5000 }),
    ])
    expect(inputs).toEqual([
      { id: 're_1', amountCents: 3000 },
      { id: 're_2', amountCents: 5000 },
    ])
  })

  it('exclui estornos que ainda não tiveram sucesso (pending/failed)', () => {
    const inputs = refundEventInputsFromStripeRefunds([
      fetchedRefund({ id: 're_pending', amount: 1000, status: 'pending' }),
      fetchedRefund({ id: 're_failed', amount: 1000, status: 'failed' }),
      fetchedRefund({ id: 're_ok', amount: 1000, status: 'succeeded' }),
    ])
    expect(inputs).toEqual([{ id: 're_ok', amountCents: 1000 }])
  })

  it('exclui entradas de estorno com valor zero ou negativo', () => {
    const inputs = refundEventInputsFromStripeRefunds([fetchedRefund({ id: 're_zero', amount: 0 })])
    expect(inputs).toEqual([])
  })

  it('retorna uma lista vazia (sem lançar exceção) quando a lista obtida está vazia', () => {
    expect(refundEventInputsFromStripeRefunds([])).toEqual([])
  })
})

describe('cenários ponta a ponta do livro-razão e recálculo (simulando o índice único do banco e o fluxo de recálculo a partir da soma)', () => {
  it('C2: aplicar duas vezes um evento de pagamento (mesmo ID payment_intent) gera UMA linha no livro-razão e paga a fatura uma única vez', () => {
    const ledger = makeLedger()

    // Primeira entrega de payment_intent.succeeded.
    ledger.insert(buildPaidPaymentInsert(baseInvoice, 10000, 'pi_dup', '2026-08-26'))
    let update = recomputeInvoiceFromSum(baseInvoice, ledger.sum(), '2026-08-26')
    expect(update).toEqual({ amount_paid: 100, balance_due: 0, status: 'paid', paid_at: '2026-08-26' })

    // Segunda entrega para o MESMO ID payment_intent - o
    // índice exclusivo (simulado pela deduplicação por chave de makeLedger) recusa a
    // inserção duplicada; o recálculo ainda é executado e não pode contar duas vezes.
    ledger.insert(buildPaidPaymentInsert(baseInvoice, 10000, 'pi_dup', '2026-08-26'))
    update = recomputeInvoiceFromSum(baseInvoice, ledger.sum(), '2026-08-26')

    expect(ledger.size()).toBe(1)
    expect(update).toEqual({ amount_paid: 100, balance_due: 0, status: 'paid', paid_at: '2026-08-26' })
  })

  it('C1: repetir após uma falha simulada ao atualizar a fatura (linha de pagamento já inserida) converge para o estado correto, sem contar duas vezes', () => {
    const ledger = makeLedger()

    // Primeira tentativa: a linha de pagamento é inserida, mas imagine que a atualização
    // UPDATE posterior da fatura falha (instabilidade de rede) - a chamada em reconcile.ts
    // remove a linha stripe_events para que a Stripe repita o evento inteiro.
    ledger.insert(buildPaidPaymentInsert(baseInvoice, 4000, 'pi_retry', '2026-08-26'))
    // (a atualização da fatura não é aplicada intencionalmente, simulando a falha)

    // Nova tentativa: reconcileEvent recomeça do início. A inserção não faz nada
    // (a linha já foi registrada na primeira tentativa), mas o recálculo ainda é executado.
    ledger.insert(buildPaidPaymentInsert(baseInvoice, 4000, 'pi_retry', '2026-08-26'))
    const update = recomputeInvoiceFromSum(baseInvoice, ledger.sum(), '2026-08-26')

    expect(ledger.size()).toBe(1)
    expect(update).toEqual({ amount_paid: 40, balance_due: 60, status: 'partial', paid_at: null })
  })

  it('I1: dois estornos parciais (primeiro de US$ 30; depois outro que eleva charge.amount_refunded acumulado a US$ 80) resultam exatamente em US$ 50 estornados, não US$ 80; a reentrega do primeiro evento não duplica o valor', () => {
    const ledger = makeLedger()

    // Primeiro, a fatura é paga integralmente.
    ledger.insert(buildPaidPaymentInsert(baseInvoice, 10000, 'pi_refund_test', '2026-08-26'))

    // Primeiro evento charge.refunded: a orquestração obtém a
    // lista oficial de estornos da Stripe (não a lista incorporada ao payload do webhook
    // em charge.refunds.data), que neste momento contém somente
    // re_1, cujo valor PRÓPRIO é US$ 30 (charge.amount_refunded também é 30 neste
    // momento, então um erro com o valor acumulado ainda não seria percebido).
    let fetchedRefunds = refundEventInputsFromStripeRefunds([fetchedRefund({ id: 're_1', amount: 3000 })])
    for (const row of buildRefundPaymentInserts(baseInvoice, fetchedRefunds, '2026-08-27')) {
      ledger.insert(row)
    }
    let update = recomputeInvoiceFromSum(baseInvoice, ledger.sum(), '2026-08-27')
    expect(update.amount_paid).toBe(70)

    // É emitido um segundo estorno independente de US$ 50 (re_2). A lista oficial
    // obtida agora retorna AMBOS os objetos de estorno: re_1 (US$ 30, já
    // registrado) e re_2 (US$ 50, novo). Usar o valor incremental próprio de cada estorno
    // (nunca charge.amount_refunded, que agora indicaria o valor acumulado
    // de US$ 80) e deduplicar re_1 pelo ID mantém o total correto.
    fetchedRefunds = refundEventInputsFromStripeRefunds([
      fetchedRefund({ id: 're_1', amount: 3000 }),
      fetchedRefund({ id: 're_2', amount: 5000 }),
    ])
    for (const row of buildRefundPaymentInserts(baseInvoice, fetchedRefunds, '2026-08-27')) {
      ledger.insert(row)
    }
    update = recomputeInvoiceFromSum(baseInvoice, ledger.sum(), '2026-08-27')

    // O total estornado é US$ 30 + US$ 50 = US$ 80, então amount_paid fica em US$ 20 - não
    // em US$ 100 - US$ 80 (acumulado) - US$ 30 (adicionado novamente) = -US$ 10, nem sofre outra contagem duplicada.
    expect(ledger.size()).toBe(3) // pi_refund_test, re_1, re_2
    expect(update).toEqual({ amount_paid: 20, balance_due: 80, status: 'partial', paid_at: null })
  })

  it('I2 (independência do payload do webhook): a lista de estornos obtida, mesmo com mais entradas do que as incorporadas ao payload do webhook (simulando charge.refunds.data truncado/ausente), é aplicada por completo', () => {
    const ledger = makeLedger()
    ledger.insert(buildPaidPaymentInsert(baseInvoice, 10000, 'pi_many_refunds', '2026-08-26'))

    // Simula o caso sinalizado pelo coordenador: a lista de estornos incorporada ao payload do webhook
    // estaria vazia ou truncada, mas a lista
    // oficial obtida (a que stripe.refunds.list realmente
    // retorna) contém todos os estornos.
    const fetchedRefunds = refundEventInputsFromStripeRefunds([
      fetchedRefund({ id: 're_a', amount: 1000 }),
      fetchedRefund({ id: 're_b', amount: 1500 }),
      fetchedRefund({ id: 're_c', amount: 2000 }),
    ])
    for (const row of buildRefundPaymentInserts(baseInvoice, fetchedRefunds, '2026-08-27')) {
      ledger.insert(row)
    }
    const update = recomputeInvoiceFromSum(baseInvoice, ledger.sum(), '2026-08-27')

    expect(ledger.size()).toBe(4) // pi_many_refunds, re_a, re_b, re_c
    expect(update).toEqual({ amount_paid: 55, balance_due: 45, status: 'partial', paid_at: null })
  })

  it('estorno excedente (total estornado maior que o valor pago) limita amount_paid a 0 em vez de deixá-lo negativo', () => {
    const ledger = makeLedger()
    ledger.insert(buildPaidPaymentInsert(baseInvoice, 10000, 'pi_over', '2026-08-26'))
    const fetchedRefunds = refundEventInputsFromStripeRefunds([fetchedRefund({ id: 're_over', amount: 20000 })])
    for (const row of buildRefundPaymentInserts(baseInvoice, fetchedRefunds, '2026-08-27')) {
      ledger.insert(row)
    }
    const update = recomputeInvoiceFromSum(baseInvoice, ledger.sum(), '2026-08-27')
    expect(update).toEqual({ amount_paid: 0, balance_due: 100, status: 'sent', paid_at: null })
  })
})

describe('fluxo do Payment Element incorporado: cada PaymentIntent pode registrar apenas um pagamento', () => {
  // O Payment Element não cria uma Checkout Session; portanto, o único
  // evento de pagamento que ele produz é payment_intent.succeeded. Estes testes garantem que
  // o fluxo novo não registre pagamentos em duplicidade, justamente o tipo de falha
  // que já ocorreu duas vezes nesta base de código.

  it('a reentrega de payment_intent.succeeded é registrada uma única vez e converge para o mesmo estado da fatura', () => {
    const ledger = makeLedger()
    const row = buildPaidPaymentInsert(baseInvoice, 10000, 'pi_embedded', '2026-08-26')

    ledger.insert(row)
    const first = recomputeInvoiceFromSum(baseInvoice, ledger.sum(), '2026-08-26')

    // A Stripe reentrega o mesmo evento (entrega pelo menos uma vez).
    ledger.insert(buildPaidPaymentInsert(baseInvoice, 10000, 'pi_embedded', '2026-08-26'))
    const second = recomputeInvoiceFromSum(baseInvoice, ledger.sum(), '2026-08-26')

    expect(ledger.size()).toBe(1)
    expect(second).toEqual(first)
    expect(second).toEqual({ amount_paid: 100, balance_due: 0, status: 'paid', paid_at: '2026-08-26' })
  })

  it('dois intents diferentes para uma fatura geram duas linhas no livro-razão, e o recálculo mantém os valores corretos', () => {
    // por exemplo, o valor mudou e um novo intent foi criado para o saldo restante.
    const ledger = makeLedger()
    ledger.insert(buildPaidPaymentInsert(baseInvoice, 4000, 'pi_first', '2026-08-26'))
    expect(recomputeInvoiceFromSum(baseInvoice, ledger.sum(), '2026-08-26')).toEqual({
      amount_paid: 40,
      balance_due: 60,
      status: 'partial',
      paid_at: null,
    })

    ledger.insert(buildPaidPaymentInsert(baseInvoice, 6000, 'pi_second', '2026-08-27'))
    expect(ledger.size()).toBe(2)
    expect(recomputeInvoiceFromSum(baseInvoice, ledger.sum(), '2026-08-27')).toEqual({
      amount_paid: 100,
      balance_due: 0,
      status: 'paid',
      paid_at: '2026-08-27',
    })
  })
})

describe('decideFailedAttempt', () => {
  const current = {
    status: 'sent',
    stripe_payment_intent_id: 'pi_current',
  }

  it('registra a tentativa atual como failed', () => {
    expect(decideFailedAttempt(current, 'pi_current')).toEqual({
      stripe_payment_status: 'failed',
    })
  })

  it('ignora uma tentativa que a fatura já substituiu', () => {
    expect(decideFailedAttempt(current, 'pi_old')).toBeNull()
  })

  it('aceita a primeira tentativa de uma fatura sem tentativa registrada', () => {
    const fresh = { status: 'sent', stripe_payment_intent_id: null }
    expect(decideFailedAttempt(fresh, 'pi_1')).toEqual({
      stripe_payment_status: 'failed',
    })
  })

  it('nunca rebaixa uma fatura paga, qualquer que seja o evento', () => {
    const paid = { ...current, status: 'paid' }
    expect(decideFailedAttempt(paid, 'pi_current')).toBeNull()
  })

  it('ignora um evento sem ID de tentativa para associar', () => {
    expect(decideFailedAttempt(current, null)).toBeNull()
  })

  it('é idempotente: reproduzir o mesmo evento resulta na mesma decisão', () => {
    const first = decideFailedAttempt(current, 'pi_current')
    const second = decideFailedAttempt(current, 'pi_current')
    expect(second).toEqual(first)
  })
})
