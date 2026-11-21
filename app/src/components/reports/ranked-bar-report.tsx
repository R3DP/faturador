'use client'

/**
 * Relatório de barras horizontais ordenadas, compartilhado por "Principais clientes" e
 * "Despesas por categoria", para que ambos tenham a mesma apresentação com dados diferentes.
 *
 * Cor: há uma única série, então todas as barras usam o mesmo tom. Escurecer as barras maiores
 * duplicaria a informação já indicada pelo comprimento e usaria uma variável visual à toa.
 * As categorias não têm uma ordem natural, então uma escala ordinal não acrescentaria informação
 * (diferentemente do relatório de vencimentos, em que a idade segue uma ordem).
 *
 * A orientação é horizontal porque as categorias têm nomes longos e geralmente são menos de dez.
 */

import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { Bar, BarChart, LabelList, XAxis, YAxis } from 'recharts'
import { EmptyState } from '@/components/shared/empty-state'
import {
  MAX_BAR_SIZE,
  moneyLabelFormatter,
  useReducedMotion,
  VizFrame,
  VizGrid,
  VizTooltip,
  VizTooltipCard,
} from '@/components/reports/chart-theme'
import { ReportCard, ReportTable } from '@/components/reports/report-card'
import { csvFilename, toCsv, withReportContext } from '@/lib/reports/csv'
import { formatMoney, formatMoneyCompact, formatPercent } from '@/lib/reports/money'
import type { ReportRange } from '@/lib/reports/date-ranges'
import type { ReactNode } from 'react'

export interface RankedRow {
  key: string
  label: string
  amount: number
  /** Participação no total da seção, de 0 a 100. */
  share: number
  /** Informação complementar exibida abaixo do rótulo na tabela, por exemplo, "3 faturas". */
  secondary?: string
  href?: string
}

export function RankedBarReport({
  title,
  description,
  slug,
  rows,
  currency,
  range,
  color,
  shareLabel,
  amountLabel,
  categoryLabel,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  footer,
  height = 240,
}: {
  title: string
  description: string
  slug: string
  rows: RankedRow[]
  currency: string
  range: ReportRange
  color: string
  shareLabel: string
  amountLabel: string
  categoryLabel: string
  emptyIcon: LucideIcon
  emptyTitle: string
  emptyDescription: string
  footer?: ReactNode
  height?: number
}) {
  const reduced = useReducedMotion()

  const csv = {
    filename: csvFilename(slug, range),
    build: () =>
      withReportContext(
        toCsv(rows, [
          { header: categoryLabel, value: (row: RankedRow) => row.label },
          { header: `${amountLabel} (${currency})`, value: (row: RankedRow) => row.amount },
          { header: shareLabel, value: (row: RankedRow) => row.share.toFixed(1) },
          ...(rows.some((row) => row.secondary)
            ? [{ header: 'Detalhe', value: (row: RankedRow) => row.secondary ?? '' }]
            : []),
        ]),
        { title, range, currency }
      ),
  }

  const table = (
    <ReportTable
      caption={`${title}, ${amountLabel.toLowerCase()} e ${shareLabel.toLowerCase()}`}
      columns={[
        { key: 'label', label: categoryLabel },
        { key: 'amount', label: amountLabel, align: 'right' },
        { key: 'share', label: shareLabel, align: 'right' },
      ]}
    >
      {rows.map((row) => (
        <tr key={row.key} className="border-b border-border/60 last:border-0">
          <th scope="row" className="px-2 py-2 text-left font-normal">
            {row.href ? (
              <Link href={row.href} className="font-medium text-foreground hover:text-primary hover:underline">
                {row.label}
              </Link>
            ) : (
              <span className="font-medium text-foreground">{row.label}</span>
            )}
            {row.secondary ? (
              <span className="block text-xs text-muted-foreground">{row.secondary}</span>
            ) : null}
          </th>
          <td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.amount, currency)}</td>
          <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
            {formatPercent(row.share, 1)}
          </td>
        </tr>
      ))}
    </ReportTable>
  )

  if (rows.length === 0) {
    return (
      <ReportCard title={title} description={description}>
        <EmptyState
          icon={emptyIcon}
          title={emptyTitle}
          description={emptyDescription}
          className="py-10"
        />
      </ReportCard>
    )
  }

  return (
    <ReportCard title={title} description={description} csv={csv} table={table} footer={footer}>
      <VizFrame height={height} label={`Gráfico de barras horizontal de ${title.toLowerCase()}, em ${currency}`}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 72, bottom: 4, left: 8 }}>
          <VizGrid horizontal={false} vertical />
          <XAxis
            type="number"
            tick={{ fontSize: 12, fill: 'var(--viz-axis)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => formatMoneyCompact(value, currency)}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fontSize: 12, fill: 'var(--viz-axis)' }}
            tickLine={false}
            axisLine={false}
            width={120}
          />
          <VizTooltip
            render={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const row = payload[0]?.payload as RankedRow | undefined
              if (!row) return null
              return (
                <VizTooltipCard
                  title={row.label}
                  rows={[
                    {
                      key: row.key,
                      name: row.secondary ?? amountLabel,
                      value: formatMoney(row.amount, currency),
                      color,
                    },
                  ]}
                  note={`${formatPercent(row.share, 1)} ${shareLabel.toLowerCase()}`}
                />
              )
            }}
          />
          <Bar
            dataKey="amount"
            fill={color}
            radius={[0, 4, 4, 0]}
            maxBarSize={MAX_BAR_SIZE}
            isAnimationActive={!reduced}
          >
            <LabelList
              dataKey="amount"
              position="right"
              offset={8}
              className="fill-foreground"
              fontSize={12}
              formatter={moneyLabelFormatter((value) => formatMoneyCompact(value, currency))}
            />
          </Bar>
        </BarChart>
      </VizFrame>
    </ReportCard>
  )
}
