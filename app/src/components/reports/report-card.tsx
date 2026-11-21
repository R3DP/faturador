'use client'

/**
 * Estrutura comum de cada seção de relatório: título, explicação breve, opção de exportar
 * em CSV e, quando a seção mostra um gráfico, uma tabela com os mesmos valores.
 *
 * A tabela não é um mero detalhe. Ela permite consultar os valores sem
 * passar o cursor, oferece os dados a leitores de tela e ajuda pessoas com daltonismo ou
 * modo de alto contraste a identificar elementos que não conseguem distinguir pela cor.
 */

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { BarChart3, Download, TableIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export interface CsvExport {
  filename: string
  build: () => string
}

/** Inicia o download no navegador. Fica fora de lib/reports para manter esse módulo puro. */
function downloadCsv(exportSpec: CsvExport) {
  const blob = new Blob([exportSpec.build()], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = exportSpec.filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function ReportCard({
  title,
  description,
  csv,
  headerExtra,
  table,
  children,
  className,
  footer,
}: {
  title: string
  description?: string
  csv?: CsvExport
  /** Controles exclusivos desta seção, como a seleção do regime contábil. */
  headerExtra?: ReactNode
  /** Os mesmos dados em formato de tabela. Quando fornecida, exibe-se um controle para alternar entre gráfico e tabela. */
  table?: ReactNode
  children: ReactNode
  className?: string
  footer?: ReactNode
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const panelId = useId()

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="gap-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerExtra}
            {table ? (
              <div
                role="group"
                aria-label={`${title}: opções de visualização`}
                className="flex items-center rounded-md border border-border p-0.5"
              >
                <ViewToggle
                  active={view === 'chart'}
                  onClick={() => setView('chart')}
                  label="Gráfico"
                  controls={panelId}
                  icon={<BarChart3 className="h-3.5 w-3.5" aria-hidden />}
                />
                <ViewToggle
                  active={view === 'table'}
                  onClick={() => setView('table')}
                  label="Tabela"
                  controls={panelId}
                  icon={<TableIcon className="h-3.5 w-3.5" aria-hidden />}
                />
              </div>
            ) : null}
            {csv ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadCsv(csv)}
                aria-label={`Baixar ${title} em CSV`}
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                CSV
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent id={panelId}>{table && view === 'table' ? table : children}</CardContent>
      {footer ? (
        <div className="border-t border-border bg-muted/40 px-6 py-3 text-xs text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </Card>
  )
}

function ViewToggle({
  active,
  onClick,
  label,
  icon,
  controls,
}: {
  active: boolean
  onClick: () => void
  label: string
  icon: ReactNode
  controls: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-controls={controls}
      className={cn(
        'flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {icon}
      {label}
    </button>
  )
}

/** Tabela compacta e padronizada para as visualizações em tabela. */
export function ReportTable({
  columns,
  children,
  caption,
}: {
  columns: { key: string; label: string; align?: 'left' | 'right' }[]
  children: ReactNode
  caption?: string
}) {
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[420px] border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-border">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'px-2 py-2 text-xs font-medium text-muted-foreground',
                  column.align === 'right' ? 'text-right' : 'text-left'
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}
