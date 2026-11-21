// Regras de unidades de cobrança do Stripe: https://docs.stripe.com/currencies#zero-decimal
const ZERO_DECIMAL = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
])
// Moedas com três casas decimais são cobradas em milésimos, e o Stripe exige
// que o valor termine em 0: https://docs.stripe.com/currencies#three-decimal
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND'])
function chargeFactor(currency: string): number {
  const code = currency.toUpperCase()
  if (ZERO_DECIMAL.has(code)) return 1
  if (THREE_DECIMAL.has(code)) return 1000
  return 100
}
export function amountToMinorUnits(
  value: number | string,
  currency = 'USD'
): number {
  const amount = Number(value),
    code = currency.toUpperCase(),
    factor = chargeFactor(code)
  if (!Number.isFinite(amount) || amount < 0)
    throw new Error('Valor de pagamento inválido')
  if (
    (factor === 1 || code === 'ISK' || code === 'UGX') &&
    !Number.isInteger(amount)
  )
    throw new Error(`Pagamentos em ${code} exigem um valor em unidades inteiras da moeda`)
  const minor =
    factor === 1000
      ? Math.round((amount * factor) / 10) * 10
      : Math.round(amount * factor)
  if (!Number.isSafeInteger(minor))
    throw new Error('O valor do pagamento é muito alto')
  return minor
}
export function minorUnitsToAmount(value: number, currency: string): number {
  if (!Number.isSafeInteger(value)) throw new Error('Valor do Stripe inválido')
  return value / chargeFactor(currency)
}
