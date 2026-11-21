'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Handshake } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { todayISO } from '@/lib/dates'
import type { LineItemFormData } from '@/lib/validations/invoice'

/**
 * "De contratos": itens do cronograma acordados com este cliente e que estão
 * prontos para faturar, oferecidos como caixas de seleção na página de nova fatura.
 *
 * Ao marcar um item, uma linha de PRÉ-VISUALIZAÇÃO é adicionada ao formulário para que a pessoa veja a
 * descrição e o total que pretende enviar. Essa prévia não é o que
 * será cobrado: ao enviar, a página remove essas linhas e passa os
 * IDs dos itens para create_invoice; então o banco recria as linhas
 * com os valores acordados de cada item, na mesma transação que o marca
 * como faturado. Um valor digitado no navegador
 * não altera o valor cobrado do cliente, e um item não pode acabar
 * em duas faturas.
 */

/** Marca um item como representação de um item de contrato, e não como algo digitado manualmente. */
const ENGAGEMENT_LINE_PREFIX = 'engagement:'

function engagementLineId(entryId: string): string {
  return `${ENGAGEMENT_LINE_PREFIX}${entryId}`
}

/** IDs dos itens associados às linhas de pré-visualização que estão no formulário. */
export function engagementEntryIdsOf(lineItems: LineItemFormData[]): string[] {
  return lineItems
    .filter((item) => item.id.startsWith(ENGAGEMENT_LINE_PREFIX))
    .map((item) => item.id.slice(ENGAGEMENT_LINE_PREFIX.length))
}

/** Linhas digitadas pela pessoa; somente elas são enviadas como itens. */
export function typedLineItemsOf(lineItems: LineItemFormData[]): LineItemFormData[] {
  return lineItems.filter((item) => !item.id.startsWith(ENGAGEMENT_LINE_PREFIX))
}

export interface ReadyEntry {
  id: string
  label: string
  amount: number
  due_rule: string
  due_on: string | null
  engagement_id: string
  engagement_name: string
  engagement_currency: string
}

interface Props {
  businessId: string
  /** Cliente da fatura. Sem cliente selecionado, não há itens para oferecer. */
  clientId: string
  /** Moeda da fatura. Um contrato em outra moeda não pode ser cobrado aqui. */
  currency: string
  lineItems: LineItemFormData[]
  setLineItems: (items: LineItemFormData[]) => void
  /** IDs dos itens a marcar no primeiro carregamento, vindos da consulta ?engagement_entries=. */
  preselected?: string[]
}

export function EngagementEntryPicker({
  businessId,
  clientId,
  currency,
  lineItems,
  setLineItems,
  preselected = [],
}: Props) {
  const [entries, setEntries] = useState<ReadyEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [applied, setApplied] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!businessId || !clientId) {
        setEntries([])
        setIsLoading(false)
        return
      }

      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      // Usa a mesma verificação de leitura das páginas de contratos: um item cuja data já
      // passou se torna faturável quando alguém acessa a página, sem depender de uma tarefa agendada.
      await supabase.rpc('promote_due_entries', { p_business_id: businessId })

      const { data } = await supabase
        .from('engagement_entries')
        .select(
          'id, label, amount, due_rule, due_on, engagement_id, engagement:engagements(name, currency, client_id, status)',
        )
        .eq('business_id', businessId)
        .eq('status', 'ready_to_bill')
        .order('due_on', { ascending: true })

      if (cancelled) return

      type Row = Omit<ReadyEntry, 'engagement_name' | 'engagement_currency'> & {
        engagement: { name: string; currency: string; client_id: string; status: string } | null
      }

      setEntries(
        ((data ?? []) as unknown as Row[])
          // Um contrato em rascunho ou cancelado não pode ser faturado, e o banco de dados
          // o rejeitaria de qualquer forma; não oferecê-lo é apenas ser transparente desde o início.
          .filter(
            (row) =>
              row.engagement &&
              row.engagement.client_id === clientId &&
              row.engagement.status !== 'draft' &&
              row.engagement.status !== 'cancelled',
          )
          .map((row) => ({
            id: row.id,
            label: row.label,
            amount: row.amount,
            due_rule: row.due_rule,
            due_on: row.due_on,
            engagement_id: row.engagement_id,
            engagement_name: row.engagement?.name ?? '',
            engagement_currency: row.engagement?.currency ?? currency,
          })),
      )
      setIsLoading(false)
    }

    setIsLoading(true)
    load()
    return () => {
      cancelled = true
    }
    // a moeda é consultada internamente e não deve causar nova busca; ela afeta somente a exibição.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, clientId])

  const selected = useMemo(() => new Set(engagementEntryIdsOf(lineItems)), [lineItems])

  const toggle = useCallback(
    (entry: ReadyEntry, next: boolean) => {
      const withoutEntry = lineItems.filter((item) => item.id !== engagementLineId(entry.id))
      if (!next) {
        setLineItems(withoutEntry.length > 0 ? withoutEntry : lineItems)
        return
      }

      const line: LineItemFormData = {
        id: engagementLineId(entry.id),
        // Usa exatamente a mesma formulação da RPC de faturamento, para que a prévia
        // e a fatura gravada sejam iguais.
        description: `${entry.engagement_name}: ${entry.label}`,
        quantity: 1,
        rate: entry.amount,
        amount: entry.amount,
        tax_rate: 0,
        tax_amount: 0,
        discount_percent: 0,
        discount_amount: 0,
      }

      // Remove a linha em branco inicial do formulário, para que faturar somente
      // um contrato não deixe uma linha vazia que falhe na validação.
      const kept = withoutEntry.filter(
        (item) => item.description.trim().length > 0 || item.rate > 0,
      )
      setLineItems([...kept, line])
    },
    [lineItems, setLineItems],
  )

  // Qualquer item recebido pela string de consulta é marcado uma vez, depois que os
  // itens são carregados. Executar isso novamente impediria a pessoa de desmarcar uma opção.
  useEffect(() => {
    if (applied || isLoading || entries.length === 0 || preselected.length === 0) return
    setApplied(true)
    const wanted = new Set(preselected)
    let next = lineItems
    for (const entry of entries) {
      if (!wanted.has(entry.id) || next.some((item) => item.id === engagementLineId(entry.id))) {
        continue
      }
      if (entry.engagement_currency !== currency) continue
      next = [
        ...next.filter((item) => item.description.trim().length > 0 || item.rate > 0),
        {
          id: engagementLineId(entry.id),
          description: `${entry.engagement_name}: ${entry.label}`,
          quantity: 1,
          rate: entry.amount,
          amount: entry.amount,
          tax_rate: 0,
          tax_amount: 0,
          discount_percent: 0,
          discount_amount: 0,
        },
      ]
    }
    if (next !== lineItems) setLineItems(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, isLoading, entries, preselected, currency])

  if (!clientId || (!isLoading && entries.length === 0)) return null

  const money = (amount: number, code: string) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: code || 'USD' }).format(amount)

  const today = todayISO()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Handshake className="h-4 w-4" />
          De contratos
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Trabalho acordado com este cliente e pronto para faturar. Marcar um item o adiciona como linha e
          marca essa parte do cronograma como faturada ao salvar, evitando uma cobrança duplicada.
        </p>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => {
              const wrongCurrency = entry.engagement_currency !== currency
              const overdue =
                entry.due_rule === 'on_date' && !!entry.due_on && entry.due_on <= today
              return (
                <label
                  key={entry.id}
                  className="flex items-start gap-3 rounded-lg border border-border/60 p-3"
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={selected.has(entry.id)}
                    disabled={wrongCurrency}
                    onCheckedChange={(value) => toggle(entry, value === true)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{entry.label}</span>
                      <Link
                        href={`/engagements/${entry.engagement_id}`}
                        className="text-sm text-muted-foreground hover:text-primary"
                      >
                        {entry.engagement_name}
                      </Link>
                      {overdue && (
                        <Badge className="bg-amber-100 text-amber-700">
                          Vence em {entry.due_on}
                        </Badge>
                      )}
                    </span>
                    {wrongCurrency && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        Valor acordado em {entry.engagement_currency}. Defina a fatura nessa moeda para
                        cobrá-lo; o Faturador nunca converte valores automaticamente.
                      </span>
                    )}
                  </span>
                  <span className="whitespace-nowrap font-medium">
                    {money(entry.amount, entry.engagement_currency)}
                  </span>
                </label>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
