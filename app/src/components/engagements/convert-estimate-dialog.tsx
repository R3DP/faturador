'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  DEFAULT_SCHEDULE_TEMPLATES,
  expandTemplate,
  type ScheduleEntry,
  type ScheduleTemplate,
} from '@/lib/engagements/schedule'
import { DUE_RULE_LABELS } from '@/lib/engagements/types'

/**
 * Transforma um orçamento aceito no contrato que ele descreve.
 *
 * A pessoa escolhe apenas o FORMATO do cronograma. O cliente, o total e
 * a moeda são obtidos do orçamento dentro da RPC e
 * não são enviados daqui, portanto a conversão não permite alterar um preço
 * sem que se perceba. A prévia abaixo usa a mesma expansão feita pelo servidor em
 * src/lib/engagements/schedule.ts, garantindo que o conteúdo exibido seja o mesmo que será gravado.
 */
interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  estimateId: string
  total: number
  currency: string
}

export function ConvertEstimateToEngagementDialog({
  open,
  onOpenChange,
  estimateId,
  total,
  currency,
}: Props) {
  const router = useRouter()
  const [templateKey, setTemplateKey] = useState(DEFAULT_SCHEDULE_TEMPLATES[0].key)
  const [isBusy, setIsBusy] = useState(false)
  // Um ID de requisição por diálogo, para que um clique duplo ou uma nova tentativa após uma
  // falha de conexão repita a operação em vez de criar outro contrato.
  const requestId = useRef<string | null>(null)

  const template =
    DEFAULT_SCHEDULE_TEMPLATES.find((item) => item.key === templateKey) ??
    DEFAULT_SCHEDULE_TEMPLATES[0]

  const preview = useMemo<{ entries: ScheduleEntry[]; error: string | null }>(() => {
    try {
      return { entries: expandTemplate(template, total), error: null }
    } catch (error) {
      return { entries: [], error: error instanceof Error ? error.message : 'Não é possível dividir esse total.' }
    }
  }, [template, total])

  const money = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(amount)

  async function convert() {
    setIsBusy(true)
    requestId.current ??= crypto.randomUUID()
    const { convertEstimateToEngagementAction } = await import('@/lib/actions/engagements')
    const result = await convertEstimateToEngagementAction(
      estimateId,
      payloadFor(template),
      requestId.current,
    )
    setIsBusy(false)

    if ('error' in result) {
      toast.error(result.error)
      return
    }
    toast.success('Orçamento convertido em contrato')
    router.push(`/engagements/${result.engagementId}`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Converter este orçamento em contrato</DialogTitle>
          <DialogDescription>
            O valor acordado de {money(total)} permanece exatamente como foi orçado. Escolha como será cobrado, e
            o Faturador acompanhará o saldo restante. Nada será faturado nem enviado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {DEFAULT_SCHEDULE_TEMPLATES.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTemplateKey(item.key)}
              className={cn(
                'w-full rounded-lg border p-3 text-left',
                item.key === templateKey ? 'border-primary bg-primary/5' : 'border-border/60',
              )}
            >
              <span className="font-medium">{item.name}</span>
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-border/60 p-3">
          {preview.error ? (
            <p className="text-sm text-destructive">{preview.error}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {preview.entries.map((entry) => (
                <li key={entry.position} className="flex justify-between gap-4">
                  <span className="min-w-0 truncate text-muted-foreground">
                    {entry.label}
                    <span className="ml-2 text-xs">{DUE_RULE_LABELS[entry.due_rule]}</span>
                  </span>
                  <span className="whitespace-nowrap font-medium">{money(entry.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          O contrato será criado como rascunho. Inicie-o quando o trabalho começar para liberar
          as parcelas para faturamento.
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
            Cancelar
          </Button>
          <Button onClick={convert} disabled={isBusy || !!preview.error}>
            Criar contrato
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** O modelo esperado pela ação: somente o formato, nunca um valor ou moeda. */
function payloadFor(template: ScheduleTemplate) {
  return {
    billing_mode: template.billing_mode,
    entries: template.entries?.map((entry) => ({
      label: entry.label ?? undefined,
      percent: entry.percent ?? undefined,
      due_rule: entry.due_rule ?? undefined,
    })),
    installments: template.installments,
  }
}
