import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import { createFakeSupabase, type FakeSupabase } from '@/lib/mcp/fake-supabase'

const { refundsList } = vi.hoisted(() => ({ refundsList: vi.fn() }))
vi.mock('@/lib/stripe/client', () => ({ stripe: { refunds: { list: refundsList } } }))

import { reconcileEvent } from './reconcile'
import { STRIPE_WEBHOOK_EVENTS } from './webhook-events'

const invoice = {
  id: 'i',
  business_id: 'b',
  client_id: 'c',
  currency: 'JPY',
  total: 1000,
  amount_paid: 0,
  status: 'sent',
  stripe_payment_intent_id: 'pi_current',
}

function setup(overrides: Record<string, unknown> = {}) {
  return createFakeSupabase({
    'invoices.select': { data: { ...invoice, ...overrides }, error: null },
    'invoices.update': { data: null, error: null },
    'rpc.record_stripe_payment': { data: null, error: null },
  })
}

const event = (type: string, object: object, account?: string) =>
  ({ id: 'evt_local', type, ...(account ? { account } : {}), data: { object } }) as Stripe.Event

const updates = (db: FakeSupabase) =>
  db.calls.filter((c) => c.table === 'invoices' && c.op === 'update').map((c) => c.payload)
const ledgerWrites = (db: FakeSupabase) =>
  db.calls.filter((c) => c.table === 'record_stripe_payment')

const paid = (metadata: Record<string, string> = { invoice_id: 'i', business_id: 'b' }, currency = 'jpy') => ({
  id: 'pi_current',
  metadata,
  amount_received: 1000,
  currency,
})

beforeEach(() => {
  refundsList.mockReset()
})

describe('processamento verificado de eventos Stripe', () => {
  it('registra corretamente no banco um pagamento bem-sucedido em ienes', async () => {
    const db = setup()
    await reconcileEvent(db as never, event('payment_intent.succeeded', paid()))
    expect(ledgerWrites(db)[0]?.payload).toMatchObject({
      p_amount: 1000,
      p_provider_id: 'pi_current',
      p_invoice_id: 'i',
    })
    expect(updates(db)).toEqual([{ stripe_payment_status: 'succeeded' }])
  })

  it('recusa uma moeda incompatível antes de alterar o livro-razão', async () => {
    const db = setup()
    await expect(
      reconcileEvent(db as never, event('payment_intent.succeeded', paid(undefined, 'usd'))),
    ).rejects.toThrow('A moeda ou a empresa do evento Stripe não corresponde à fatura')
    expect(ledgerWrites(db)).toHaveLength(0)
  })

  it('recusa um PaymentIntent associado a outra empresa', async () => {
    const db = setup()
    await expect(
      reconcileEvent(
        db as never,
        event('payment_intent.succeeded', paid({ invoice_id: 'i', business_id: 'someone-else' })),
      ),
    ).rejects.toThrow('A moeda ou a empresa do evento Stripe não corresponde à fatura')
    expect(ledgerWrites(db)).toHaveLength(0)
  })

  it('ignora um evento de uma conta conectada sem alterar nada', async () => {
    const db = setup()
    await reconcileEvent(db as never, event('payment_intent.succeeded', paid(), 'acct_elsewhere'))
    expect(db.calls).toHaveLength(0)
  })

  it('ignora um PaymentIntent criado por outro aplicativo na mesma conta Stripe', async () => {
    const db = createFakeSupabase({ 'invoices.select': { data: null, error: null } })
    await reconcileEvent(
      db as never,
      event('payment_intent.succeeded', { id: 'pi_other_app', metadata: {}, amount_received: 500, currency: 'usd' }),
    )
    expect(ledgerWrites(db)).toHaveLength(0)
    expect(updates(db)).toEqual([])
  })

  it('propaga falhas de leitura do banco para que a entrega do webhook possa ser repetida', async () => {
    const db = createFakeSupabase({
      'invoices.select': { data: null, error: { message: 'database unavailable' } },
    })
    await expect(
      reconcileEvent(db as never, event('payment_intent.succeeded', paid())),
    ).rejects.toMatchObject({ message: 'database unavailable' })
  })
})

describe('tentativas de pagamento com cartão recusadas', () => {
  it('registra a recusa do cartão na fatura sem gravar no livro-razão', async () => {
    const db = setup()
    await reconcileEvent(
      db as never,
      event('payment_intent.payment_failed', {
        id: 'pi_current',
        metadata: { invoice_id: 'i' },
        currency: 'jpy',
        last_payment_error: { message: 'Your card was declined.' },
      }),
    )
    expect(updates(db)).toEqual([{ stripe_payment_status: 'failed' }])
    expect(ledgerWrites(db)).toHaveLength(0)
  })

  it('protege a gravação no banco para que um pagamento recebido durante o evento ainda prevaleça', async () => {
    const db = setup()
    await reconcileEvent(
      db as never,
      event('payment_intent.payment_failed', { id: 'pi_current', metadata: { invoice_id: 'i' }, currency: 'jpy' }),
    )
    const update = db.calls.find((c) => c.table === 'invoices' && c.op === 'update')
    expect(update?.filters).toContainEqual({ method: 'neq', args: ['status', 'paid'] })
  })

  it('ignora uma falha de uma tentativa que a fatura já deixou para trás', async () => {
    const db = setup()
    await reconcileEvent(
      db as never,
      event('payment_intent.payment_failed', { id: 'pi_superseded', metadata: { invoice_id: 'i' }, currency: 'jpy' }),
    )
    expect(updates(db)).toEqual([])
  })

  it('nunca rebaixa o status de uma fatura já paga', async () => {
    const db = setup({ status: 'paid' })
    await reconcileEvent(
      db as never,
      event('payment_intent.payment_failed', { id: 'pi_current', metadata: { invoice_id: 'i' }, currency: 'jpy' }),
    )
    expect(updates(db)).toEqual([])
  })

  it('limpa uma falha antiga quando a nova tentativa tem sucesso', async () => {
    const db = setup({ stripe_payment_status: 'failed' })
    await reconcileEvent(db as never, event('payment_intent.succeeded', paid()))
    expect(updates(db)).toEqual([{ stripe_payment_status: 'succeeded' }])
  })

  it('marca a tentativa como bem-sucedida somente se a fatura ainda aponta para esse intent', async () => {
    // Um evento de sucesso reentregue para um intent anterior não deve sobrescrever
    // o estado da tentativa mais recente da fatura.
    const db = setup({ stripe_payment_intent_id: 'pi_newer' })
    await reconcileEvent(db as never, event('payment_intent.succeeded', paid()))
    const mark = db.calls.find((c) => c.table === 'invoices' && c.op === 'update')
    expect(mark?.payload).toEqual({ stripe_payment_status: 'succeeded' })
    expect(mark?.filters).toContainEqual({ method: 'eq', args: ['id', 'i'] })
    expect(mark?.filters).toContainEqual({ method: 'eq', args: ['stripe_payment_intent_id', 'pi_current'] })
  })

  it('registra moedas com três casas decimais em milésimos', async () => {
    const db = setup({ currency: 'KWD', total: 12.345 })
    await reconcileEvent(db as never, event('payment_intent.succeeded', { ...paid(), currency: 'kwd', amount_received: 12345 }))
    expect(ledgerWrites(db)[0]?.payload).toMatchObject({ p_amount: 12.345, p_provider_id: 'pi_current' })
  })
})

describe('estornos e contestações', () => {
  it('registra cada estorno uma vez como pagamento negativo, listando os estornos desta conta', async () => {
    refundsList.mockResolvedValue({ data: [{ id: 're_1', status: 'succeeded', amount: 300 }], has_more: false })
    const db = setup()
    await reconcileEvent(
      db as never,
      event('charge.refunded', {
        id: 'ch_1',
        payment_intent: 'pi_current',
        metadata: { invoice_id: 'i', business_id: 'b' },
        currency: 'jpy',
      }),
    )
    expect(refundsList).toHaveBeenCalledWith({ charge: 'ch_1', limit: 100 })
    expect(ledgerWrites(db)[0]?.payload).toMatchObject({ p_amount: -300, p_provider_id: 're_1' })
  })

  it('registra pelo livro-razão o estorno de um pagamento anterior já contabilizado', async () => {
    // A cobrança não tem metadados e a fatura aponta para uma tentativa mais recente;
    // por isso, somente a linha do livro-razão do intent anterior permite associá-la.
    refundsList.mockResolvedValue({ data: [{ id: 're_old', status: 'succeeded', amount: 400 }], has_more: false })
    const db = createFakeSupabase({
      'invoices.select': (q) =>
        q.filters.some((f) => f.method === 'eq' && f.args[0] === 'id' && f.args[1] === 'i')
          ? { data: { ...invoice, stripe_payment_intent_id: 'pi_newer' }, error: null }
          : { data: null, error: null },
      'payments.select': { data: { invoice_id: 'i' }, error: null },
      'rpc.record_stripe_payment': { data: null, error: null },
    })
    await reconcileEvent(
      db as never,
      event('charge.refunded', { id: 'ch_old', payment_intent: 'pi_earlier', metadata: {}, currency: 'jpy' }),
    )
    const ledgerRead = db.calls.find((c) => c.table === 'payments' && c.op === 'select')
    expect(ledgerRead?.filters).toContainEqual({ method: 'eq', args: ['stripe_payment_id', 'pi_earlier'] })
    expect(refundsList).toHaveBeenCalledWith({ charge: 'ch_old', limit: 100 })
    expect(ledgerWrites(db)[0]?.payload).toMatchObject({ p_invoice_id: 'i', p_amount: -400, p_provider_id: 're_old' })
  })

  it('sinaliza uma fatura contestada', async () => {
    const db = setup()
    await reconcileEvent(db as never, event('charge.dispute.created', { payment_intent: 'pi_current', currency: 'jpy' }))
    expect(updates(db)).toContainEqual({ disputed: true })
  })

  it('sinaliza a fatura correta quando a contestação envolve um pagamento anterior já contabilizado', async () => {
    // A fatura passou para uma tentativa mais recente (seu total aumentou após
    // o primeiro pagamento), então somente o livro-razão ainda identifica o intent anterior.
    const db = createFakeSupabase({
      'invoices.select': (q) =>
        q.filters.some((f) => f.method === 'eq' && f.args[0] === 'id' && f.args[1] === 'i')
          ? { data: { ...invoice, stripe_payment_intent_id: 'pi_newer' }, error: null }
          : { data: null, error: null },
      'payments.select': { data: { invoice_id: 'i' }, error: null },
      'invoices.update': { data: null, error: null },
    })
    await reconcileEvent(db as never, event('charge.dispute.created', { payment_intent: 'pi_earlier', currency: 'jpy' }))
    const ledgerRead = db.calls.find((c) => c.table === 'payments' && c.op === 'select')
    expect(ledgerRead?.filters).toContainEqual({ method: 'eq', args: ['stripe_payment_id', 'pi_earlier'] })
    const flag = db.calls.find((c) => c.table === 'invoices' && c.op === 'update')
    expect(flag?.payload).toEqual({ disputed: true })
    expect(flag?.filters).toContainEqual({ method: 'eq', args: ['id', 'i'] })
  })
})

describe('lista de eventos do webhook', () => {
  it('processa todos os eventos indicados nas instruções de configuração e ignora os demais', async () => {
    for (const type of STRIPE_WEBHOOK_EVENTS) {
      refundsList.mockResolvedValue({ data: [], has_more: false })
      const db = setup()
      await reconcileEvent(
        db as never,
        event(type, {
          id: 'pi_current',
          payment_intent: 'pi_current',
          metadata: { invoice_id: 'i' },
          currency: 'jpy',
          amount_received: 1000,
        }),
      )
      expect(db.calls.length, type).toBeGreaterThan(0)
    }
    const ignored = setup()
    await reconcileEvent(ignored as never, event('checkout.session.completed', { metadata: { invoice_id: 'i' } }))
    expect(ignored.calls).toHaveLength(0)
  })
})
