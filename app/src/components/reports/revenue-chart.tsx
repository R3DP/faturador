'use client'

/**
 * Receitas ao longo do tempo: valores faturados em comparação aos efetivamente recebidos.
 *
 * São exibidas duas barras por período, em um único eixo. Valores faturados e recebidos usam
 * a mesma unidade (dinheiro na moeda selecionada) e, portanto, compartilham a escala e podem
 * ser comparados com clareza; não há um segundo eixo Y.
 *
 * O período de comparação aparece como uma única linha discreta, em vez de duas barras
 * adicionais: quatro barras por período gerariam ruído, e as variações de cada série já aparecem
 * na faixa de indicadores acima.
 */

import { Bar, ComposedChart, Line } from 'recharts'
import { EmptyState } from '@/components/shared/empty-state'
import { LineChart as LineChartIcon } from 'lucide-react'
import {
  BAR_RADIUS,
  MAX_BAR_SIZE,
  useReducedMotion,
  VizFrame,
  VizGrid,
  VizLegend,
  VizTooltip,
  VizTooltipCard,
  VizXAxis,
  VizYAxis,
} from '@/components/reports/chart-theme'
import { ReportCard, ReportTable } from '@/components/reports/report-card'
import { csvFilename, toCsv, withReportContext } from '@/lib/reports/csv'
import { formatMoney, formatMoneyCompact } from '@/lib/reports/money'
import { SERIES_COLORS } from '@/lib/reports/palette'
import { buildRevenueSeries, type RevenuePoint } from '@/lib/reports/metrics'
import type { ReportData } from '@/lib/reports/types'

export function RevenueChart({
  data,
  compare,
  bucketNoun,
}: {
  data: ReportData
  compare: boolean
  bucketNoun: string
}) {
  const reduced = useReducedMotion()
  const points = buildRevenueSeries(data, compare)
  const currency = data.currency
  const hasActivity = points.some((p) => p.invoiced !== 0 || p.collected !== 0)

  const legend = [
    { key: 'invoiced', label: 'Faturado', color: SERIES_COLORS.invoiced, mark: 'rect' as const },
    { key: 'collected', label: 'Recebido', color: SERIES_COLORS.collected, mark: 'rect' as const },
    ...(compare
      ? [
          {
            key: 'previous',
            label: 'Faturado no período anterior',
            color: SERIES_COLORS.previous,
            mark: 'line' as const,
          },
        ]
      : []),
  ]

  const csv = {
    filename: csvFilename('revenue-over-time', data.range),
    build: () =>
      withReportContext(
        toCsv(points, [
          { header: bucketNoun, value: (row: RevenuePoint) => row.label },
          { header: 'Início do período', value: (row: RevenuePoint) => row.key },
          { header: `Faturado (${currency})`, value: (row: RevenuePoint) => row.invoiced },
          { header: `Recebido (${currency})`, value: (row: RevenuePoint) => row.collected },
          ...(compare
            ? [
                { header: 'Período anterior', value: (row: RevenuePoint) => row.previousLabel ?? '' },
                {
                  header: `Faturado no período anterior (${currency})`,
                  value: (row: RevenuePoint) => row.previousInvoiced ?? '',
                },
                {
                  header: `Recebido no período anterior (${currency})`,
                  value: (row: RevenuePoint) => row.previousCollected ?? '',
                },
              ]
            : []),
        ]),
        { title: 'Receitas ao longo do tempo', range: data.range, currency }
      ),
  }

  const table = (
    <ReportTable
      caption="Receita faturada e recebida por período"
      columns={[
        { key: 'period', label: bucketNoun },
        { key: 'invoiced', label: 'Faturado', align: 'right' },
        { key: 'collected', label: 'Recebido', align: 'right' },
        ...(compare ? [{ key: 'previous', label: 'Faturado no período anterior', align: 'right' as const }] : []),
      ]}
    >
      {points.map((point) => (
        <tr key={point.key} className="border-b border-border/60 last:border-0">
          <th scope="row" className="px-2 py-1.5 text-left font-normal text-foreground">
            {point.label}
          </th>
          <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(point.invoiced, currency)}</td>
          <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(point.collected, currency)}</td>
          {compare ? (
            <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
              {point.previousInvoiced === undefined ? '-' : formatMoney(point.previousInvoiced, currency)}
            </td>
          ) : null}
        </tr>
      ))}
    </ReportTable>
  )

  return (
    <ReportCard
      title="Receitas ao longo do tempo"
      description={`Faturado em comparação ao recebido, por ${bucketNoun.toLowerCase()}`}
      csv={csv}
      table={hasActivity ? table : undefined}
    >
      {!hasActivity ? (
        <EmptyState
          icon={LineChartIcon}
          title="Nenhuma receita neste período"
          description="Quando você enviar uma fatura ou registrar um pagamento neste período, a tendência aparecerá aqui."
          className="py-10"
        />
      ) : (
        <>
          <VizLegend items={legend} className="mb-3" />
          <VizFrame
            height={280}
            label={`Gráfico de barras da receita faturada e recebida por ${bucketNoun.toLowerCase()}, na moeda ${currency}`}
          >
            <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
              <VizGrid />
              <VizXAxis dataKey="label" />
              <VizYAxis tickFormatter={(value) => formatMoneyCompact(value, currency)} />
              <VizTooltip
                render={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const point = payload[0]?.payload as RevenuePoint | undefined
                  if (!point) return null
                  return (
                    <VizTooltipCard
                      title={point.label}
                      rows={[
                        {
                          key: 'invoiced',
                          name: 'Faturado',
                          value: formatMoney(point.invoiced, currency),
                          color: SERIES_COLORS.invoiced,
                        },
                        {
                          key: 'collected',
                          name: 'Recebido',
                          value: formatMoney(point.collected, currency),
                          color: SERIES_COLORS.collected,
                        },
                        ...(compare && point.previousInvoiced !== undefined
                          ? [
                              {
                                key: 'previous',
                                name: `Faturado, ${point.previousLabel}`,
                                value: formatMoney(point.previousInvoiced, currency),
                                color: SERIES_COLORS.previous,
                                mark: 'line' as const,
                              },
                            ]
                          : []),
                      ]}
                    />
                  )
                }}
              />
              <Bar
                dataKey="invoiced"
                name="Faturado"
                fill={SERIES_COLORS.invoiced}
                radius={BAR_RADIUS}
                maxBarSize={MAX_BAR_SIZE}
                isAnimationActive={!reduced}
              />
              <Bar
                dataKey="collected"
                name="Recebido"
                fill={SERIES_COLORS.collected}
                radius={BAR_RADIUS}
                maxBarSize={MAX_BAR_SIZE}
                isAnimationActive={!reduced}
              />
              {compare ? (
                <Line
                  type="monotone"
                  dataKey="previousInvoiced"
                  name="Faturado no período anterior"
                  stroke={SERIES_COLORS.previous}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--viz-surface)' }}
                  isAnimationActive={!reduced}
                />
              ) : null}
            </ComposedChart>
          </VizFrame>
        </>
      )}
    </ReportCard>
  )
}
