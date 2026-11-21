/**
 * Indicadores derivados dos relatórios: lucros e perdas, série de receitas,
 * concentração de clientes, composição de despesas e resumo de horas. Funções
 * puras, sem React nem entrada/saída.
 *
 * Todas as funções recebem ReportData já analisado (números, não strings do
 * banco de dados) e retornam números prontos para exibição. Valores monetários
 * são acumulados com precisão total e arredondados uma única vez ao final de cada total.
 */

import {
  computeDelta,
  minutesToHours,
  percentOf,
  roundMoney,
  type Delta,
} from '@/lib/reports/money'
import { formatBucketLabel, type BucketUnit } from '@/lib/reports/date-ranges'
import type { CategoryTotal, ClientTotal, ReportData } from '@/lib/reports/types'

/**
 * O regime de competência contabiliza a receita quando é faturada; o regime de
 * caixa, quando o dinheiro é recebido. Profissionais autônomos costumam declarar
 * pelo regime de caixa e planejar pelo de competência, então a página oferece
 * ambos em vez de escolher um e errar para parte das pessoas.
 */
export type PnlBasis = 'accrual' | 'cash'

const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  office: 'Escritório',
  travel: 'Viagem',
  meals: 'Alimentação',
  supplies: 'Suprimentos',
  utilities: 'Contas e serviços',
  software: 'Software',
  marketing: 'Marketing',
  professional: 'Serviços profissionais',
  insurance: 'Seguros',
  mileage: 'Quilometragem',
  other: 'Outros',
}

export function expenseCategoryLabel(category: string): string {
  return EXPENSE_CATEGORY_LABELS[category] ?? category
}

interface PnlLine {
  category: string
  label: string
  amount: number
  /** Participação no total de despesas, de 0 a 100. */
  share: number
  count: number
}

export interface PnlReport {
  basis: PnlBasis
  revenue: number
  expenses: number
  profit: number
  /** Lucro como percentual da receita, de 0 a 100. Null quando não houve receita. */
  margin: number | null
  previousRevenue: number
  previousExpenses: number
  previousProfit: number
  revenueDelta: Delta
  expensesDelta: Delta
  profitDelta: Delta
  lines: PnlLine[]
}

export function buildPnl(data: ReportData, basis: PnlBasis): PnlReport {
  const revenue = basis === 'cash' ? data.current.collected : data.current.invoiced
  const expenses = data.current.expenses
  const previousRevenue = basis === 'cash' ? data.previous.collected : data.previous.invoiced
  const previousExpenses = data.previous.expenses

  // Arredonda uma vez os valores de entrada (totais do período vindos do Postgres)
  // e então faz uma única subtração. Não há arredondamento intermediário.
  const profit = roundMoney(revenue - expenses)
  const previousProfit = roundMoney(previousRevenue - previousExpenses)

  const totalExpenses = expenses
  const lines: PnlLine[] = data.expensesByCategory
    .map((row: CategoryTotal) => ({
      category: row.category,
      label: expenseCategoryLabel(row.category),
      amount: roundMoney(row.amount),
      share: percentOf(row.amount, totalExpenses),
      count: row.count,
    }))
    .sort((a, b) => b.amount - a.amount)

  return {
    basis,
    revenue: roundMoney(revenue),
    expenses: roundMoney(expenses),
    profit,
    margin: revenue === 0 ? null : percentOf(profit, revenue),
    previousRevenue: roundMoney(previousRevenue),
    previousExpenses: roundMoney(previousExpenses),
    previousProfit,
    revenueDelta: computeDelta(revenue, previousRevenue),
    expensesDelta: computeDelta(expenses, previousExpenses),
    profitDelta: computeDelta(profit, previousProfit),
    lines,
  }
}

export interface RevenuePoint {
  key: string
  label: string
  invoiced: number
  collected: number
  expenses: number
  /** Ponto na mesma posição do período de comparação, presente somente quando há comparação. */
  previousInvoiced?: number
  previousCollected?: number
  previousLabel?: string
}

/**
 * Série de receitas ao longo do tempo. Quando a comparação está ativada, os
 * agrupamentos do período anterior são alinhados POR POSIÇÃO (primeiro com
 * primeiro), não pela data. Assim, um intervalo de 30 dias compara o dia 1 com
 * o dia 1 mesmo que os meses tenham durações diferentes. O rótulo do agrupamento
 * anterior acompanha o ponto para que a dica mostre a data real, sem sugerir que
 * as datas coincidem.
 */
export function buildRevenueSeries(data: ReportData, compare: boolean): RevenuePoint[] {
  const bucket: BucketUnit = data.bucket
  return data.series.map((point, index) => {
    const prev = compare ? data.previousSeries[index] : undefined
    return {
      key: point.bucketStart,
      label: formatBucketLabel(point.bucketStart, bucket),
      invoiced: roundMoney(point.invoiced),
      collected: roundMoney(point.collected),
      expenses: roundMoney(point.expenses),
      ...(prev
        ? {
            previousInvoiced: roundMoney(prev.invoiced),
            previousCollected: roundMoney(prev.collected),
            previousLabel: formatBucketLabel(prev.bucketStart, bucket),
          }
        : {}),
    }
  })
}

interface TopClientRow extends ClientTotal {
  /** Participação na receita total faturada do período, de 0 a 100. */
  share: number
}

export interface TopClientsReport {
  rows: TopClientRow[]
  /** Total faturado para TODOS os clientes no período, não apenas os listados. */
  totalInvoiced: number
  /** Participação do maior cliente, de 0 a 100. Indicador de risco de concentração. */
  topShare: number
  /** Participação dos três maiores, de 0 a 100. */
  topThreeShare: number
}

export function buildTopClients(data: ReportData, limit = 8): TopClientsReport {
  const totalInvoiced = data.current.invoiced
  const rows = data.topClients
    .slice()
    .sort((a, b) => b.invoiced - a.invoiced)
    .slice(0, limit)
    .map((row) => ({
      ...row,
      invoiced: roundMoney(row.invoiced),
      paid: roundMoney(row.paid),
      outstanding: roundMoney(row.outstanding),
      share: percentOf(row.invoiced, totalInvoiced),
    }))

  let rawTopThree = 0
  for (const row of rows.slice(0, 3)) rawTopThree += row.invoiced

  return {
    rows,
    totalInvoiced: roundMoney(totalInvoiced),
    topShare: rows.length > 0 ? percentOf(rows[0].invoiced, totalInvoiced) : 0,
    topThreeShare: percentOf(roundMoney(rawTopThree), totalInvoiced),
  }
}

export interface TimeReport {
  totalHours: number
  billableHours: number
  nonBillableHours: number
  unbilledHours: number
  unbilledValue: number
  billableValue: number
  /** Percentual das horas registradas que são faturáveis, de 0 a 100. */
  billableRate: number
  entryCount: number
  /** Tarifa efetiva sobre horas faturáveis, ou null quando não houver horas faturáveis registradas. */
  effectiveHourlyRate: number | null
}

export function buildTimeReport(data: ReportData): TimeReport {
  const t = data.time
  const billableHours = minutesToHours(t.billableMinutes)
  return {
    totalHours: minutesToHours(t.totalMinutes),
    billableHours,
    nonBillableHours: minutesToHours(t.nonBillableMinutes),
    unbilledHours: minutesToHours(t.unbilledMinutes),
    unbilledValue: roundMoney(t.unbilledValue),
    billableValue: roundMoney(t.billableValue),
    billableRate: percentOf(t.billableMinutes, t.totalMinutes),
    entryCount: t.entryCount,
    effectiveHourlyRate: billableHours === 0 ? null : roundMoney(t.billableValue / billableHours),
  }
}

export interface ExpenseSlice {
  category: string
  label: string
  amount: number
  share: number
  count: number
}

/**
 * Composição de despesas, limitada a `limit` fatias, com o excedente agrupado em
 * "Outros". O limite é tanto uma regra de cores quanto de layout: além das
 * opções da paleta, o gráfico inventaria tons indistinguíveis para pessoas com
 * deficiência na visão de cores; por isso, o excedente é agrupado.
 */
export function buildExpenseBreakdown(data: ReportData, limit = 6): ExpenseSlice[] {
  const total = data.current.expenses
  const sorted = data.expensesByCategory.slice().sort((a, b) => b.amount - a.amount)
  if (sorted.length <= limit) {
    return sorted.map((row) => ({
      category: row.category,
      label: expenseCategoryLabel(row.category),
      amount: roundMoney(row.amount),
      share: percentOf(row.amount, total),
      count: row.count,
    }))
  }

  const head = sorted.slice(0, limit - 1)
  const tail = sorted.slice(limit - 1)
  let rawTail = 0
  let tailCount = 0
  for (const row of tail) {
    rawTail += row.amount
    tailCount += row.count
  }
  const tailAmount = roundMoney(rawTail)

  return [
    ...head.map((row) => ({
      category: row.category,
      label: expenseCategoryLabel(row.category),
      amount: roundMoney(row.amount),
      share: percentOf(row.amount, total),
      count: row.count,
    })),
    {
      category: '__other__',
      label: `Outros (${tail.length} categorias)`,
      amount: tailAmount,
      share: percentOf(tailAmount, total),
      count: tailCount,
    },
  ]
}

export interface HeadlineStat {
  id: 'collected' | 'invoiced' | 'outstanding' | 'profit'
  label: string
  value: number
  delta: Delta | null
  /** Indica se um aumento é positivo, para que a variação receba uma cor adequada. */
  upIsGood: boolean
}

export function buildHeadlineStats(
  data: ReportData,
  outstanding: number,
  basis: PnlBasis,
  compare: boolean
): HeadlineStat[] {
  const pnl = buildPnl(data, basis)
  return [
    {
      id: 'collected',
      label: 'Recebido',
      value: roundMoney(data.current.collected),
      delta: compare ? computeDelta(data.current.collected, data.previous.collected) : null,
      upIsGood: true,
    },
    {
      id: 'invoiced',
      label: 'Faturado',
      value: roundMoney(data.current.invoiced),
      delta: compare ? computeDelta(data.current.invoiced, data.previous.invoiced) : null,
      upIsGood: true,
    },
    {
      id: 'outstanding',
      label: 'Em aberto',
      value: roundMoney(outstanding),
      delta: null,
      upIsGood: false,
    },
    {
      id: 'profit',
      label: basis === 'cash' ? 'Lucro (regime de caixa)' : 'Lucro (regime de competência)',
      value: pnl.profit,
      delta: compare ? pnl.profitDelta : null,
      upIsGood: true,
    },
  ]
}
