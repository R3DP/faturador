'use client'

/**
 * A linha de indicadores apresenta quatro números principais, cada um com variação opcional
 * em relação ao período anterior.
 *
 * A direção é indicada por uma seta e por um número com sinal, além da cor, para que
 * quem não distingue verde de vermelho também perceba em que sentido o valor variou.
 * Os valores principais usam algarismos proporcionais, pois os algarismos tabulares podem
 * deixar números grandes visualmente espaçados; apenas a variação, exibida em texto pequeno,
 * usa algarismos tabulares para facilitar a comparação.
 */

import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatMoney } from '@/lib/reports/money'
import type { Delta } from '@/lib/reports/money'
import type { HeadlineStat } from '@/lib/reports/metrics'

export function ReportStats({
  stats,
  currency,
  comparisonLabel,
}: {
  stats: HeadlineStat[]
  currency: string
  comparisonLabel: string | null
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.id} className="gap-0 p-5">
          <p className="text-sm text-muted-foreground">{stat.label}</p>
          <p
            className={cn(
              'mt-1 text-2xl font-semibold tracking-tight',
              stat.value < 0 ? 'text-destructive' : 'text-foreground'
            )}
          >
            {formatMoney(stat.value, currency)}
          </p>
          <DeltaLine delta={stat.delta} upIsGood={stat.upIsGood} currency={currency} comparisonLabel={comparisonLabel} />
        </Card>
      ))}
    </div>
  )
}

function DeltaLine({
  delta,
  upIsGood,
  currency,
  comparisonLabel,
}: {
  delta: Delta | null
  upIsGood: boolean
  currency: string
  comparisonLabel: string | null
}) {
  if (!delta || !comparisonLabel) {
    return <p className="mt-2 text-xs text-muted-foreground">&nbsp;</p>
  }

  const good = delta.direction === 'flat' ? null : (delta.direction === 'up') === upIsGood
  const Icon =
    delta.direction === 'up' ? ArrowUpRight : delta.direction === 'down' ? ArrowDownRight : ArrowRight

  return (
    <p className="mt-2 flex items-center gap-1 text-xs">
      <Icon
        aria-hidden
        className={cn(
          'h-3.5 w-3.5',
          good === null ? 'text-muted-foreground' : good ? 'text-[color:var(--success)]' : 'text-destructive'
        )}
      />
      <span
        className={cn(
          'font-medium tabular-nums',
          good === null ? 'text-muted-foreground' : good ? 'text-[color:var(--success)]' : 'text-destructive'
        )}
      >
        {delta.percent === null
          ? `${delta.absolute >= 0 ? '+' : ''}${formatMoney(delta.absolute, currency)}`
          : `${delta.percent >= 0 ? '+' : ''}${delta.percent.toFixed(1)}%`}
      </span>
      <span className="text-muted-foreground">{comparisonLabel}</span>
    </p>
  )
}
