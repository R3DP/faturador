'use client'

/**
 * Relatórios.
 *
 * Composição: linha de filtros, faixa de indicadores e seções do relatório.
 * Todos os números desta página vêm de uma única chamada RPC, limitada à empresa ativa
 * (consulte components/reports/use-report-data.ts), e cada cálculo fica em lib/reports
 * como uma função pura e testada.
 *
 * A ordem de leitura é intencional. A faixa de indicadores responde "como estão as coisas?"; em seguida, o envelhecimento
 * de contas a receber aparece PRIMEIRO entre as seções, pois cobrar pagamentos é o que a pessoa
 * autônoma vem fazer nesta página. Depois vêm a tendência, o resultado, a distribuição por cliente,
 * a distribuição de despesas e o resumo de horas.
 */

import { useMemo, useState } from 'react'
import { BarChart3, Receipt, Users } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useBusiness } from '@/lib/hooks/use-business'
import { cn } from '@/lib/utils'
import {
  chooseBucket,
  formatRangeLabel,
  isValidRange,
  previousRange as previousRangeFor,
  resolveRange,
  todayISO,
  type RangePresetId,
  type ReportRange,
} from '@/lib/reports/date-ranges'
import { buildAgingReport } from '@/lib/reports/aging'
import { buildExpenseBreakdown, buildHeadlineStats, buildTopClients, type PnlBasis } from '@/lib/reports/metrics'
import { SERIES_COLORS } from '@/lib/reports/palette'
import { isReportEmpty } from '@/lib/reports/types'
import { VizScope } from '@/components/reports/chart-theme'
import { ReportFilters } from '@/components/reports/report-filters'
import { ReportStats } from '@/components/reports/report-stats'
import { RevenueChart } from '@/components/reports/revenue-chart'
import { AgingReport } from '@/components/reports/aging-report'
import { PnlReport } from '@/components/reports/pnl-report'
import { RankedBarReport } from '@/components/reports/ranked-bar-report'
import { TimeReport } from '@/components/reports/time-report'
import { useReportData } from '@/components/reports/use-report-data'

const BUCKET_NOUNS: Record<string, string> = { day: 'Dia', week: 'Semana', month: 'Mês' }

export default function ReportsPage() {
  const { currentBusiness, isLoading: businessLoading } = useBusiness()

  // Fixada na montagem para que "hoje" não mude durante a sessão e desloque silenciosamente um
  // período entre renderizações.
  const [today] = useState(() => new Date())
  const [preset, setPreset] = useState<RangePresetId>('last_12_months')
  const [customRange, setCustomRange] = useState<ReportRange>(() => resolveRange('this_month', today))
  const [compare, setCompare] = useState(true)
  const [basis, setBasis] = useState<PnlBasis>('accrual')
  const [currency, setCurrency] = useState<string | null>(null)

  const range = useMemo(() => {
    const resolved = resolveRange(preset, today, customRange)
    return isValidRange(resolved) ? resolved : resolveRange('this_month', today)
  }, [preset, today, customRange])

  const comparisonRange = useMemo(
    () => (compare ? previousRangeFor(range, preset) : null),
    [compare, range, preset]
  )
  const bucket = useMemo(() => chooseBucket(range), [range])

  const { data, isLoading, isRefreshing, error, refresh } = useReportData({
    range,
    previousRange: comparisonRange,
    bucket,
    currency,
  })

  const asOf = todayISO(today)

  const aging = useMemo(
    () =>
      data
        ? buildAgingReport(data.openInvoices, asOf, data.currency, {
            truncated: data.openInvoiceCount > data.openInvoices.length,
          })
        : null,
    [data, asOf]
  )

  const stats = useMemo(
    () => (data && aging ? buildHeadlineStats(data, aging.totalOutstanding, basis, compare) : []),
    [data, aging, basis, compare]
  )

  const topClients = useMemo(() => (data ? buildTopClients(data) : null), [data])
  const expenseSlices = useMemo(() => (data ? buildExpenseBreakdown(data) : []), [data])

  if (businessLoading) {
    return <ReportsSkeleton />
  }

  if (!currentBusiness) {
    return (
      <div className="p-6 lg:p-8">
        <PageHeader title="Relatórios" description="Receitas, valores a receber, resultado e horas" />
        <Card className="mt-8">
          <EmptyState
            icon={BarChart3}
            title="Nenhuma empresa cadastrada"
            description="Cadastre uma empresa para começar a acompanhar relatórios de receitas, valores a receber e resultados."
            action={{ label: 'Ir para as configurações', href: '/settings' }}
          />
        </Card>
      </div>
    )
  }

  return (
    <VizScope className="p-6 lg:p-8">
      <PageHeader
        title="Relatórios"
        description={`Receitas, valores a receber, resultado e horas de ${currentBusiness.name}`}
      />

      <div className="mt-6">
        <ReportFilters
          preset={preset}
          onPresetChange={setPreset}
          range={range}
          customRange={customRange}
          onCustomRangeChange={setCustomRange}
          previousRange={comparisonRange}
          compare={compare}
          onCompareChange={setCompare}
          currency={data?.currency ?? currentBusiness.default_currency ?? 'USD'}
          currencies={data?.currencies ?? []}
          onCurrencyChange={setCurrency}
          onRefresh={refresh}
          isRefreshing={isRefreshing}
        />
      </div>

      {error ? (
        <Card className="mt-6">
          <EmptyState
            icon={BarChart3}
            title="Não foi possível carregar os relatórios"
            description={error}
          />
          <div className="flex justify-center pb-6">
            <Button onClick={refresh}>Tentar novamente</Button>
          </div>
        </Card>
      ) : isLoading || !data || !aging || !topClients ? (
        <ReportsSkeleton withHeader={false} />
      ) : isReportEmpty(data) && aging.invoiceCount === 0 ? (
        <Card className="mt-6">
          <EmptyState
            icon={BarChart3}
            title="Ainda não há dados para mostrar"
            description={`Não há faturas, pagamentos, despesas ou horas em ${formatRangeLabel(range)}. Envie sua primeira fatura para ver os dados aqui.`}
            action={{ label: 'Criar uma fatura', href: '/invoices/new' }}
            className="py-16"
          />
        </Card>
      ) : (
        // Durante uma nova busca, a renderização anterior fica com opacidade reduzida, em vez de
        // exibir um esqueleto; assim, nada salta na tela quando o período muda.
        <div className={cn('mt-6 space-y-6 transition-opacity', isRefreshing && 'opacity-60')}>
          <ReportStats
            stats={stats}
            currency={data.currency}
            comparisonLabel={compare ? 'em relação ao período anterior' : null}
          />

          <AgingReport data={data} report={aging} asOf={asOf} />

          <RevenueChart data={data} compare={compare} bucketNoun={BUCKET_NOUNS[data.bucket] ?? 'Período'} />

          <div className="grid gap-6 lg:grid-cols-2">
            <PnlReport data={data} basis={basis} onBasisChange={setBasis} compare={compare} />
            <TimeReport data={data} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <RankedBarReport
              title="Principais clientes"
              description="Receita faturada neste período e a participação de cada cliente"
              slug="top-clients"
              rows={topClients.rows.map((row) => ({
                key: row.clientId || row.clientName,
                label: row.clientName,
                amount: row.invoiced,
                share: row.share,
                secondary: `${row.invoiceCount} ${row.invoiceCount === 1 ? 'fatura' : 'faturas'}`,
                href: row.clientId ? `/clients/${row.clientId}` : undefined,
              }))}
              currency={data.currency}
              range={data.range}
              color={SERIES_COLORS.invoiced}
              amountLabel="Receita faturada"
              shareLabel="Participação na receita"
              categoryLabel="Cliente"
              emptyIcon={Users}
              emptyTitle="Ainda não há receita de clientes"
              emptyDescription="Fature um cliente neste período para que ele apareça aqui, ordenado pela receita."
              footer={
                topClients.rows.length > 0 ? (
                  <span>
                    {topClients.rows[0].clientName} representa {topClients.topShare.toFixed(0)}% da receita
                    neste período; os três maiores clientes juntos representam {topClients.topThreeShare.toFixed(0)}%.
                  </span>
                ) : undefined
              }
            />

            <RankedBarReport
              title="Despesas por categoria"
              description="Para onde foi o dinheiro neste período"
              slug="expenses-by-category"
              rows={expenseSlices.map((slice) => ({
                key: slice.category,
                label: slice.label,
                amount: slice.amount,
                share: slice.share,
                secondary: `${slice.count} ${slice.count === 1 ? 'despesa' : 'despesas'}`,
              }))}
              currency={data.currency}
              range={data.range}
              color={SERIES_COLORS.expenses}
              amountLabel="Valor gasto"
              shareLabel="Participação nas despesas"
              categoryLabel="Categoria"
              emptyIcon={Receipt}
              emptyTitle="Nenhuma despesa registrada"
              emptyDescription="Registre uma despesa para ver seus gastos separados por categoria."
            />
          </div>
        </div>
      )}
    </VizScope>
  )
}

function ReportsSkeleton({ withHeader = true }: { withHeader?: boolean }) {
  return (
    <div className={withHeader ? 'p-6 lg:p-8' : 'mt-6'}>
      {withHeader ? (
        <>
          <Skeleton className="h-8 w-40" />
          <Skeleton className="mt-2 h-4 w-72" />
        </>
      ) : null}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="mt-6 h-80 w-full rounded-xl" />
      <Skeleton className="mt-6 h-72 w-full rounded-xl" />
    </div>
  )
}
