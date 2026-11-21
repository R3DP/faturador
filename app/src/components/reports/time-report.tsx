'use client'

/**
 * Resumo das horas no período: horas registradas, quantas são faturáveis e quantas
 * ainda não foram faturadas.
 *
 * São quatro números e uma proporção; por isso, usamos um bloco de indicadores com uma
 * barra de progresso, em vez de um gráfico. Um gráfico de pizza com duas fatias ou de barras
 * com duas colunas apenas repetiria os números exibidos ao lado. A faixa da barra usa um tom
 * mais claro do mesmo azul, para que a proporção seja percebida ao longo de toda a barra.
 *
 * Os registros de horas não têm uma coluna própria de moeda; por isso, os valores são
 * apresentados na moeda padrão da empresa e identificados dessa forma.
 */

import Link from 'next/link'
import { Timer } from 'lucide-react'
import { EmptyState } from '@/components/shared/empty-state'
import { ReportCard } from '@/components/reports/report-card'
import { csvFilename, toCsv, withReportContext } from '@/lib/reports/csv'
import { formatHours, formatMoney, formatPercent } from '@/lib/reports/money'
import { buildTimeReport } from '@/lib/reports/metrics'
import type { ReportData } from '@/lib/reports/types'

export function TimeReport({ data }: { data: ReportData }) {
  const time = buildTimeReport(data)
  const currency = data.currency

  const csv = {
    filename: csvFilename('time-summary', data.range),
    build: () => {
      const rows = [
        { metric: 'Horas registradas', value: time.totalHours },
        { metric: 'Horas faturáveis', value: time.billableHours },
        { metric: 'Horas não faturáveis', value: time.nonBillableHours },
        { metric: 'Horas não faturadas', value: time.unbilledHours },
        { metric: `Valor não faturado (${currency})`, value: time.unbilledValue },
        { metric: `Valor faturável (${currency})`, value: time.billableValue },
        { metric: 'Proporção de horas faturáveis (%)', value: Number(time.billableRate.toFixed(1)) },
        {
          metric: `Valor efetivo por hora (${currency})`,
          value: time.effectiveHourlyRate ?? '',
        },
      ]
      return withReportContext(
        toCsv(rows, [
          { header: 'Indicador', value: (row) => row.metric },
          { header: 'Valor', value: (row) => row.value },
        ]),
        { title: 'Resumo de horas', range: data.range, currency }
      )
    },
  }

  if (time.entryCount === 0) {
    return (
      <ReportCard title="Resumo de horas" description="Horas registradas neste período, faturáveis e não faturáveis">
        <EmptyState
          icon={Timer}
          title="Nenhuma hora registrada"
          description="Registre horas para um cliente para ver o que é faturável e o que ainda aguarda faturamento."
          action={{ label: 'Registrar horas', href: '/time' }}
          className="py-10"
        />
      </ReportCard>
    )
  }

  return (
    <ReportCard
      title="Resumo de horas"
      description="Horas registradas neste período, faturáveis e não faturáveis"
      csv={csv}
      footer={<span>Os valores das horas são exibidos em {currency}, conforme a moeda das tarifas horárias.</span>}
    >
      <div className="space-y-5">
        <div>
          <div className="flex items-baseline justify-between">
            <p className="text-sm text-muted-foreground">Horas registradas</p>
            <p className="text-sm tabular-nums text-muted-foreground">
              {formatPercent(time.billableRate)} das horas registradas são faturáveis
            </p>
          </div>
          <p className="mt-0.5 text-2xl font-semibold tracking-tight text-foreground">
            {formatHours(time.totalHours)}
          </p>
          <div
            className="mt-3 h-2.5 w-full overflow-hidden rounded-full"
            style={{ backgroundColor: 'var(--viz-age-1)' }}
            role="img"
            aria-label={`${formatHours(time.billableHours)} horas faturáveis de ${formatHours(time.totalHours)} horas registradas`}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(time.billableRate, 100)}%`,
                backgroundColor: 'var(--viz-series-1)',
              }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2 w-2 rounded-[2px]"
                style={{ backgroundColor: 'var(--viz-series-1)' }}
              />
              Faturáveis: {formatHours(time.billableHours)}
            </span>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2 w-2 rounded-[2px]"
                style={{ backgroundColor: 'var(--viz-age-1)' }}
              />
              Não faturáveis: {formatHours(time.nonBillableHours)}
            </span>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-4 border-t border-border pt-4">
          <div>
            <dt className="text-xs text-muted-foreground">Horas não faturadas</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
              {formatHours(time.unbilledHours)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Valor não faturado</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
              {formatMoney(time.unbilledValue, currency)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Valor faturável</dt>
            <dd className="mt-0.5 text-sm tabular-nums text-foreground">
              {formatMoney(time.billableValue, currency)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Valor efetivo por hora</dt>
            <dd className="mt-0.5 text-sm tabular-nums text-foreground">
              {time.effectiveHourlyRate === null
                ? 'Sem horas faturáveis'
                : `${formatMoney(time.effectiveHourlyRate, currency)}/h`}
            </dd>
          </div>
        </dl>

        {time.unbilledHours > 0 ? (
          <p className="text-sm text-muted-foreground">
            {formatHours(time.unbilledHours)} do tempo faturável ainda não foi faturado.{' '}
            <Link href="/time" className="font-medium text-primary hover:underline">
              Revisar horas não faturadas
            </Link>
          </p>
        ) : null}
      </div>
    </ReportCard>
  )
}
