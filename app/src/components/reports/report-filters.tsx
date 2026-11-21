'use client'

/**
 * A única linha de filtros aparece acima de todos os relatórios e aplica os mesmos critérios a todos, para que
 * os números da página sempre descrevam o mesmo recorte. Nenhum gráfico tem seu próprio
 * controle de período.
 */

import { CalendarRange, Check, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  formatRangeLabel,
  isValidRange,
  RANGE_PRESETS,
  type RangePresetId,
  type ReportRange,
} from '@/lib/reports/date-ranges'
import type { CurrencyCount } from '@/lib/reports/types'

export interface ReportFiltersProps {
  preset: RangePresetId
  onPresetChange: (preset: RangePresetId) => void
  range: ReportRange
  customRange: ReportRange
  onCustomRangeChange: (range: ReportRange) => void
  previousRange: ReportRange | null
  compare: boolean
  onCompareChange: (compare: boolean) => void
  currency: string
  currencies: CurrencyCount[]
  onCurrencyChange: (currency: string) => void
  onRefresh: () => void
  isRefreshing: boolean
}

export function ReportFilters(props: ReportFiltersProps) {
  const multiCurrency = props.currencies.length > 1

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={props.preset}
        onValueChange={(value) => props.onPresetChange(value as RangePresetId)}
      >
        <SelectTrigger className="w-[180px]" aria-label="Período">
          <CalendarRange className="h-4 w-4 text-muted-foreground" aria-hidden />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RANGE_PRESETS.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {props.preset === 'custom' ? (
        <CustomRangePicker value={props.customRange} onChange={props.onCustomRangeChange} />
      ) : null}

      <button
        type="button"
        role="switch"
        aria-checked={props.compare}
        onClick={() => props.onCompareChange(!props.compare)}
        className={cn(
          'flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          props.compare
            ? 'border-primary/40 bg-primary/10 text-foreground'
            : 'border-border text-muted-foreground hover:text-foreground'
        )}
      >
        <span
          aria-hidden
          className={cn(
            'flex h-4 w-4 items-center justify-center rounded-[4px] border',
            props.compare ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
          )}
        >
          {props.compare ? <Check className="h-3 w-3" /> : null}
        </span>
        Comparar com o período anterior
      </button>

      {multiCurrency ? (
        <Select value={props.currency} onValueChange={props.onCurrencyChange}>
          <SelectTrigger className="w-[110px]" aria-label="Moeda">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {props.currencies.map((currency) => (
              <SelectItem key={currency.code} value={currency.code}>
                {currency.code}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      <div className="ml-auto flex items-center gap-3">
        <p className="text-sm text-muted-foreground">
          {formatRangeLabel(props.range)}
          {props.compare && props.previousRange
            ? ` em comparação com ${formatRangeLabel(props.previousRange)}`
            : ''}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={props.onRefresh}
          disabled={props.isRefreshing}
          aria-label="Atualizar relatórios"
        >
          <RefreshCw className={cn('h-4 w-4', props.isRefreshing && 'animate-spin')} aria-hidden />
        </Button>
      </div>
    </div>
  )
}

function CustomRangePicker({
  value,
  onChange,
}: {
  value: ReportRange
  onChange: (range: ReportRange) => void
}) {
  const valid = isValidRange(value)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9">
          {valid ? formatRangeLabel(value) : 'Selecionar datas'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="report-range-start">Data inicial</Label>
          <Input
            id="report-range-start"
            type="date"
            value={value.start}
            max={value.end}
            onChange={(event) => onChange({ ...value, start: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="report-range-end">Data final</Label>
          <Input
            id="report-range-end"
            type="date"
            value={value.end}
            min={value.start}
            onChange={(event) => onChange({ ...value, end: event.target.value })}
          />
        </div>
        {!valid ? (
          <p className="text-xs text-destructive">
            Escolha uma data inicial anterior ou igual à data final.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
