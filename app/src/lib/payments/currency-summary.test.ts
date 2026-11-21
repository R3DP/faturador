import { describe, expect, it } from 'vitest'
import { formatCurrencyAmount, summarizePaymentsByCurrency } from '@/lib/payments/currency-summary'

describe('resumo de pagamentos por moeda', () => {
  it('soma apenas pagamentos da mesma moeda e mantém moedas distintas separadas', () => {
    expect(summarizePaymentsByCurrency([
      { amount: 100, currency: 'USD' },
      { amount: 200, currency: 'BRL' },
      { amount: 25, currency: 'USD' },
    ])).toEqual([
      { currency: 'BRL', total: 200 },
      { currency: 'USD', total: 125 },
    ])
  })

  it('preserva a moeda alternativa quando ainda não há pagamentos', () => {
    expect(summarizePaymentsByCurrency([], 'brl')).toEqual([{ currency: 'BRL', total: 0 }])
  })

  it('formata valores em pt-BR com agrupamento e separador decimal brasileiros', () => {
    expect(formatCurrencyAmount(1234.56, 'BRL')).toBe('R$\u00a01.234,56')
  })
})
