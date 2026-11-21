'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PageHeader } from '@/components/shared/page-header'
import { useBusiness } from '@/lib/hooks/use-business'
import { cn } from '@/lib/utils'
import {
  BILLING_MODES,
  DEFAULT_SCHEDULE_TEMPLATES,
  DUE_RULES,
  MAX_ENTRIES,
  ScheduleError,
  expandSchedule,
  type BillingMode,
  type DueRule,
  type ScheduleEntry,
  type ScheduleTemplate,
} from '@/lib/engagements/schedule'
import { BILLING_MODE_LABELS, DUE_RULE_LABELS } from '@/lib/engagements/types'
import { formatContractMoney, localizeBuiltInScheduleTemplate } from '@/lib/engagements/presentation'
import type { Client } from '@/types'

interface DraftEntry {
  label: string
  percent: string
  amount: string
  due_rule: DueRule
  due_on: string
}

function blankEntry(rule: DueRule = 'on_milestone'): DraftEntry {
  return { label: '', percent: '', amount: '', due_rule: rule, due_on: '' }
}

export default function NewEngagementPage() {
  const router = useRouter()
  const { currentBusiness } = useBusiness()
  const requestId = useRef<string | null>(null)

  const [clients, setClients] = useState<Client[]>([])
  const [templates, setTemplates] = useState<ScheduleTemplate[]>(DEFAULT_SCHEDULE_TEMPLATES)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  const [clientId, setClientId] = useState('')
  const [name, setName] = useState('')
  const [total, setTotal] = useState('')
  const [currency, setCurrency] = useState('')
  const [billingMode, setBillingMode] = useState<BillingMode>('percent_split')
  const [installments, setInstallments] = useState('3')
  const [entries, setEntries] = useState<DraftEntry[]>([
    { ...blankEntry('on_start'), label: 'Entrada', percent: '50' },
    { ...blankEntry('on_complete'), label: 'Na conclusão', percent: '50' },
  ])
  const [startsOn, setStartsOn] = useState('')
  const [targetEnd, setTargetEnd] = useState('')
  const [notes, setNotes] = useState('')
  const [startNow, setStartNow] = useState(false)

  useEffect(() => {
    async function load() {
      if (!currentBusiness) return
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const [{ data: clientRows }, { data: business }] = await Promise.all([
        supabase
          .from('clients')
          .select('*')
          .eq('business_id', currentBusiness.id)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('businesses')
          .select('schedule_templates')
          .eq('id', currentBusiness.id)
          .maybeSingle(),
      ])

      if (clientRows) setClients(clientRows as Client[])
      // Os modelos iniciais ficam na empresa. Uma linha
      // criada antes dessa coluna usa a mesma lista incluída no aplicativo.
      const seeded = business?.schedule_templates as ScheduleTemplate[] | null
      if (Array.isArray(seeded) && seeded.length > 0) setTemplates(seeded)
      setIsLoading(false)
    }
    load()
  }, [currentBusiness])

  const currencyCode =
    currency ||
    clients.find((client) => client.id === clientId)?.currency ||
    currentBusiness?.default_currency ||
    'USD'

  /**
   * A prévia executa a MESMA expansão que o banco de dados
   * (expand_engagement_schedule, espelhada por expandSchedule
   * aqui), então o que é exibido corresponde exatamente ao que será gravado.
   */
  const preview = useMemo((): { entries: ScheduleEntry[]; error: string | null } => {
    const amount = Number(total)
    if (!Number.isFinite(amount) || amount <= 0) return { entries: [], error: null }
    try {
      return {
        entries: expandSchedule({
          billing_mode: billingMode,
          total: amount,
          entries:
            billingMode === 'equal_installments' && entries.every((entry) => !entry.label.trim())
              ? null
              : entries.map((entry) => ({
                  label: entry.label,
                  percent: entry.percent === '' ? undefined : Number(entry.percent),
                  amount: entry.amount === '' ? undefined : Number(entry.amount),
                  due_rule: entry.due_rule,
                  due_on: entry.due_on || null,
                })),
          installments: Number(installments),
        }),
        error: null,
      }
    } catch (error) {
      return {
        entries: [],
        error: error instanceof ScheduleError ? error.message : 'Esse cronograma ainda não é válido.',
      }
    }
  }, [billingMode, entries, installments, total])

  function applyTemplate(template: ScheduleTemplate) {
    setBillingMode(template.billing_mode)
    if (template.installments) setInstallments(String(template.installments))
    setEntries(
      (template.entries ?? []).map((entry, index) => ({
        label: entry.label ?? '',
        percent: entry.percent === undefined || entry.percent === null ? '' : String(entry.percent),
        amount: entry.amount === undefined || entry.amount === null ? '' : String(entry.amount),
        due_rule:
          (entry.due_rule as DueRule | undefined) ??
          (index === 0 ? 'on_start' : 'on_milestone'),
        due_on: entry.due_on ?? '',
      })),
    )
  }

  function updateEntry(index: number, patch: Partial<DraftEntry>) {
    setEntries((current) =>
      current.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)),
    )
  }

  async function handleSubmit() {
    if (!currentBusiness) return
    if (!clientId) {
      toast.error('Selecione um cliente para este contrato.')
      return
    }
    if (preview.error || preview.entries.length === 0) {
      toast.error(preview.error ?? 'Informe o valor total do contrato e um cronograma.')
      return
    }

    setIsSaving(true)
    const { createEngagementAction } = await import('@/lib/actions/engagements')
    requestId.current ??= crypto.randomUUID()

    const result = await createEngagementAction(
      currentBusiness.id,
      {
        client_id: clientId,
        name,
        total: Number(total),
        currency: currencyCode,
        billing_mode: billingMode,
        // O cronograma é enviado como intenção. O banco de dados o expande novamente e
        // decide o resultado, para que um navegador desatualizado não grave um cronograma
        // com valores inconsistentes.
        entries: preview.entries.map((entry) => ({
          label: entry.label,
          percent: entry.percent ?? undefined,
          amount: billingMode === 'percent_split' || billingMode === 'equal_installments' ? undefined : entry.amount,
          due_rule: entry.due_rule,
          due_on: entry.due_on,
        })),
        installments: billingMode === 'equal_installments' ? Number(installments) : undefined,
        start_now: startNow,
        starts_on: startsOn || null,
        target_end: targetEnd || null,
        notes: notes || null,
      },
      requestId.current,
    )

    setIsSaving(false)
    if ('error' in result) {
      toast.error(result.error)
      return
    }
    router.push(`/engagements/${result.engagementId}`)
  }

  if (!currentBusiness || isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  const showPercent = billingMode === 'percent_split'
  const showAmount = billingMode === 'milestones' || billingMode === 'manual'
  const showEntries = billingMode !== 'equal_installments' || entries.length > 0
  const localizedTemplates = templates.map(localizeBuiltInScheduleTemplate)

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Novo contrato"
        description="Registre o que foi acordado e como será cobrado. Criar um contrato não envia nada ao cliente."
      />

      <div className="mt-6 grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>O contrato</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Cliente</Label>
                  <Select value={clientId} onValueChange={setClientId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione um cliente" />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="engagement-name">Nome</Label>
                  <Input
                    id="engagement-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Recriação do site"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="engagement-total">Total acordado</Label>
                  <Input
                    id="engagement-total"
                    type="number"
                    min="0"
                    step="0.01"
                    value={total}
                    onChange={(event) => setTotal(event.target.value)}
                    placeholder="12000"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="engagement-currency">Moeda</Label>
                  <Input
                    id="engagement-currency"
                    value={currency}
                    onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                    placeholder={currencyCode}
                    maxLength={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Forma de cobrança</Label>
                  <Select
                    value={billingMode}
                    onValueChange={(value) => setBillingMode(value as BillingMode)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BILLING_MODES.map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {BILLING_MODE_LABELS[mode]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="engagement-start">Início</Label>
                  <Input
                    id="engagement-start"
                    type="date"
                    value={startsOn}
                    onChange={(event) => setStartsOn(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="engagement-end">Previsão de término</Label>
                  <Input
                    id="engagement-end"
                    type="date"
                    value={targetEnd}
                    onChange={(event) => setTargetEnd(event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="engagement-notes">Observações internas</Label>
                <Textarea
                  id="engagement-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Nunca será exibida ao cliente"
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>O cronograma</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {billingMode === 'equal_installments' && (
                <div className="space-y-2 sm:max-w-[200px]">
                  <Label htmlFor="engagement-installments">Parcelas</Label>
                  <Input
                    id="engagement-installments"
                    type="number"
                    min="1"
                    max={MAX_ENTRIES}
                    value={installments}
                    onChange={(event) => setInstallments(event.target.value)}
                  />
                </div>
              )}

              {showEntries && (
                <div className="space-y-3">
                  {entries.map((entry, index) => (
                    <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_170px_150px_40px]">
                      <Input
                        value={entry.label}
                        onChange={(event) => updateEntry(index, { label: event.target.value })}
                        placeholder={`Parcela ${index + 1}`}
                      />
                      {showPercent ? (
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={entry.percent}
                          onChange={(event) => updateEntry(index, { percent: event.target.value })}
                          placeholder="%"
                        />
                      ) : showAmount ? (
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={entry.amount}
                          onChange={(event) => updateEntry(index, { amount: event.target.value })}
                          placeholder="Valor"
                        />
                      ) : (
                        <div className="flex items-center text-sm text-muted-foreground">Iguais</div>
                      )}
                      <Select
                        value={entry.due_rule}
                        onValueChange={(value) => updateEntry(index, { due_rule: value as DueRule })}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DUE_RULES.map((rule) => (
                            <SelectItem key={rule} value={rule}>
                              {DUE_RULE_LABELS[rule]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="date"
                        value={entry.due_on}
                        disabled={entry.due_rule !== 'on_date'}
                        onChange={(event) => updateEntry(index, { due_on: event.target.value })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setEntries((current) => current.filter((_, i) => i !== index))}
                        disabled={entries.length <= 1}
                        aria-label="Remover lançamento"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEntries((current) => [...current, blankEntry()])}
                  disabled={entries.length >= MAX_ENTRIES}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Adicionar lançamento
                </Button>
                {billingMode === 'equal_installments' && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setEntries([])}
                  >
                    Usar parcelas numeradas simples
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Modelos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {localizedTemplates.map((template) => (
                <Button
                  key={template.key}
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => applyTemplate(template)}
                >
                  {template.name}
                </Button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Prévia</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {preview.error ? (
                <p className="text-destructive">{preview.error}</p>
              ) : preview.entries.length === 0 ? (
                <p className="text-muted-foreground">
                  Informe um valor total para ver como será cobrado.
                </p>
              ) : (
                <>
                  {preview.entries.map((entry) => (
                    <div key={entry.position} className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-muted-foreground">{entry.label}</span>
                      <span className="font-medium">
                        {formatContractMoney(entry.amount, currencyCode)}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-baseline justify-between gap-3 border-t pt-2 font-medium">
                    <span>Total</span>
                    <span>
                      {formatContractMoney(
                        preview.entries.reduce((sum, entry) => sum + entry.amount, 0),
                        currencyCode,
                      )}
                    </span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={startNow}
                onChange={(event) => setStartNow(event.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Inicie agora para deixar qualquer entrada pronta para faturar
            </label>
            <Button
              type="button"
              className={cn('w-full')}
              onClick={handleSubmit}
              disabled={isSaving || !!preview.error}
            >
              {isSaving ? 'Salvando...' : 'Criar contrato'}
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => router.back()}>
              Cancelar
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
