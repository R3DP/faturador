'use client'

/**
 * Envelhecimento de contas a receber - um relatório que leva a uma ação.
 *
 * Ele responde a três perguntas: quanto está atrasado, há quanto tempo e quem devo
 * contatar. Por isso, o cartão começa pelo valor vencido e mostra as faixas em um gráfico
 * de barras horizontal (cinco faixas ordenadas e com nomes longos ficam mais legíveis assim),
 * além de permitir abrir as faturas de cada faixa.
 *
 * Cor: as faixas usam uma escala ordinal, com um único tom que escurece com o tempo, pois
 * a idade tem uma ordem natural. "Ainda não vencido" fica fora da escala, em
 * cinza discreto - é contexto, não uma etapa do atraso. Cada barra também recebe
 * o valor correspondente como rótulo, para que nenhuma informação dependa apenas da cor.
 */

import { useState } from 'react'
import Link from 'next/link'
import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from 'recharts'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/shared/empty-state'
import { cn } from '@/lib/utils'
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
import { AGING_COLORS } from '@/lib/reports/palette'
import {
  agingByClient,
  type AgedInvoice,
  type AgingBucketId,
  type AgingReport as AgingReportData,
} from '@/lib/reports/aging'
import { formatBucketLabel } from '@/lib/reports/date-ranges'
import type { ReportData } from '@/lib/reports/types'

const HORIZONTAL_RADIUS: [number, number, number, number] = [0, 4, 4, 0]

export function AgingReport({
  data,
  report,
  asOf,
}: {
  data: ReportData
  /** Calculado uma vez pela página para manter os indicadores e este cartão consistentes. */
  report: AgingReportData
  asOf: string
}) {
  const reduced = useReducedMotion()
  const [selected, setSelected] = useState<AgingBucketId | 'all'>('all')

  const currency = data.currency

  const chartRows = report.buckets.map((bucket) => ({
    id: bucket.id,
    label: bucket.short,
    full: bucket.label,
    description: bucket.description,
    amount: bucket.amount,
    count: bucket.count,
    share: bucket.share,
  }))

  const visible =
    selected === 'all' ? report.invoices : report.buckets.find((b) => b.id === selected)?.invoices ?? []

  const clients = agingByClient(report)

  const csv = {
    filename: csvFilename('ar-aging', data.range),
    build: () =>
      withReportContext(
        toCsv(report.invoices, [
          { header: 'Fatura', value: (row: AgedInvoice) => row.invoiceNumber },
          { header: 'Cliente', value: (row: AgedInvoice) => row.clientName },
          { header: 'E-mail do cliente', value: (row: AgedInvoice) => row.clientEmail ?? '' },
          { header: 'Situação', value: (row: AgedInvoice) => row.status },
          { header: 'Emitida em', value: (row: AgedInvoice) => row.issueDate },
          { header: 'Vencimento', value: (row: AgedInvoice) => row.dueDate },
          { header: 'Dias em atraso', value: (row: AgedInvoice) => row.daysPastDue },
          {
            header: 'Faixa',
            value: (row: AgedInvoice) => report.buckets.find((b) => b.id === row.bucket)?.label ?? '',
          },
          { header: `Total da fatura (${currency})`, value: (row: AgedInvoice) => row.total },
          { header: `Saldo a pagar (${currency})`, value: (row: AgedInvoice) => row.balanceDue },
        ]),
        {
          title: 'Envelhecimento de contas a receber',
          range: data.range,
          currency,
          note: `Em ${asOf}${report.truncated ? `; limitado a ${data.openInvoices.length} de ${data.openInvoiceCount} faturas em aberto` : ''}`,
        }
      ),
  }

  const table = (
    <ReportTable
      caption="Saldo a receber por faixa de vencimento"
      columns={[
        { key: 'bucket', label: 'Faixa' },
        { key: 'invoices', label: 'Faturas', align: 'right' },
        { key: 'amount', label: 'Saldo', align: 'right' },
        { key: 'share', label: 'Participação', align: 'right' },
      ]}
    >
      {report.buckets.map((bucket) => (
        <tr key={bucket.id} className="border-b border-border/60 last:border-0">
          <th scope="row" className="px-2 py-1.5 text-left font-normal text-foreground">
            {bucket.label}
          </th>
          <td className="px-2 py-1.5 text-right tabular-nums">{bucket.count}</td>
          <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(bucket.amount, currency)}</td>
          <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
            {formatPercent(bucket.share)}
          </td>
        </tr>
      ))}
      <tr className="border-t border-border font-medium">
        <th scope="row" className="px-2 py-1.5 text-left">
          Total em aberto
        </th>
        <td className="px-2 py-1.5 text-right tabular-nums">{report.invoiceCount}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">
          {formatMoney(report.totalOutstanding, currency)}
        </td>
        <td className="px-2 py-1.5 text-right" />
      </tr>
    </ReportTable>
  )

  if (report.invoiceCount === 0) {
    return (
      <ReportCard
        title="Envelhecimento de contas a receber"
        description="Todas as faturas em aberto, ordenadas pelo tempo de atraso"
      >
        <EmptyState
          icon={CheckCircle2}
          title="Nada em aberto"
          description="Não há faturas em aberto no momento. Quando uma fatura estiver aguardando pagamento, ela aparecerá aqui com o tempo de atraso."
          className="py-10"
        />
      </ReportCard>
    )
  }

  return (
    <ReportCard
      title="Envelhecimento de contas a receber"
      description="Todas as faturas em aberto, ordenadas pelo tempo de atraso"
      csv={csv}
      table={table}
      footer={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>Em {formatBucketLabel(asOf, 'day')}. O envelhecimento não considera o período selecionado acima.</span>
          {report.truncated ? (
            <span className="text-warning">
              Exibindo as {data.openInvoices.length} faturas em aberto mais antigas de {data.openInvoiceCount}; portanto,
              estes totais são valores mínimos.
            </span>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground">Total vencido</p>
            <p className="mt-0.5 text-3xl font-semibold tracking-tight text-foreground">
              {formatMoney(report.totalOverdue, currency)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              de {formatMoney(report.totalOutstanding, currency)} em aberto em {report.invoiceCount}{' '}
              {report.invoiceCount === 1 ? 'fatura' : 'faturas'}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Média de dias em atraso</dt>
              <dd className="mt-0.5 font-medium tabular-nums text-foreground">
                {report.averageDaysOverdue}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Maior atraso</dt>
              <dd className="mt-0.5 font-medium tabular-nums text-foreground">
                {report.oldest ? `${report.oldest.daysPastDue} dias` : 'Sem atraso'}
              </dd>
            </div>
          </dl>
          {report.oldest ? (
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden />
                Priorize a cobrança
              </p>
              <Link
                href={`/invoices/${report.oldest.id}`}
                className="mt-1 block text-sm font-medium text-primary hover:underline"
              >
                {report.oldest.invoiceNumber}
              </Link>
              <p className="text-xs text-muted-foreground">
                {report.oldest.clientName} deve {formatMoney(report.oldest.balanceDue, currency)},{' '}
                com {report.oldest.daysPastDue} dias de atraso
              </p>
            </div>
          ) : null}
        </div>

        <div className="min-w-0">
          <VizFrame
            height={220}
            label={`Gráfico de barras horizontal do saldo em aberto por faixa de atraso, em ${currency}`}
          >
            <BarChart
              data={chartRows}
              layout="vertical"
              margin={{ top: 4, right: 72, bottom: 4, left: 8 }}
              onClick={(state) => {
                const index = typeof state?.activeIndex === 'number' ? state.activeIndex : Number(state?.activeIndex)
                const row = Number.isInteger(index) ? chartRows[index] : undefined
                if (row) setSelected((current) => (current === row.id ? 'all' : row.id))
              }}
            >
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
                width={56}
              />
              <VizTooltip
                render={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0]?.payload as (typeof chartRows)[number] | undefined
                  if (!row) return null
                  return (
                    <VizTooltipCard
                      title={row.full}
                      rows={[
                        {
                          key: 'amount',
                          name: `${row.count} ${row.count === 1 ? 'fatura' : 'faturas'}`,
                          value: formatMoney(row.amount, currency),
                          color: AGING_COLORS[row.id],
                        },
                      ]}
                      note={`${formatPercent(row.share)} do total em aberto`}
                    />
                  )
                }}
              />
              <Bar
                dataKey="amount"
                radius={HORIZONTAL_RADIUS}
                maxBarSize={MAX_BAR_SIZE}
                isAnimationActive={!reduced}
              >
                {chartRows.map((row) => (
                  <Cell
                    key={row.id}
                    fill={AGING_COLORS[row.id]}
                    fillOpacity={selected === 'all' || selected === row.id ? 1 : 0.35}
                  />
                ))}
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

          <div className="mt-2 flex flex-wrap gap-1.5">
            <BucketChip active={selected === 'all'} onClick={() => setSelected('all')}>
              Todas em aberto ({report.invoiceCount})
            </BucketChip>
            {report.buckets
              .filter((bucket) => bucket.count > 0)
              .map((bucket) => (
                <BucketChip
                  key={bucket.id}
                  active={selected === bucket.id}
                  color={AGING_COLORS[bucket.id]}
                  onClick={() => setSelected(bucket.id)}
                >
                  {bucket.label} ({bucket.count})
                </BucketChip>
              ))}
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground">
            {selected === 'all'
              ? 'Faturas em aberto'
              : report.buckets.find((b) => b.id === selected)?.label}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {visible.length} {visible.length === 1 ? 'fatura' : 'faturas'}, mais antigas primeiro
          </p>
          <div className="mt-3 max-h-80 overflow-y-auto overflow-x-hidden px-2">
            <ReportTable
              caption="Faturas em aberto na faixa de vencimento selecionada"
              columns={[
                { key: 'invoice', label: 'Fatura' },
                { key: 'due', label: 'Dias em atraso', align: 'right' },
                { key: 'balance', label: 'Saldo', align: 'right' },
              ]}
            >
              {visible.map((invoice) => (
                <tr key={invoice.id} className="border-b border-border/60 last:border-0">
                  <th scope="row" className="px-2 py-2 text-left font-normal">
                    <Link
                      href={`/invoices/${invoice.id}`}
                      className="font-medium text-foreground hover:text-primary hover:underline"
                    >
                      {invoice.invoiceNumber}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{invoice.clientName}</span>
                  </th>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {invoice.daysPastDue > 0 ? (
                      <span className="font-medium text-foreground">{invoice.daysPastDue}</span>
                    ) : (
                      <Badge variant="secondary">Ainda não vencida</Badge>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right font-medium tabular-nums">
                    {formatMoney(invoice.balanceDue, currency)}
                  </td>
                </tr>
              ))}
            </ReportTable>
          </div>
        </div>

        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground">Quem cobrar</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Clientes ordenados pelo saldo em atraso e, em seguida, pelo tempo de atraso
          </p>
          <ul className="mt-3 space-y-2.5">
            {clients.map((client) => (
              <li key={client.clientId ?? client.clientName} className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                  style={{ backgroundColor: AGING_COLORS[client.worstBucket] }}
                />
                <div className="min-w-0 flex-1">
                  {client.clientId ? (
                    <Link
                      href={`/clients/${client.clientId}`}
                      className="block truncate text-sm font-medium text-foreground hover:text-primary hover:underline"
                    >
                      {client.clientName}
                    </Link>
                  ) : (
                    <span className="block truncate text-sm font-medium text-foreground">
                      {client.clientName}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {client.invoiceCount} em aberto,{' '}
                    {client.worstDays > 0 ? `até ${client.worstDays} dias em atraso` : 'nenhuma em atraso'}
                  </span>
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">
                  {formatMoney(client.outstanding, currency)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </ReportCard>
  )
}

function BucketChip({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean
  color?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        active
          ? 'border-primary/40 bg-primary/10 text-foreground'
          : 'border-border text-muted-foreground hover:text-foreground'
      )}
    >
      {color ? (
        <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: color }} />
      ) : null}
      {children}
    </button>
  )
}
