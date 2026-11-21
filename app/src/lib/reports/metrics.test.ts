import { describe, it, expect } from 'vitest'
import {
  buildExpenseBreakdown,
  buildPnl,
  buildRevenueSeries,
  buildTimeReport,
  buildTopClients,
  expenseCategoryLabel,
} from '@/lib/reports/metrics'
import { parseReportPayload, isReportEmpty, type ReportData } from '@/lib/reports/types'
import { computeDelta, roundMoney, sumMoney, toNumber } from '@/lib/reports/money'

const RANGE = { start: '2026-01-01', end: '2026-03-31' }

function report(overrides: Partial<ReportData> = {}): ReportData {
  const base = parseReportPayload({}, RANGE)
  return { ...base, ...overrides }
}

describe('toNumber', () => {
  it('converte strings numéricas do PostgREST', () => {
    expect(toNumber('1234.56')).toBe(1234.56)
    expect(toNumber(' 10 ')).toBe(10)
  })
  it('nunca retorna NaN, Infinity, null ou undefined', () => {
    expect(toNumber(null)).toBe(0)
    expect(toNumber(undefined)).toBe(0)
    expect(toNumber('abc')).toBe(0)
    expect(toNumber(Infinity)).toBe(0)
    expect(toNumber({})).toBe(0)
  })
})

describe('acúmulo de valores monetários', () => {
  it('arredonda uma vez no final, não a cada etapa', () => {
    // 0,1 + 0,2 resulta em 0,30000000000000004 em ponto flutuante.
    expect(sumMoney(['0.1', '0.2'])).toBe(0.3)
    // Dez parcelas de um terço de centavo: arredondar a cada etapa daria 0,10; arredondar uma vez resulta em 0,03.
    expect(sumMoney(Array(10).fill('0.003'))).toBe(0.03)
  })
  it('arredonda o meio centavo para cima', () => {
    expect(roundMoney(1.005)).toBe(1.01)
    expect(roundMoney(2.344999)).toBe(2.34)
  })
})

describe('computeDelta', () => {
  it('retorna percentual null quando o período anterior foi zero', () => {
    const delta = computeDelta(500, 0)
    expect(delta.absolute).toBe(500)
    expect(delta.percent).toBeNull()
    expect(delta.direction).toBe('up')
  })
  it('trata quedas e períodos estáveis', () => {
    expect(computeDelta(80, 100).percent).toBeCloseTo(-20)
    expect(computeDelta(100, 100).direction).toBe('flat')
  })
})

describe('buildPnl', () => {
  const data = report({
    current: {
      invoiced: 10000, invoicedPaid: 6000, collected: 8000, expenses: 2500,
      invoiceCount: 4, paymentCount: 3, expenseCount: 6,
    },
    previous: {
      invoiced: 8000, invoicedPaid: 8000, collected: 9000, expenses: 4000,
      invoiceCount: 3, paymentCount: 4, expenseCount: 5,
    },
    expensesByCategory: [
      { category: 'software', amount: 1500, count: 3 },
      { category: 'travel', amount: 1000, count: 3 },
    ],
  })

  it('o regime de competência usa a receita faturada', () => {
    const pnl = buildPnl(data, 'accrual')
    expect(pnl.revenue).toBe(10000)
    expect(pnl.expenses).toBe(2500)
    expect(pnl.profit).toBe(7500)
    expect(pnl.margin).toBeCloseTo(75)
  })

  it('o regime de caixa usa a receita recebida', () => {
    const pnl = buildPnl(data, 'cash')
    expect(pnl.revenue).toBe(8000)
    expect(pnl.profit).toBe(5500)
  })

  it('compara com o período anterior usando o mesmo regime', () => {
    const pnl = buildPnl(data, 'accrual')
    expect(pnl.previousProfit).toBe(4000)
    expect(pnl.profitDelta.absolute).toBe(3500)
    expect(pnl.expensesDelta.direction).toBe('down')
  })

  it('apresenta prejuízo como lucro negativo, sem limitá-lo a zero', () => {
    const losing = report({
      current: { invoiced: 1000, invoicedPaid: 0, collected: 0, expenses: 2500, invoiceCount: 1, paymentCount: 0, expenseCount: 4 },
    })
    const pnl = buildPnl(losing, 'accrual')
    expect(pnl.profit).toBe(-1500)
    expect(pnl.margin).toBeCloseTo(-150)
  })

  it('retorna margem null em vez de dividir por receita zero', () => {
    const noRevenue = report({
      current: { invoiced: 0, invoicedPaid: 0, collected: 0, expenses: 300, invoiceCount: 0, paymentCount: 0, expenseCount: 2 },
    })
    expect(buildPnl(noRevenue, 'accrual').margin).toBeNull()
  })

  it('as linhas de despesas mostram sua participação no total e permanecem ordenadas', () => {
    const pnl = buildPnl(data, 'accrual')
    expect(pnl.lines.map((l) => l.category)).toEqual(['software', 'travel'])
    expect(pnl.lines[0].share).toBeCloseTo(60)
    expect(pnl.lines[0].label).toBe('Software')
    expect(pnl.lines.reduce((sum, l) => sum + l.amount, 0)).toBe(pnl.expenses)
  })

  it('não acumula erro de arredondamento entre muitas linhas de despesas', () => {
    const many = report({
      current: { invoiced: 0, invoicedPaid: 0, collected: 0, expenses: 33.33, invoiceCount: 0, paymentCount: 0, expenseCount: 3 },
      expensesByCategory: [
        { category: 'office', amount: 11.11, count: 1 },
        { category: 'meals', amount: 11.11, count: 1 },
        { category: 'other', amount: 11.11, count: 1 },
      ],
    })
    const pnl = buildPnl(many, 'accrual')
    expect(pnl.lines.reduce((sum, l) => sum + l.amount, 0)).toBeCloseTo(33.33, 10)
  })
})

describe('buildRevenueSeries', () => {
  const data = report({
    bucket: 'month',
    series: [
      { bucketStart: '2026-01-01', invoiced: 100, collected: 90, expenses: 10 },
      { bucketStart: '2026-02-01', invoiced: 200, collected: 150, expenses: 20 },
    ],
    previousSeries: [
      { bucketStart: '2025-11-01', invoiced: 50, collected: 40 },
      { bucketStart: '2025-12-01', invoiced: 60, collected: 55 },
    ],
  })

  it('rotula os agrupamentos pela unidade e omite a comparação quando desativada', () => {
    const points = buildRevenueSeries(data, false)
    expect(points.map((p) => p.label)).toEqual(['jan. de 2026', 'fev. de 2026'])
    expect(points[0].previousInvoiced).toBeUndefined()
  })

  it('alinha o período de comparação por posição e usa o rótulo do próprio agrupamento', () => {
    const points = buildRevenueSeries(data, true)
    expect(points[0].previousInvoiced).toBe(50)
    expect(points[0].previousLabel).toBe('nov. de 2025')
    expect(points[1].previousCollected).toBe(55)
  })

  it('rotula agrupamentos diários e semanais pela data', () => {
    const daily = report({
      bucket: 'day',
      series: [{ bucketStart: '2026-03-05', invoiced: 1, collected: 1, expenses: 0 }],
    })
    expect(buildRevenueSeries(daily, false)[0].label).toBe('5 de mar.')
  })
})

describe('buildTopClients', () => {
  const data = report({
    current: { invoiced: 1000, invoicedPaid: 0, collected: 0, expenses: 0, invoiceCount: 5, paymentCount: 0, expenseCount: 0 },
    topClients: [
      { clientId: 'a', clientName: 'Acme', invoiced: 600, paid: 600, outstanding: 0, invoiceCount: 2 },
      { clientId: 'b', clientName: 'Globex', invoiced: 300, paid: 100, outstanding: 200, invoiceCount: 2 },
      { clientId: 'c', clientName: 'Initech', invoiced: 100, paid: 0, outstanding: 100, invoiceCount: 1 },
    ],
  })

  it('calcula a participação sobre o total do período, não apenas sobre os clientes listados', () => {
    const result = buildTopClients(data)
    expect(result.rows[0].share).toBeCloseTo(60)
    expect(result.topShare).toBeCloseTo(60)
    expect(result.topThreeShare).toBeCloseTo(100)
  })

  it('trata a ausência de clientes sem dividir por zero', () => {
    const result = buildTopClients(report())
    expect(result.rows).toEqual([])
    expect(result.topShare).toBe(0)
    expect(result.topThreeShare).toBe(0)
  })
})

describe('buildExpenseBreakdown', () => {
  it('agrupa o excedente em Outros quando ultrapassa o limite, em vez de inventar cores', () => {
    const categories = ['software', 'travel', 'meals', 'office', 'supplies', 'utilities', 'marketing', 'insurance']
    const data = report({
      current: { invoiced: 0, invoicedPaid: 0, collected: 0, expenses: 800, invoiceCount: 0, paymentCount: 0, expenseCount: 8 },
      expensesByCategory: categories.map((category, i) => ({ category, amount: 100 * (8 - i), count: 1 })),
    })
    const slices = buildExpenseBreakdown(data, 6)
    expect(slices).toHaveLength(6)
    expect(slices[5].category).toBe('__other__')
    // 300 + 200 + 100 da parte final agrupada.
    expect(slices[5].amount).toBe(600)
    expect(slices[5].count).toBe(3)
    expect(slices.reduce((sum, s) => sum + s.amount, 0)).toBe(3600)
  })

  it('mantém intacta uma lista curta', () => {
    const data = report({
      current: { invoiced: 0, invoicedPaid: 0, collected: 0, expenses: 100, invoiceCount: 0, paymentCount: 0, expenseCount: 1 },
      expensesByCategory: [{ category: 'meals', amount: 100, count: 1 }],
    })
    const slices = buildExpenseBreakdown(data)
    expect(slices).toHaveLength(1)
    expect(slices[0].share).toBeCloseTo(100)
  })
})

describe('buildTimeReport', () => {
  it('converte minutos em horas e calcula a tarifa faturável', () => {
    const data = report({
      time: {
        totalMinutes: 600, billableMinutes: 450, nonBillableMinutes: 150,
        unbilledMinutes: 120, unbilledValue: 300, billableValue: 1125, entryCount: 9,
      },
    })
    const time = buildTimeReport(data)
    expect(time.totalHours).toBe(10)
    expect(time.billableHours).toBe(7.5)
    expect(time.unbilledHours).toBe(2)
    expect(time.billableRate).toBeCloseTo(75)
    expect(time.effectiveHourlyRate).toBe(150)
  })

  it('retorna zeros e tarifa null para uma semana sem horas registradas', () => {
    const time = buildTimeReport(report())
    expect(time.totalHours).toBe(0)
    expect(time.billableRate).toBe(0)
    expect(time.effectiveHourlyRate).toBeNull()
  })
})

describe('parseReportPayload', () => {
  it('converte todas as strings numéricas que a RPC pode retornar', () => {
    const data = parseReportPayload(
      {
        currency: 'EUR',
        bucket: 'week',
        range: { start: '2026-01-01', end: '2026-01-31' },
        totals: {
          current: { invoiced: '1000.50', collected: '900.25', expenses: '99.99', invoice_count: '3' },
        },
        series: [{ bucket_start: '2026-01-01', invoiced: '10.10', collected: '5.05', expenses: '1.01' }],
        top_clients: [{ client_id: 'a', client_name: 'Acme', invoiced: '500.00', paid: '0', outstanding: '500.00', invoice_count: '1' }],
        open_invoices: [{ id: 'i1', invoice_number: 'INV-1', due_date: '2026-01-15', balance_due: '250.75', total: '250.75' }],
        open_invoice_count: '1',
      },
      RANGE
    )
    expect(data.currency).toBe('EUR')
    expect(data.bucket).toBe('week')
    expect(data.current.invoiced).toBe(1000.5)
    expect(data.current.invoiceCount).toBe(3)
    expect(data.series[0].collected).toBe(5.05)
    expect(data.topClients[0].outstanding).toBe(500)
    expect(data.openInvoices[0].balanceDue).toBe(250.75)
    expect(data.openInvoiceCount).toBe(1)
  })

  it('apresenta uma conta recém-criada com valores zero, sem lançar exceção', () => {
    const data = parseReportPayload(null, RANGE)
    expect(data.current.invoiced).toBe(0)
    expect(data.series).toEqual([])
    expect(data.range).toEqual(RANGE)
    expect(isReportEmpty(data)).toBe(true)
  })

  it('deixa de estar vazio quando há qualquer registro', () => {
    const data = parseReportPayload({ totals: { current: { invoice_count: 1 } } }, RANGE)
    expect(isReportEmpty(data)).toBe(false)
  })
})

describe('expenseCategoryLabel', () => {
  it('usa o valor original como alternativa para uma categoria desconhecida', () => {
    expect(expenseCategoryLabel('professional')).toBe('Serviços profissionais')
    expect(expenseCategoryLabel('quantum')).toBe('quantum')
  })
})
