'use client'

/**
 * Elementos visuais compartilhados dos gráficos. Todos os gráficos da página de relatórios
 * usam daqui as cores, a grade, os eixos, a dica de contexto e a legenda, para que a página
 * pareça um sistema coeso, e não um conjunto de gráficos com estilos independentes.
 *
 * As cores são fornecidas como propriedades personalizadas de CSS (consulte lib/reports/palette.ts
 * para saber como foram escolhidas e validadas). O Recharts aceita
 * `fill="var(--viz-series-1)"`, assim, os temas claro e escuro são definidos em um só lugar, sem que cada componente
 * precise verificar qual tema está ativo.
 */

import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TooltipContentProps } from 'recharts'
import { cn } from '@/lib/utils'
import { paletteToCss, VIZ_DARK, VIZ_LIGHT } from '@/lib/reports/palette'

const VIZ_CSS = `
.billr-viz { ${paletteToCss(VIZ_LIGHT)} }
.dark .billr-viz { ${paletteToCss(VIZ_DARK)} }
.billr-viz .recharts-surface { overflow: visible; }
.billr-viz .recharts-cartesian-axis-line { stroke: var(--viz-grid); }
.billr-viz .recharts-cartesian-axis-tick-line { stroke: transparent; }
`

/**
 * Define as propriedades personalizadas do gráfico para todos os elementos internos.
 * É montado uma vez, no início da página de relatórios.
 */
export function VizScope({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('billr-viz', className)}>
      <style dangerouslySetInnerHTML={{ __html: VIZ_CSS }} />
      {children}
    </div>
  )
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeToMotionPreference(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/**
 * Respeita a configuração de redução de movimento do sistema operacional; com ela
 * ativada, os gráficos são exibidos sem animação. A leitura usa useSyncExternalStore
 * para que a primeira renderização no cliente já considere a configuração correta,
 * em vez de animar e só depois corrigir o resultado.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToMotionPreference,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false
  )
}

const AXIS_TICK = { fontSize: 12, fill: 'var(--viz-axis)' } as const

/** Linha fina e contínua, um tom diferente da superfície. Nunca tracejada. */
export function VizGrid({ horizontal = true, vertical = false }: { horizontal?: boolean; vertical?: boolean }) {
  return (
    <CartesianGrid
      stroke="var(--viz-grid)"
      strokeWidth={1}
      horizontal={horizontal}
      vertical={vertical}
    />
  )
}

export function VizXAxis(props: { dataKey: string; interval?: number | 'preserveStartEnd'; angled?: boolean }) {
  return (
    <XAxis
      dataKey={props.dataKey}
      tick={AXIS_TICK}
      tickLine={false}
      axisLine={{ stroke: 'var(--viz-grid)' }}
      interval={props.interval ?? 'preserveStartEnd'}
      minTickGap={12}
      height={props.angled ? 48 : 28}
      angle={props.angled ? -35 : 0}
      textAnchor={props.angled ? 'end' : 'middle'}
    />
  )
}

export function VizYAxis({
  tickFormatter,
  width = 68,
  hide = false,
}: {
  tickFormatter?: (value: number) => string
  width?: number
  hide?: boolean
}) {
  return (
    <YAxis
      tick={AXIS_TICK}
      tickLine={false}
      axisLine={false}
      width={width}
      hide={hide}
      tickFormatter={tickFormatter ? (value: number) => tickFormatter(value) : undefined}
    />
  )
}

export interface VizTooltipRow {
  key: string
  name: string
  value: string
  color: string
  /** Linhas são identificadas por um traço; barras e áreas, por um pequeno retângulo arredondado. */
  mark?: 'line' | 'rect'
}

/**
 * Uma única dica de contexto para toda a página. O valor aparece primeiro, seguido pelo nome
 * da série; assim, a pessoa não precisa apontar para um elemento específico para consultar
 * todas as séries naquele ponto do gráfico.
 */
export function VizTooltipCard({ title, rows, note }: { title: string; rows: VizTooltipRow[]; note?: string }) {
  return (
    <div className="pointer-events-none min-w-40 rounded-lg border border-border bg-popover px-3 py-2 shadow-lg">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="mt-1.5 space-y-1">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2">
            <span
              aria-hidden
              className={row.mark === 'line' ? 'h-0.5 w-3 rounded-full' : 'h-2.5 w-2.5 rounded-[3px]'}
              style={{ backgroundColor: row.color }}
            />
            <span className="text-sm font-semibold tabular-nums text-foreground">{row.value}</span>
            <span className="ml-auto text-xs text-muted-foreground">{row.name}</span>
          </li>
        ))}
      </ul>
      {note ? <p className="mt-1.5 text-[11px] text-muted-foreground">{note}</p> : null}
    </div>
  )
}

type TooltipRenderer = (props: TooltipContentProps) => ReactNode

/** Conecta um cartão personalizado ao Recharts e aplica o estilo compartilhado do cursor. */
export function VizTooltip({ render, cursor = 'bar' }: { render: TooltipRenderer; cursor?: 'bar' | 'line' | 'none' }) {
  return (
    <Tooltip
      content={render}
      cursor={
        cursor === 'none'
          ? false
          : cursor === 'bar'
            ? { fill: 'var(--viz-axis)', fillOpacity: 0.08 }
            : { stroke: 'var(--viz-axis)', strokeWidth: 1 }
      }
      wrapperStyle={{ outline: 'none' }}
    />
  )
}

export interface VizLegendItem {
  key: string
  label: string
  color: string
  mark?: 'line' | 'rect'
}

/**
 * As legendas ficam fora da área do gráfico para não disputar espaço com os dados.
 * Quando há duas ou mais séries, a legenda é sempre exibida: a identificação nunca depende
 * apenas da cor.
 */
export function VizLegend({ items, className }: { items: VizLegendItem[]; className?: string }) {
  if (items.length < 2) return null
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            aria-hidden
            className={item.mark === 'line' ? 'h-0.5 w-3.5 rounded-full' : 'h-2.5 w-2.5 rounded-[3px]'}
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

/**
 * Dimensiona a área do gráfico para incluir a faixa dos eixos, evitando que o cartão ganhe
 * uma barra de rolagem interna para alcançar os rótulos do eixo X.
 */
export function VizFrame({
  height = 260,
  label,
  children,
  className,
}: {
  height?: number
  /** Descrição acessível do conteúdo do gráfico para leitores de tela. */
  label: string
  children: React.ReactElement
  className?: string
}) {
  return (
    <div className={cn('w-full', className)} style={{ height }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  )
}

/** Raio das barras: extremidade dos dados arredondada e base reta. */
export const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0]
export const MAX_BAR_SIZE = 24

/**
 * O formatador de LabelList aceita qualquer valor renderizável; nos relatórios, os rótulos
 * são sempre valores monetários numéricos. Esta função restringe o tipo em um só lugar,
 * em vez de repetir a verificação em cada chamada.
 */
export function moneyLabelFormatter(format: (value: number) => string) {
  return (value: unknown) => (typeof value === 'number' && value !== 0 ? format(value) : '')
}
