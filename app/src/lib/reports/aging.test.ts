import { describe, it, expect } from 'vitest'
import {
  agingBucketFor,
  agingByClient,
  buildAgingReport,
  daysPastDue,
} from '@/lib/reports/aging'
import type { OpenInvoice } from '@/lib/reports/types'

const AS_OF = '2026-08-27'

function invoice(overrides: Partial<OpenInvoice> & { dueDate: string }): OpenInvoice {
  return {
    id: overrides.id ?? `inv-${overrides.dueDate}-${overrides.balanceDue ?? 0}`,
    publicId: 'pub',
    invoiceNumber: 'INV-001',
    status: 'sent',
    issueDate: '2026-01-01',
    total: 100,
    balanceDue: 100,
    currency: 'USD',
    clientId: 'client-1',
    clientName: 'Acme',
    clientEmail: null,
    ...overrides,
  }
}

describe('daysPastDue', () => {
  it('é zero na data de vencimento e negativo antes dela', () => {
    expect(daysPastDue('2026-08-27', AS_OF)).toBe(0)
    expect(daysPastDue('2026-08-28', AS_OF)).toBe(-1)
  })
  it('conta dias corridos, não períodos de 24 horas', () => {
    expect(daysPastDue('2026-08-20', AS_OF)).toBe(7)
    expect(daysPastDue('2026-07-28', AS_OF)).toBe(30)
  })
})

describe('limites de agingBucketFor', () => {
  it('considera em dia o que ainda não venceu ou vence hoje', () => {
    expect(agingBucketFor(-5)).toBe('current')
    expect(agingBucketFor(0)).toBe('current')
  })
  it('coloca exatamente 30 dias de atraso na faixa 1–30 e 31 dias na faixa 31–60', () => {
    expect(agingBucketFor(1)).toBe('d1_30')
    expect(agingBucketFor(30)).toBe('d1_30')
    expect(agingBucketFor(31)).toBe('d31_60')
  })
  it('coloca exatamente 60 dias na faixa 31–60 e 61 dias na faixa 61–90', () => {
    expect(agingBucketFor(60)).toBe('d31_60')
    expect(agingBucketFor(61)).toBe('d61_90')
  })
  it('coloca exatamente 90 dias na faixa 61–90 e 91 dias na faixa acima de 90', () => {
    expect(agingBucketFor(90)).toBe('d61_90')
    expect(agingBucketFor(91)).toBe('d90_plus')
    expect(agingBucketFor(400)).toBe('d90_plus')
  })
  it('atribui cada faixa exatamente uma vez em todo o intervalo de limites', () => {
    const seen = new Set<string>()
    for (let d = -1; d <= 120; d += 1) seen.add(agingBucketFor(d))
    expect([...seen].sort()).toEqual(['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'])
  })
})

describe('buildAgingReport', () => {
  it('classifica corretamente as faturas nos limites de faixa de ponta a ponta', () => {
    // 2026-08-27 menos 30 dias = 2026-07-28; menos 31 = 2026-07-27.
    const report = buildAgingReport(
      [
        invoice({ id: 'a', dueDate: '2026-07-28', balanceDue: 100 }),
        invoice({ id: 'b', dueDate: '2026-07-27', balanceDue: 200 }),
      ],
      AS_OF,
      'USD'
    )
    const byId = Object.fromEntries(report.buckets.map((b) => [b.id, b]))
    expect(byId.d1_30.amount).toBe(100)
    expect(byId.d1_30.invoices.map((i) => i.id)).toEqual(['a'])
    expect(byId.d31_60.amount).toBe(200)
    expect(byId.d31_60.invoices.map((i) => i.id)).toEqual(['b'])
  })

  it('separa os totais em aberto, vencidos e ainda não vencidos', () => {
    const report = buildAgingReport(
      [
        invoice({ id: 'future', dueDate: '2026-09-10', balanceDue: 500 }),
        invoice({ id: 'today', dueDate: AS_OF, balanceDue: 250 }),
        invoice({ id: 'late', dueDate: '2026-05-01', balanceDue: 1000 }),
      ],
      AS_OF,
      'USD'
    )
    expect(report.totalOutstanding).toBe(1750)
    expect(report.totalCurrent).toBe(750)
    expect(report.totalOverdue).toBe(1000)
    expect(report.oldest?.id).toBe('late')
  })

  it('soma centavos sem desvio de arredondamento por linha', () => {
    // Três linhas que, arredondadas individualmente para cima, não devem inflar o total.
    const rows = Array.from({ length: 3 }, (_, i) =>
      invoice({ id: `x${i}`, dueDate: '2026-08-01', balanceDue: 0.005 })
    )
    const report = buildAgingReport(rows, AS_OF, 'USD')
    expect(report.totalOutstanding).toBe(0.02)
  })

  it('converte strings do banco de dados em números', () => {
    const raw = invoice({ dueDate: '2026-08-01' })
    const withStrings = { ...raw, balanceDue: '125.50' as unknown as number, total: '200.00' as unknown as number }
    const report = buildAgingReport([withStrings], AS_OF, 'USD')
    expect(report.totalOutstanding).toBe(125.5)
    expect(report.buckets.find((b) => b.id === 'd1_30')?.amount).toBe(125.5)
  })

  it('retorna faixas zeradas e média zero para um livro vazio', () => {
    const report = buildAgingReport([], AS_OF, 'USD')
    expect(report.buckets).toHaveLength(5)
    expect(report.buckets[0]).toMatchObject({
      id: 'current',
      label: 'Ainda não vencida',
      short: 'Em dia',
    })
    expect(report.buckets.every((b) => b.amount === 0 && b.count === 0 && b.share === 0)).toBe(true)
    expect(report.totalOutstanding).toBe(0)
    expect(report.averageDaysOverdue).toBe(0)
    expect(report.oldest).toBeNull()
  })

  it('pondera a média de dias de atraso pelo saldo e ignora faturas ainda não vencidas', () => {
    const report = buildAgingReport(
      [
        invoice({ id: 'big', dueDate: '2026-07-28', balanceDue: 900 }), // 30 days
        invoice({ id: 'small', dueDate: '2026-08-17', balanceDue: 100 }), // 10 days
        invoice({ id: 'future', dueDate: '2026-09-30', balanceDue: 5000 }),
      ],
      AS_OF,
      'USD'
    )
    // (900*30 + 100*10) / 1000 = 28
    expect(report.averageDaysOverdue).toBe(28)
  })

  it('soma as participações em 100 entre as faixas quando há valores em aberto', () => {
    const report = buildAgingReport(
      [
        invoice({ id: 'a', dueDate: '2026-08-01', balanceDue: 300 }),
        invoice({ id: 'b', dueDate: '2026-01-01', balanceDue: 700 }),
      ],
      AS_OF,
      'USD'
    )
    const total = report.buckets.reduce((sum, b) => sum + b.share, 0)
    expect(Math.round(total)).toBe(100)
  })

  it('indica truncamento quando o conjunto de linhas foi limitado', () => {
    expect(buildAgingReport([], AS_OF, 'USD', { truncated: true }).truncated).toBe(true)
  })
})

describe('agingByClient', () => {
  it('ordena pelo saldo vencido e mantém a pior faixa de cada cliente', () => {
    const report = buildAgingReport(
      [
        invoice({ id: '1', clientId: 'c1', clientName: 'Acme', dueDate: '2026-08-20', balanceDue: 100 }),
        invoice({ id: '2', clientId: 'c1', clientName: 'Acme', dueDate: '2026-01-01', balanceDue: 400 }),
        invoice({ id: '3', clientId: 'c2', clientName: 'Globex', dueDate: '2026-08-26', balanceDue: 50 }),
        invoice({ id: '4', clientId: 'c3', clientName: 'Initech', dueDate: '2026-12-01', balanceDue: 9000 }),
      ],
      AS_OF,
      'USD'
    )
    const rows = agingByClient(report)
    expect(rows[0].clientName).toBe('Acme')
    expect(rows[0].overdue).toBe(500)
    expect(rows[0].worstBucket).toBe('d90_plus')
    expect(rows[0].invoiceCount).toBe(2)
    // A Initech deve o maior valor, mas nada venceu ainda; por isso fica por último.
    expect(rows[rows.length - 1].clientName).toBe('Initech')
    expect(rows[rows.length - 1].overdue).toBe(0)
    expect(rows[rows.length - 1].outstanding).toBe(9000)
  })
})
