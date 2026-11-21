'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Check, Ban, Pause, Play, CircleSlash, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PageHeader } from '@/components/shared/page-header'
import { useBusiness } from '@/lib/hooks/use-business'
import type { EngagementStatus } from '@/lib/engagements/schedule'
import {
  DUE_RULE_LABELS,
  ENGAGEMENT_STATUS_COLORS,
  ENTRY_STATUS_COLORS,
  ENTRY_STATUS_LABELS,
  BILLING_MODE_LABELS,
  type EngagementEntryRow,
  type EngagementRow,
  type EngagementSummaryRow,
} from '@/lib/engagements/types'

interface InvoiceLink {
  id: string
  invoice_number: string
  status: string
}

export default function EngagementDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { currentBusiness } = useBusiness()

  const engagementId = params?.id as string
  const [engagement, setEngagement] = useState<EngagementRow | null>(null)
  const [summary, setSummary] = useState<EngagementSummaryRow | null>(null)
  const [entries, setEntries] = useState<EngagementEntryRow[]>([])
  const [clientName, setClientName] = useState<string | null>(null)
  const [invoices, setInvoices] = useState<Record<string, InvoiceLink>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isBusy, setIsBusy] = useState(false)
  const [waiving, setWaiving] = useState<EngagementEntryRow | null>(null)
  const [waiveReason, setWaiveReason] = useState('')

  const load = useCallback(async () => {
    if (!currentBusiness || !engagementId) {
      setIsLoading(false)
      return
    }

    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()

    // A mesma verificação durante a consulta da página de lista: um lançamento cuja data já passou
    // fica pronto para faturamento quando alguém acessa a página.
    await supabase.rpc('promote_due_entries', { p_business_id: currentBusiness.id })

    const [{ data: row }, { data: summaryRow }, { data: entryRows }] = await Promise.all([
      supabase.from('engagements').select('*').eq('id', engagementId).maybeSingle(),
      supabase
        .from('engagement_summary')
        .select('*')
        .eq('engagement_id', engagementId)
        .maybeSingle(),
      supabase
        .from('engagement_entries')
        .select('*')
        .eq('engagement_id', engagementId)
        .order('position'),
    ])

    if (!row) {
      setIsLoading(false)
      return
    }

    setEngagement(row as EngagementRow)
    setSummary((summaryRow ?? null) as EngagementSummaryRow | null)
    const schedule = (entryRows ?? []) as EngagementEntryRow[]
    setEntries(schedule)

    const [{ data: client }, { data: invoiceRows }] = await Promise.all([
      supabase.from('clients').select('name').eq('id', row.client_id).maybeSingle(),
      supabase
        .from('invoices')
        .select('id, invoice_number, status')
        .in('id', schedule.map((entry) => entry.invoice_id).filter((id): id is string => !!id)),
    ])

    setClientName(client?.name ?? null)
    setInvoices(
      Object.fromEntries((invoiceRows ?? []).map((invoice) => [invoice.id, invoice as InvoiceLink])),
    )
    setIsLoading(false)
  }, [currentBusiness, engagementId])

  useEffect(() => {
    load()
  }, [load])

  const money = (amount: number | null | undefined) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: engagement?.currency || 'USD',
    }).format(amount ?? 0)

  async function changeStatus(status: EngagementStatus, label: string) {
    setIsBusy(true)
    const { setEngagementStatusAction } = await import('@/lib/actions/engagements')
    const result = await setEngagementStatusAction(engagementId, status, crypto.randomUUID())
    setIsBusy(false)

    if ('error' in result) {
      toast.error(result.error)
      return
    }
    if (result.warning) toast.warning(result.warning)
    else toast.success(label)
    await load()
  }

  async function markComplete(entry: EngagementEntryRow) {
    setIsBusy(true)
    const { markEntryCompleteAction } = await import('@/lib/actions/engagements')
    const result = await markEntryCompleteAction(entry.id, crypto.randomUUID())
    setIsBusy(false)

    if ('error' in result) {
      toast.error(result.error)
      return
    }
    toast.success(`Lançamento "${entry.label}" concluído`)
    await load()
  }

  async function confirmWaive() {
    if (!waiving) return
    setIsBusy(true)
    const { waiveEntryAction } = await import('@/lib/actions/engagements')
    const result = await waiveEntryAction(waiving.id, waiveReason, crypto.randomUUID())
    setIsBusy(false)

    if ('error' in result) {
      toast.error(result.error)
      return
    }
    setWaiving(null)
    setWaiveReason('')
    toast.success('Lançamento dispensado')
    await load()
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!engagement) {
    return (
      <div className="p-6 lg:p-8">
        <PageHeader title="Contrato não encontrado" description="Ele pode ter sido excluído." />
        <Button className="mt-6" variant="outline" onClick={() => router.push('/engagements')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar para contratos
        </Button>
      </div>
    )
  }

  const isClosed = engagement.status === 'completed' || engagement.status === 'cancelled'
  const readyEntries = entries.filter((entry) => entry.status === 'ready_to_bill')
  // Um contrato em rascunho ou cancelado não pode ser faturado,
  // por isso o botão nem é exibido, em vez de ser exibido e depois recusado.
  const canDraftInvoice =
    readyEntries.length > 0 &&
    engagement.status !== 'draft' &&
    engagement.status !== 'cancelled'
  // Pré-seleciona exatamente os lançamentos prontos no formulário real da fatura,
  // para que a pessoa veja e aprove o que será faturado.
  const draftInvoiceHref = `/invoices/new?client=${engagement.client_id}&engagement_entries=${readyEntries
    .map((entry) => entry.id)
    .join(',')}`

  return (
    <div className="p-6 lg:p-8">
      <Link
        href="/engagements"
        className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Contratos
      </Link>

      <PageHeader
        title={engagement.name}
        description={`${clientName ?? 'Cliente desconhecido'} · ${BILLING_MODE_LABELS[engagement.billing_mode]}`}
      >
        <Badge className={ENGAGEMENT_STATUS_COLORS[engagement.status]}>{engagement.status}</Badge>
        {canDraftInvoice && (
          <Button size="sm" asChild>
            <Link href={draftInvoiceHref}>
              <FileText className="mr-2 h-4 w-4" />
              Criar fatura com lançamentos prontos
            </Link>
          </Button>
        )}
        {(engagement.status === 'draft' || engagement.status === 'paused') && (
          <Button size="sm" disabled={isBusy} onClick={() => changeStatus('active', 'Contrato iniciado')}>
            <Play className="mr-2 h-4 w-4" />
            Iniciar
          </Button>
        )}
        {engagement.status === 'active' && (
          <Button
            size="sm"
            variant="outline"
            disabled={isBusy}
            onClick={() => changeStatus('paused', 'Contrato pausado')}
          >
            <Pause className="mr-2 h-4 w-4" />
            Pausar
          </Button>
        )}
        {!isClosed && (
          <Button
            size="sm"
            variant="outline"
            disabled={isBusy}
            onClick={() => changeStatus('completed', 'Contrato concluído')}
          >
            <Check className="mr-2 h-4 w-4" />
            Concluir
          </Button>
        )}
        {!isClosed && (
          <Button
            size="sm"
            variant="ghost"
            disabled={isBusy}
            onClick={() => changeStatus('cancelled', 'Contrato cancelado')}
          >
            <Ban className="mr-2 h-4 w-4" />
            Cancelar
          </Button>
        )}
      </PageHeader>

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        {[
          { label: 'Total acordado', value: money(engagement.total) },
          { label: 'Faturado', value: money(summary?.amount_billed) },
          { label: 'Restante', value: money(summary?.amount_remaining) },
          {
            label: 'Pronto para faturar',
            value: `${summary?.ready_count ?? 0} · ${money(summary?.ready_amount)}`,
          },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{stat.label}</p>
              <p className="mt-1 text-lg font-semibold">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Cronograma</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lançamento</TableHead>
                <TableHead>Fica faturável</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Fatura</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => {
                const invoice = entry.invoice_id ? invoices[entry.invoice_id] : undefined
                const canChange = entry.status === 'pending' || entry.status === 'ready_to_bill'
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">{entry.label}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {DUE_RULE_LABELS[entry.due_rule]}
                      {entry.due_on ? ` (${entry.due_on})` : ''}
                    </TableCell>
                    <TableCell className="text-right">
                      {money(entry.amount)}
                      {entry.percent !== null && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          {entry.percent}%
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={ENTRY_STATUS_COLORS[entry.status]}>
                        {ENTRY_STATUS_LABELS[entry.status]}
                      </Badge>
                      {entry.status === 'waived' && entry.waived_reason && (
                        <p className="mt-1 text-xs text-muted-foreground">{entry.waived_reason}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      {invoice ? (
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="text-primary hover:underline"
                        >
                          {invoice.invoice_number}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Não faturado</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {canChange && (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isBusy || entry.status === 'ready_to_bill'}
                            onClick={() => markComplete(entry)}
                          >
                            <Check className="mr-1 h-3.5 w-3.5" />
                            Marcar como concluído
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={isBusy}
                            onClick={() => {
                              setWaiving(entry)
                              setWaiveReason('')
                            }}
                          >
                            <CircleSlash className="mr-1 h-3.5 w-3.5" />
                            Dispensar
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {engagement.notes && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Observações</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{engagement.notes}</p>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!waiving} onOpenChange={(open) => !open && setWaiving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dispensar este lançamento</DialogTitle>
            <DialogDescription>
              {waiving ? `${waiving.label}, ${money(waiving.amount)}.` : ''} Ele continua no
              cronograma com o motivo, mas deixa de contar no saldo a faturar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="waive-reason">Motivo</Label>
            <Input
              id="waive-reason"
              value={waiveReason}
              onChange={(event) => setWaiveReason(event.target.value)}
              placeholder="O cliente assumiu este trabalho"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setWaiving(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmWaive} disabled={isBusy || waiveReason.trim().length === 0}>
              Dispensar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
