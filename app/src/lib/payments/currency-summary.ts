export interface CurrencyAmount {
  amount: number
  currency: string
}

export interface CurrencyTotal {
  currency: string
  total: number
}

export function summarizePaymentsByCurrency(
  payments: CurrencyAmount[],
  fallbackCurrency = 'USD',
): CurrencyTotal[] {
  const totals = new Map<string, number>()

  for (const payment of payments) {
    const currency = payment.currency.toUpperCase()
    totals.set(currency, (totals.get(currency) ?? 0) + payment.amount)
  }

  if (totals.size === 0) totals.set(fallbackCurrency.toUpperCase(), 0)

  return Array.from(totals, ([currency, total]) => ({ currency, total }))
    .sort((left, right) => left.currency.localeCompare(right.currency))
}

export function formatCurrencyAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount)
}
