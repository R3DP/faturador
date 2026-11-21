'use client'

/**
 * Resultado do período selecionado.
 *
 * Este relatório propositalmente NÃO é um gráfico. Uma demonstração de resultado deve mostrar
 * os valores exatos, linha a linha; um gráfico de receita, despesas e lucro resultaria em três
 * barras repetindo os mesmos números. A evolução desses dados ao longo do tempo já aparece
 * acima, em Receitas ao longo do tempo.
 *
 * A escolha do regime contábil é importante. No regime de competência, a receita é contabilizada
 * quando é faturada; no regime de caixa, quando o dinheiro entra. Profissionais autônomos costumam
 * declarar pelo regime de caixa e planejar pelo regime de competência; por isso, a página oferece ambos.
 */

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ReportCard } from '@/components/reports/report-card'
import { csvFilename, toCsv, withReportContext } from '@/lib/reports/csv'
import { formatMoney, formatPercent } from '@/lib/reports/money'
import type { Delta } from '@/lib/reports/money'
import { buildPnl, type PnlBasis } from '@/lib/reports/metrics'
import type { ReportData } from '@/lib/reports/types'

export function PnlReport({
  data,
  basis,
  onBasisChange,
  compare,
}: {
  data: ReportData
  basis: PnlBasis
  onBasisChange: (basis: PnlBasis) => void
  compare: boolean
}) {
  const pnl = buildPnl(data, basis)
  const currency = data.currency

  const csv = {
    filename: csvFilename(`profit-and-loss-${basis}`, data.range),
    build: () => {
      const rows: { line: string; amount: number; previous: number | null }[] = [
        { line: basis === 'cash' ? 'Receita (recebida)' : 'Receita (faturada)', amount: pnl.revenue, previous: pnl.previousRevenue },
        ...pnl.lines.map((line) => ({ line: `Despesa: ${line.label}`, amount: -line.amount, previous: null })),
        { line: 'Total de despesas', amount: -pnl.expenses, previous: -pnl.previousExpenses },
        { line: 'Resultado líquido', amount: pnl.profit, previous: pnl.previousProfit },
      ]
      return withReportContext(
        toCsv(rows, [
          { header: 'Descrição', value: (row) => row.line },
          { header: `Valor (${currency})`, value: (row) => row.amount },
          ...(compare
            ? [{ header: `Período anterior (${currency})`, value: (row: (typeof rows)[number]) => row.previous ?? '' }]
            : []),
        ]),
        {
          title: `Resultado do período (regime de ${basis === 'cash' ? 'caixa' : 'competência'})`,
          range: data.range,
          currency,
        }
      )
    },
  }

  return (
    <ReportCard
      title="Resultado"
      description={
        basis === 'cash'
          ? 'Valores recebidos menos valores gastos neste período'
          : 'Receitas faturadas menos valores gastos neste período'
      }
      csv={csv}
      headerExtra={
        <div role="group" aria-label="Regime contábil" className="flex items-center rounded-md border border-border p-0.5">
          <BasisButton active={basis === 'accrual'} onClick={() => onBasisChange('accrual')}>
            Competência
          </BasisButton>
          <BasisButton active={basis === 'cash'} onClick={() => onBasisChange('cash')}>
            Caixa
          </BasisButton>
        </div>
      }
      footer={
        <span>
          {basis === 'cash'
            ? 'Regime de caixa: receita contabilizada na data do pagamento.'
            : 'Regime de competência: receita contabilizada na data de emissão da fatura.'}{' '}
          As despesas são contabilizadas na data em que ocorreram, nos dois regimes.
        </span>
      }
    >
      <dl className="divide-y divide-border">
        <StatementRow
          label={basis === 'cash' ? 'Receita recebida' : 'Receita faturada'}
          amount={pnl.revenue}
          currency={currency}
          delta={compare ? pnl.revenueDelta : null}
          emphasis
        />

        {pnl.lines.length > 0 ? (
          <div className="py-3">
            <p className="text-sm font-medium text-foreground">Despesas</p>
            <ul className="mt-2 space-y-1.5">
              {pnl.lines.map((line) => (
                <li key={line.category} className="flex items-baseline gap-3 text-sm">
                  <span className="text-muted-foreground">{line.label}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatPercent(line.share)}
                  </span>
                  <span className="ml-auto tabular-nums text-foreground">
                    {formatMoney(line.amount, currency)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <StatementRow
          label="Total de despesas"
          amount={pnl.expenses}
          currency={currency}
          delta={compare ? pnl.expensesDelta : null}
          deltaUpIsGood={false}
        />

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-4">
          <dt className="text-base font-semibold text-foreground">Resultado líquido</dt>
          {pnl.margin !== null ? (
            <dd className="text-xs text-muted-foreground tabular-nums">
              {formatPercent(pnl.margin, 1)} de margem
            </dd>
          ) : null}
          <dd
            className={cn(
              'ml-auto text-2xl font-semibold tracking-tight',
              pnl.profit < 0 ? 'text-destructive' : 'text-foreground'
            )}
          >
            {formatMoney(pnl.profit, currency)}
          </dd>
          {compare ? (
            <dd className="w-full text-right text-xs text-muted-foreground tabular-nums">
              Período anterior: {formatMoney(pnl.previousProfit, currency)}
            </dd>
          ) : null}
        </div>
      </dl>
    </ReportCard>
  )
}

function StatementRow({
  label,
  amount,
  currency,
  delta,
  emphasis,
  deltaUpIsGood = true,
}: {
  label: string
  amount: number
  currency: string
  delta: Delta | null
  emphasis?: boolean
  deltaUpIsGood?: boolean
}) {
  const good = delta === null || delta.direction === 'flat' ? null : (delta.direction === 'up') === deltaUpIsGood
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 py-3">
      <dt className={cn('text-sm', emphasis ? 'font-medium text-foreground' : 'text-foreground')}>{label}</dt>
      {delta ? (
        <dd
          className={cn(
            'text-xs tabular-nums',
            good === null ? 'text-muted-foreground' : good ? 'text-[color:var(--success)]' : 'text-destructive'
          )}
        >
          {delta.percent === null
            ? `${delta.absolute >= 0 ? '+' : ''}${formatMoney(delta.absolute, currency)}`
            : `${delta.percent >= 0 ? '+' : ''}${delta.percent.toFixed(1)}%`}{' '}
          em relação ao período anterior
        </dd>
      ) : null}
      <dd className="ml-auto text-sm font-medium tabular-nums text-foreground">
        {formatMoney(amount, currency)}
      </dd>
    </div>
  )
}

function BasisButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      aria-pressed={active}
      className={cn('h-7 px-2 text-xs', active ? 'bg-secondary text-foreground' : 'text-muted-foreground')}
    >
      {children}
    </Button>
  )
}
