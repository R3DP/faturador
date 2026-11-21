/**
 * Predefinições de intervalos de datas, períodos de comparação e agrupamento temporal dos relatórios.
 * Funções puras, sem React nem entrada/saída.
 *
 * Regra de fuso horário: este arquivo segue, mas não define mais, a regra de datas
 * de calendário usada em todo o aplicativo. Consulte src/lib/dates.ts para ver a
 * explicação completa. Em resumo: todas as datas dos relatórios ficam em colunas
 * DATE do Postgres. Como DATE não tem fuso horário, nada aqui converte datas de ou
 * para UTC. Datas de calendário são strings 'yyyy-MM-dd', interpretadas à meia-noite
 * LOCAL. O Postgres agrupa pelas mesmas colunas DATE com date_trunc, para que o
 * servidor e o cliente concordem sobre o dia ao qual cada linha pertence.
 *
 * parseDay / toISODate / todayISO foram movidas para src/lib/dates.ts para que o
 * restante do aplicativo (páginas de faturas, ferramentas MCP, geração de PDF e
 * conciliação Stripe) compartilhe uma única implementação, em vez de cada parte
 * manter sua própria variante. Elas são reexportadas aqui para preservar as
 * importações existentes.
 */

import { parseDay, toISODate, todayISO } from '@/lib/dates'
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  subMonths,
  subQuarters,
  subYears,
} from 'date-fns'

export type BucketUnit = 'day' | 'week' | 'month'

export interface ReportRange {
  /** Início inclusivo, no formato 'yyyy-MM-dd'. */
  start: string
  /** Fim inclusivo, no formato 'yyyy-MM-dd'. */
  end: string
}

export type RangePresetId =
  | 'this_month'
  | 'last_month'
  | 'quarter_to_date'
  | 'year_to_date'
  | 'last_12_months'
  | 'custom'

export const RANGE_PRESETS: { id: RangePresetId; label: string }[] = [
  { id: 'this_month', label: 'Este mês' },
  { id: 'last_month', label: 'Mês passado' },
  { id: 'quarter_to_date', label: 'Trimestre até hoje' },
  { id: 'year_to_date', label: 'Ano até hoje' },
  { id: 'last_12_months', label: 'Últimos 12 meses' },
  { id: 'custom', label: 'Intervalo personalizado' },
]

export { parseDay, toISODate, todayISO }

export function resolveRange(
  preset: RangePresetId,
  today: Date,
  custom?: ReportRange
): ReportRange {
  switch (preset) {
    case 'this_month':
      return { start: toISODate(startOfMonth(today)), end: toISODate(today) }
    case 'last_month': {
      const prev = subMonths(today, 1)
      return { start: toISODate(startOfMonth(prev)), end: toISODate(endOfMonth(prev)) }
    }
    case 'quarter_to_date':
      return { start: toISODate(startOfQuarter(today)), end: toISODate(today) }
    case 'year_to_date':
      return { start: toISODate(startOfYear(today)), end: toISODate(today) }
    case 'last_12_months':
      return { start: toISODate(startOfMonth(subMonths(today, 11))), end: toISODate(today) }
    case 'custom':
      return custom ?? { start: toISODate(startOfMonth(today)), end: toISODate(today) }
  }
}

/**
 * O período usado para comparar um intervalo.
 *
 * As predefinições alinhadas ao calendário são comparadas ao período equivalente
 * (mês atual com mês anterior, trimestre até hoje com o mesmo trecho do trimestre
 * anterior, ano até hoje com o mesmo trecho do ano passado), que é a comparação
 * esperada por quem administra a empresa. Um intervalo personalizado não tem
 * significado de calendário, então é comparado ao período de mesma duração
 * imediatamente anterior.
 */
export function previousRange(range: ReportRange, preset: RangePresetId): ReportRange {
  const start = parseDay(range.start)
  const end = parseDay(range.end)

  switch (preset) {
    case 'this_month': {
      const prevStart = subMonths(start, 1)
      // Alinhado ao dia do mês, limitado à duração do mês anterior para que
      // "1 a 31 de março vs. fevereiro" não avance para março.
      const prevEnd = clampToMonth(prevStart, end.getDate())
      return { start: toISODate(prevStart), end: toISODate(prevEnd) }
    }
    case 'last_month': {
      const prevStart = subMonths(start, 1)
      return { start: toISODate(prevStart), end: toISODate(endOfMonth(prevStart)) }
    }
    case 'quarter_to_date': {
      const prevStart = subQuarters(start, 1)
      const daysIn = differenceInCalendarDays(end, start)
      return { start: toISODate(prevStart), end: toISODate(addDays(prevStart, daysIn)) }
    }
    case 'year_to_date': {
      const prevStart = subYears(start, 1)
      const daysIn = differenceInCalendarDays(end, start)
      return { start: toISODate(prevStart), end: toISODate(addDays(prevStart, daysIn)) }
    }
    case 'last_12_months': {
      const prevStart = subMonths(start, 12)
      const daysIn = differenceInCalendarDays(end, start)
      return { start: toISODate(prevStart), end: toISODate(addDays(prevStart, daysIn)) }
    }
    case 'custom':
    default: {
      const daysIn = differenceInCalendarDays(end, start)
      const prevEnd = addDays(start, -1)
      return { start: toISODate(addDays(prevEnd, -daysIn)), end: toISODate(prevEnd) }
    }
  }
}

function clampToMonth(monthAnchor: Date, dayOfMonth: number): Date {
  const last = endOfMonth(monthAnchor).getDate()
  return new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), Math.min(dayOfMonth, last))
}

/** Quantidade inclusiva de dias de um intervalo. */
export function rangeLengthInDays(range: ReportRange): number {
  return differenceInCalendarDays(parseDay(range.end), parseDay(range.start)) + 1
}

/**
 * Granularidade de agrupamento do intervalo: pontos suficientes para mostrar a
 * tendência, mas poucos o bastante para manter o eixo legível. É determinada
 * somente pelo intervalo, para que o servidor e o gráfico sempre concordem.
 */
export function chooseBucket(range: ReportRange): BucketUnit {
  const days = rangeLengthInDays(range)
  if (days <= 31) return 'day'
  if (days <= 120) return 'week'
  return 'month'
}

/** Início de cada agrupamento do intervalo, conforme date_trunc do Postgres (semanas começam na segunda-feira). */
export function enumerateBuckets(range: ReportRange, bucket: BucketUnit): string[] {
  const end = parseDay(range.end)
  let cursor = truncateToBucket(parseDay(range.start), bucket)
  const out: string[] = []
  // Limite máximo bem além de qualquer intervalo realista, para impedir um loop infinito causado por entrada inválida.
  for (let i = 0; i < 2000 && cursor <= end; i += 1) {
    out.push(toISODate(cursor))
    cursor =
      bucket === 'day' ? addDays(cursor, 1) : bucket === 'week' ? addDays(cursor, 7) : addMonths(cursor, 1)
  }
  return out
}

function truncateToBucket(date: Date, bucket: BucketUnit): Date {
  if (bucket === 'day') return date
  if (bucket === 'week') return startOfWeek(date, { weekStartsOn: 1 })
  return startOfMonth(date)
}

/** Agrupamento ao qual pertence uma data de calendário, como string da data inicial. */
export function bucketKeyFor(iso: string, bucket: BucketUnit): string {
  return toISODate(truncateToBucket(parseDay(iso), bucket))
}

const MONTHS_PT_BR = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.']

export function formatBucketLabel(iso: string, bucket: BucketUnit): string {
  const date = parseDay(iso)
  const month = MONTHS_PT_BR[date.getMonth()]
  if (bucket === 'day' || bucket === 'week') return `${date.getDate()} de ${month}`
  return `${month} de ${date.getFullYear()}`
}

export function formatRangeLabel(range: ReportRange): string {
  const start = parseDay(range.start)
  const end = parseDay(range.end)
  const sameYear = start.getFullYear() === end.getFullYear()
  const startLabel = `${start.getDate()} de ${MONTHS_PT_BR[start.getMonth()]}`
  const endLabel = `${end.getDate()} de ${MONTHS_PT_BR[end.getMonth()]}`
  return sameYear
    ? `${startLabel} a ${endLabel} de ${end.getFullYear()}`
    : `${startLabel} de ${start.getFullYear()} a ${endLabel} de ${end.getFullYear()}`
}

/** Indica se um intervalo personalizado é válido (as duas extremidades estão presentes e o início não vem depois do fim). */
export function isValidRange(range: ReportRange): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(range.start) || !/^\d{4}-\d{2}-\d{2}$/.test(range.end)) return false
  return range.start <= range.end
}
