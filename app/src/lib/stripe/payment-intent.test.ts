import { describe, it, expect } from 'vitest'
import {
  buildPaymentIntentParams,
  decidePaymentIntentReuse,
  isIntentSettled,
  type ExistingPaymentIntent,
} from './payment-intent'

const input = {
  currency: 'USD',
  invoiceNumber: 'INV-0007',
  balanceDue: 125.5,
  invoiceId: 'inv_1',
  businessId: 'biz_1',
  publicId: 'pub_1',
}

describe('buildPaymentIntentParams', () => {
  it('recalcula o valor no servidor e converte a moeda para minúsculas', () => {
    const params = buildPaymentIntentParams(input)
    expect(params.amount).toBe(12550)
    expect(params.currency).toBe('usd')
  })

  it('grava metadados de fatura/empresa/ID público para que todos os handlers de webhook encontrem a fatura', () => {
    // payment_intent.succeeded, charge.refunded e charge.dispute.created
    // recebem o PaymentIntent ou a cobrança, nunca uma Checkout Session; por isso,
    // estes metadados são a única associação confiável à fatura.
    expect(buildPaymentIntentParams(input).metadata).toEqual({
      invoice_id: 'inv_1',
      business_id: 'biz_1',
      public_id: 'pub_1',
    })
  })

  it('cria uma cobrança simples nesta conta, sem tarifa nem campos de transferência', () => {
    const params = buildPaymentIntentParams({
      currency: 'USD',
      invoiceNumber: 'INV-1001',
      balanceDue: 150,
      invoiceId: 'inv_1',
      businessId: 'biz_1',
      publicId: 'pub_abc',
    })
    expect(Object.keys(params).sort()).toEqual([
      'amount',
      'automatic_payment_methods',
      'currency',
      'description',
      'metadata',
    ])
  })

  it('aceita o saldo em formato string que o Postgres retorna para colunas DECIMAL', () => {
    expect(buildPaymentIntentParams({ ...input, balanceDue: '125.50' }).amount).toBe(12550)
  })
})

function existing(overrides: Partial<ExistingPaymentIntent>): ExistingPaymentIntent {
  return { status: 'requires_payment_method', amount: 12550, currency: 'usd', ...overrides }
}

describe('isIntentSettled', () => {
  it('considera succeeded, processing e requires_capture como valores já cobrados', () => {
    expect(isIntentSettled('succeeded')).toBe(true)
    expect(isIntentSettled('processing')).toBe(true)
    expect(isIntentSettled('requires_capture')).toBe(true)
  })

  it('considera não liquidados os status anteriores ao pagamento', () => {
    expect(isIntentSettled('requires_payment_method')).toBe(false)
    expect(isIntentSettled('requires_confirmation')).toBe(false)
    expect(isIntentSettled('requires_action')).toBe(false)
    expect(isIntentSettled('canceled')).toBe(false)
  })
})

describe('decidePaymentIntentReuse', () => {
  it('cria um novo intent quando a fatura não tem nenhum', () => {
    expect(decidePaymentIntentReuse(null, 12550, 'usd')).toBe('create')
  })

  it('reutiliza um intent não pago para o mesmo valor e a mesma moeda', () => {
    expect(decidePaymentIntentReuse(existing({}), 12550, 'usd')).toBe('reuse')
    expect(decidePaymentIntentReuse(existing({ status: 'requires_confirmation' }), 12550, 'usd')).toBe(
      'reuse'
    )
    expect(decidePaymentIntentReuse(existing({ status: 'requires_action' }), 12550, 'usd')).toBe(
      'reuse'
    )
  })

  it('atualiza o intent quando o saldo devido muda (por exemplo, após um pagamento parcial)', () => {
    expect(decidePaymentIntentReuse(existing({ amount: 12550 }), 5000, 'usd')).toBe('update')
  })

  it('cria outro intent quando a moeda muda, pois a moeda de um intent não pode ser alterada', () => {
    expect(decidePaymentIntentReuse(existing({ currency: 'gbp' }), 12550, 'usd')).toBe('create')
  })

  it('não diferencia maiúsculas de minúsculas no código da moeda', () => {
    expect(decidePaymentIntentReuse(existing({ currency: 'USD' }), 12550, 'usd')).toBe('reuse')
  })

  it('cria outro intent quando o anterior foi cancelado', () => {
    expect(decidePaymentIntentReuse(existing({ status: 'canceled' }), 12550, 'usd')).toBe('create')
  })

  // Proteção contra cobrança duplicada. O webhook pode ainda não ter chegado,
  // então a fatura continua mostrando balance_due > 0; fornecer aqui um segredo
  // de cliente faria com que uma pessoa pagadora recebesse duas cobranças ao recarregar a página.
  it('recusa fornecer um intent pagável quando o valor já foi cobrado', () => {
    expect(decidePaymentIntentReuse(existing({ status: 'succeeded' }), 12550, 'usd')).toBe(
      'already_paid'
    )
    expect(decidePaymentIntentReuse(existing({ status: 'processing' }), 12550, 'usd')).toBe(
      'already_paid'
    )
    expect(decidePaymentIntentReuse(existing({ status: 'requires_capture' }), 12550, 'usd')).toBe(
      'already_paid'
    )
  })

  it('recusa mesmo quando o valor já não corresponde, em vez de atualizar um intent liquidado', () => {
    expect(decidePaymentIntentReuse(existing({ status: 'succeeded', amount: 999 }), 12550, 'usd')).toBe(
      'already_paid'
    )
  })
})
