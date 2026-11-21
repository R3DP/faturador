import { describe, it, expect } from 'vitest'
import { computePaymentUpdate } from './payment-math'

describe('computePaymentUpdate', () => {
  it('pagamento integral marca como pago, saldo 0', () => {
    expect(computePaymentUpdate({ total: 100, amount_paid: 0 }, 100))
      .toEqual({ amount_paid: 100, balance_due: 0, status: 'paid' })
  })
  it('pagamento parcial marca como parcial', () => {
    expect(computePaymentUpdate({ total: 100, amount_paid: 0 }, 40))
      .toEqual({ amount_paid: 40, balance_due: 60, status: 'partial' })
  })
  it('pagamento excedente limita o saldo a 0 e marca como pago', () => {
    expect(computePaymentUpdate({ total: 100, amount_paid: 0 }, 150))
      .toEqual({ amount_paid: 150, balance_due: 0, status: 'paid' })
  })
  it('estorno que zera o valor pago retorna ao status enviado', () => {
    expect(computePaymentUpdate({ total: 100, amount_paid: 100 }, -100))
      .toEqual({ amount_paid: 0, balance_due: 100, status: 'sent' })
  })
  it('estorno parcial mantém o status parcial', () => {
    expect(computePaymentUpdate({ total: 100, amount_paid: 100 }, -40))
      .toEqual({ amount_paid: 60, balance_due: 40, status: 'partial' })
  })
})
