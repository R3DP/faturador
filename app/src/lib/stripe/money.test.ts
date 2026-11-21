import { describe, it, expect } from 'vitest'
import { amountToMinorUnits, minorUnitsToAmount } from './money'
import { buildPaymentIntentParams } from './payment-intent'

describe('amountToMinorUnits', () => {
  it('converte valores decimais da unidade principal em centavos', () => {
    expect(amountToMinorUnits(125.5)).toBe(12550)
    expect(amountToMinorUnits(1)).toBe(100)
    expect(amountToMinorUnits(0.01)).toBe(1)
  })

  it('aceita o formato de string retornado pelo Postgres para colunas DECIMAL', () => {
    expect(amountToMinorUnits('125.50')).toBe(12550)
    expect(amountToMinorUnits('0.99')).toBe(99)
  })

  it('arredonda imprecisões da representação de ponto flutuante em vez de truncar um centavo', () => {
    // 8,29 * 100 resulta em 828,9999999999999 no IEEE 754; truncar cobraria 8,28.
    expect(amountToMinorUnits(8.29)).toBe(829)
    expect(amountToMinorUnits(19.99)).toBe(1999)
    expect(amountToMinorUnits(0.29)).toBe(29)
    expect(amountToMinorUnits(1.1)).toBe(110)
  })

  it('arredonda entradas de meio centavo para baixo quando o ponto flutuante fica abaixo do ponto médio', () => {
    // Documenta o comportamento real, não uma expectativa: balance_due é um
    // DECIMAL(12,2), então um valor de meio centavo não ocorre na prática, e as duas
    // interfaces de checkout usam este helper para não divergirem.
    expect(amountToMinorUnits(1.005)).toBe(100)
  })
})

describe('o formulário de cartão cobra o valor da fatura', () => {
  // O valor do PaymentIntent deve sempre corresponder a amountToMinorUnits para o
  // saldo da fatura. O teste garante isso para valores que causam imprecisão.
  const cases = ['0.01', '19.99', '125.50', '1.005', 1000, 0.29]

  it.each(cases)('agrees on %s', (balanceDue) => {
    const intent = buildPaymentIntentParams({
      currency: 'usd',
      invoiceNumber: 'INV-1',
      balanceDue,
      invoiceId: 'inv_1',
      businessId: 'biz_1',
      publicId: 'pub_1',
    })
    expect(intent.amount).toBe(amountToMinorUnits(balanceDue))
  })
})

describe('unidades de cobrança específicas de cada moeda',()=>{
 it('cobra ienes como ienes, não como centavos',()=>{expect(amountToMinorUnits(1200,'JPY')).toBe(1200);expect(amountToMinorUnits(1200,'USD')).toBe(120000)})
 it('recusa frações de iene em vez de alterar a fatura silenciosamente',()=>expect(()=>amountToMinorUnits(1.5,'JPY')).toThrow())
 it('preserva a representação especial da Stripe para ISK e UGX',()=>{expect(amountToMinorUnits(5,'ISK')).toBe(500);expect(()=>amountToMinorUnits(5.5,'UGX')).toThrow()})
 it('recusa valores inválidos ou inseguros',()=>{for(const amount of [NaN,Infinity,-1,Number.MAX_SAFE_INTEGER])expect(()=>amountToMinorUnits(amount)).toThrow()})
})

describe('moedas com três casas decimais', () => {
  // A Stripe cobra BHD, JOD, KWD, OMR e TND em milésimos, e o valor
  // deve terminar em 0. Multiplicar por 100 cobraria apenas um décimo do valor da fatura.
  it('cobra moedas com três casas decimais em milésimos', () => {
    expect(amountToMinorUnits(10, 'kwd')).toBe(10000)
    for (const code of ['BHD', 'JOD', 'KWD', 'OMR', 'TND']) {
      expect(amountToMinorUnits(1.25, code)).toBe(1250)
    }
  })

  it('arredonda para a dezena mais próxima de unidades menores, para que o valor termine em 0', () => {
    const minor = amountToMinorUnits(10.005, 'kwd')
    expect(minor % 10).toBe(0)
    expect([10000, 10010]).toContain(minor)
    expect(amountToMinorUnits(10.006, 'KWD')).toBe(10010)
    expect(amountToMinorUnits(10.004, 'KWD')).toBe(10000)
  })

  it('converte milésimos de volta para o valor da fatura', () => {
    expect(minorUnitsToAmount(10000, 'kwd')).toBe(10)
    expect(minorUnitsToAmount(1250, 'OMR')).toBe(1.25)
  })

  it('mantém inalteradas as moedas com duas ou nenhuma casa decimal', () => {
    expect(amountToMinorUnits(10, 'USD')).toBe(1000)
    expect(amountToMinorUnits(10.5, 'EUR')).toBe(1050)
    expect(amountToMinorUnits(10, 'JPY')).toBe(10)
    expect(minorUnitsToAmount(1000, 'USD')).toBe(10)
    expect(minorUnitsToAmount(10, 'JPY')).toBe(10)
  })
})
