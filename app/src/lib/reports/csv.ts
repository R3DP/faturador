/**
 * Serialização CSV para exportação de relatórios. Pura: cria apenas strings;
 * o download no navegador fica na camada de componentes.
 *
 * O escape é importante não só por organização: nomes de clientes iniciados
 * por =, +, - ou @ são executados como fórmulas pelo Excel e pelo Google Sheets
 * quando o arquivo é aberto. Esses valores recebem um prefixo para impedir que
 * um relatório exportado execute qualquer conteúdo.
 */

import { formatRangeLabel, type ReportRange } from '@/lib/reports/date-ranges'

export interface CsvColumn<T> {
  header: string
  value: (row: T) => string | number | null | undefined
}

const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r']

export function escapeCsvValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (FORMULA_PREFIXES.some((p) => text.startsWith(p))) text = `'${text}`
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const head = columns.map((c) => escapeCsvValue(c.header)).join(',')
  const body = rows.map((row) => columns.map((c) => escapeCsvValue(c.value(row))).join(','))
  return [head, ...body].join('\n')
}

/**
 * Acrescenta uma linha de contexto sem comentários para que o arquivo exportado
 * continue indicando seu conteúdo mesmo fora do aplicativo. Ela usa células
 * simples na primeira linha, em vez de um comentário `#`, que planilhas não entendem.
 */
export function withReportContext(
  csv: string,
  meta: { title: string; range: ReportRange; currency: string; note?: string }
): string {
  const header = [
    escapeCsvValue(meta.title),
    escapeCsvValue(formatRangeLabel(meta.range)),
    escapeCsvValue(`Valores em ${meta.currency}`),
    ...(meta.note ? [escapeCsvValue(meta.note)] : []),
  ].join(',')
  return `${header}\n\n${csv}\n`
}

/** Nome de exportação seguro para o sistema de arquivos, por exemplo billr-ar-aging-2026-01-01-to-2026-03-31.csv. */
export function csvFilename(slug: string, range: ReportRange): string {
  const clean = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `billr-${clean}-${range.start}-to-${range.end}.csv`
}
