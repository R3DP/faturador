/**
 * Faixas de atraso das contas a receber. Puro: sem React e sem E/S.
 *
 * O envelhecimento é uma FOTOGRAFIA na data informada, não um relatório por
 * período: valores devidos há dezoito meses continuam devidos hoje, então o
 * intervalo de datas selecionado nunca filtra estas faturas.
 *
 * Os limites das faixas precisam estar exatos, pois determinam qual fatura
 * será cobrada primeiro. A convenção usada aqui (e fixada pelos testes) é:
 *
 *   daysPastDue <= 0   -> "Ainda não vencida" (vencimento hoje conta como em dia)
 *   1  .. 30           -> "1 a 30 dias"
 *   31 .. 60           -> "31 a 60 dias"
 *   61 .. 90           -> "61 a 90 dias"
 *   91+                -> "Mais de 90 dias"
 *
 * Assim, uma fatura vencida exatamente há 30 dias fica na faixa de 1 a 30, e
 * uma vencida há 31 dias fica na de 31 a 60. Os limites são inclusivos e nunca
 * se sobrepõem.
 */

import { differenceInCalendarDays } from 'date-fns'
import { parseDay } from '@/lib/reports/date-ranges'
import { percentOf, roundMoney, toNumber } from '@/lib/reports/money'
import type { OpenInvoice } from '@/lib/reports/types'

export type AgingBucketId = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus'

interface AgingBucketMeta {
  id: AgingBucketId
  label: string
  /** Forma curta para eixos de gráficos e legendas. */
  short: string
  /** Explicação em linguagem simples usada em dicas e na tabela. */
  description: string
  overdue: boolean
}

const AGING_BUCKETS: AgingBucketMeta[] = [
  {
    id: 'current',
    label: 'Ainda não vencida',
    short: 'Em dia',
    description: 'Faturas em aberto cujo vencimento ainda não passou',
    overdue: false,
  },
  {
    id: 'd1_30',
    label: '1 a 30 dias',
    short: '1-30',
    description: 'Vencida há 1 a 30 dias',
    overdue: true,
  },
  {
    id: 'd31_60',
    label: '31 a 60 dias',
    short: '31-60',
    description: 'Vencida há 31 a 60 dias',
    overdue: true,
  },
  {
    id: 'd61_90',
    label: '61 a 90 dias',
    short: '61-90',
    description: 'Vencida há 61 a 90 dias',
    overdue: true,
  },
  {
    id: 'd90_plus',
    label: 'Mais de 90 dias',
    short: '90+',
    description: 'Vencida há mais de 90 dias',
    overdue: true,
  },
]

/** Dias corridos entre o vencimento e a data de referência. Negativo se ainda não venceu. */
export function daysPastDue(dueDate: string, asOf: string): number {
  if (!dueDate) return 0
  return differenceInCalendarDays(parseDay(asOf), parseDay(dueDate))
}

/** Associa a quantidade de dias de atraso à faixa correspondente. Intervalos inclusivos, sem sobreposição. */
export function agingBucketFor(days: number): AgingBucketId {
  if (days <= 0) return 'current'
  if (days <= 30) return 'd1_30'
  if (days <= 60) return 'd31_60'
  if (days <= 90) return 'd61_90'
  return 'd90_plus'
}

export interface AgedInvoice extends OpenInvoice {
  daysPastDue: number
  bucket: AgingBucketId
}

interface AgingBucketResult extends AgingBucketMeta {
  amount: number
  count: number
  /** Participação no total a receber, de 0 a 100. */
  share: number
  invoices: AgedInvoice[]
}

export interface AgingReport {
  asOf: string
  currency: string
  buckets: AgingBucketResult[]
  /** Todas as faturas em aberto, agrupadas por atraso, da data de vencimento mais recente à mais antiga. */
  invoices: AgedInvoice[]
  /** Tudo o que está em aberto, vencido ou não. */
  totalOutstanding: number
  /** Em aberto e com vencimento ultrapassado. */
  totalOverdue: number
  /** Em aberto, mas ainda não vencido. */
  totalCurrent: number
  /** Média de dias de atraso ponderada pelo saldo das faturas vencidas; zero se não houver nenhuma. */
  averageDaysOverdue: number
  /** A fatura com maior atraso, ou null. */
  oldest: AgedInvoice | null
  /** True quando o RPC limitou o conjunto de linhas; os valores são, portanto, mínimos. */
  truncated: boolean
  invoiceCount: number
}

export function buildAgingReport(
  invoices: readonly OpenInvoice[],
  asOf: string,
  currency: string,
  options: { truncated?: boolean } = {}
): AgingReport {
  const aged: AgedInvoice[] = invoices.map((invoice) => {
    const days = daysPastDue(invoice.dueDate, asOf)
    return {
      ...invoice,
      balanceDue: toNumber(invoice.balanceDue),
      total: toNumber(invoice.total),
      daysPastDue: days,
      bucket: agingBucketFor(days),
    }
  })

  // Acumula com precisão total e arredonda uma vez por faixa. Arredondar cada
  // fatura antes de somar causa divergência entre os totais e o livro contábil.
  const rawByBucket = new Map<AgingBucketId, number>()
  const rowsByBucket = new Map<AgingBucketId, AgedInvoice[]>()
  let rawTotal = 0
  let rawOverdue = 0
  let weighted = 0

  for (const invoice of aged) {
    rawByBucket.set(invoice.bucket, (rawByBucket.get(invoice.bucket) ?? 0) + invoice.balanceDue)
    const list = rowsByBucket.get(invoice.bucket)
    if (list) list.push(invoice)
    else rowsByBucket.set(invoice.bucket, [invoice])
    rawTotal += invoice.balanceDue
    if (invoice.daysPastDue > 0) {
      rawOverdue += invoice.balanceDue
      weighted += invoice.balanceDue * invoice.daysPastDue
    }
  }

  const totalOutstanding = roundMoney(rawTotal)
  const totalOverdue = roundMoney(rawOverdue)

  const buckets = AGING_BUCKETS.map((meta) => {
    const amount = roundMoney(rawByBucket.get(meta.id) ?? 0)
    const rows = (rowsByBucket.get(meta.id) ?? []).slice().sort((a, b) => b.balanceDue - a.balanceDue)
    return {
      ...meta,
      amount,
      count: rows.length,
      share: percentOf(amount, totalOutstanding),
      invoices: rows,
    }
  })

  const overdueRows = aged.filter((i) => i.daysPastDue > 0)
  const oldest = overdueRows.reduce<AgedInvoice | null>(
    (worst, row) => (worst === null || row.daysPastDue > worst.daysPastDue ? row : worst),
    null
  )

  return {
    asOf,
    currency,
    buckets,
    invoices: aged.slice().sort((a, b) => b.daysPastDue - a.daysPastDue),
    totalOutstanding,
    totalOverdue,
    totalCurrent: roundMoney(rawTotal - rawOverdue),
    averageDaysOverdue: rawOverdue === 0 ? 0 : Math.round(weighted / rawOverdue),
    oldest,
    truncated: options.truncated === true,
    invoiceCount: aged.length,
  }
}

/**
 * Clientes ordenados pelo que devem, com sua pior faixa de atraso. Esta é a
 * lista de "quem devo cobrar primeiro": ordena pelo saldo vencido e, depois,
 * pelo tempo de atraso desse saldo.
 */
export interface AgingClientRow {
  clientId: string | null
  clientName: string
  outstanding: number
  overdue: number
  worstDays: number
  worstBucket: AgingBucketId
  invoiceCount: number
}

export function agingByClient(report: AgingReport, limit = 8): AgingClientRow[] {
  const raw = new Map<string, { row: AgingClientRow; rawOutstanding: number; rawOverdue: number }>()

  for (const invoice of report.invoices) {
    const key = invoice.clientId ?? `name:${invoice.clientName}`
    const entry = raw.get(key)
    if (!entry) {
      raw.set(key, {
        row: {
          clientId: invoice.clientId,
          clientName: invoice.clientName,
          outstanding: 0,
          overdue: 0,
          worstDays: invoice.daysPastDue,
          worstBucket: invoice.bucket,
          invoiceCount: 1,
        },
        rawOutstanding: invoice.balanceDue,
        rawOverdue: invoice.daysPastDue > 0 ? invoice.balanceDue : 0,
      })
      continue
    }
    entry.rawOutstanding += invoice.balanceDue
    if (invoice.daysPastDue > 0) entry.rawOverdue += invoice.balanceDue
    entry.row.invoiceCount += 1
    if (invoice.daysPastDue > entry.row.worstDays) {
      entry.row.worstDays = invoice.daysPastDue
      entry.row.worstBucket = invoice.bucket
    }
  }

  return [...raw.values()]
    .map(({ row, rawOutstanding, rawOverdue }) => ({
      ...row,
      outstanding: roundMoney(rawOutstanding),
      overdue: roundMoney(rawOverdue),
    }))
    .sort((a, b) => b.overdue - a.overdue || b.worstDays - a.worstDays || b.outstanding - a.outstanding)
    .slice(0, limit)
}
