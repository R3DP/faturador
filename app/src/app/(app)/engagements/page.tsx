'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Plus, Search, Handshake } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { useBusiness } from '@/lib/hooks/use-business'
import { ENGAGEMENT_STATUSES } from '@/lib/engagements/schedule'
import {
  ENGAGEMENT_STATUS_COLORS,
  ENGAGEMENT_STATUS_LABELS,
  type EngagementListRow,
} from '@/lib/engagements/types'
import { formatContractMoney } from '@/lib/engagements/presentation'

export default function EngagementsPage() {
  return (
    <Suspense>
      <EngagementsPageInner />
    </Suspense>
  )
}

function EngagementsPageInner() {
  const { currentBusiness } = useBusiness()
  // O cartão "Pronto para faturar" do painel aponta para cá com ?ready=1, para que o
  // lembrete mostre exatamente os contratos que estavam sendo contabilizados.
  const readyOnly = useSearchParams().get('ready') === '1'
  const [engagements, setEngagements] = useState<EngagementListRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const load = useCallback(async () => {
    if (!currentBusiness) return

    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()

    // A verificação de vencimentos do cronograma ocorre durante a consulta, não por cron;
    // então é ao abrir esta página que um pagamento cuja
    // data já passou aparece como pronto para faturar.
    await supabase.rpc('promote_due_entries', { p_business_id: currentBusiness.id })

    const [{ data: rows }, { data: clients }] = await Promise.all([
      supabase
        .from('engagement_summary')
        .select('*')
        .eq('business_id', currentBusiness.id),
      supabase.from('clients').select('id, name').eq('business_id', currentBusiness.id),
    ])

    const names = new Map((clients ?? []).map((client) => [client.id, client.name]))
    const summaries = (rows ?? []) as EngagementListRow[]
    setEngagements(
      summaries
        .map((row) => ({ ...row, client_name: names.get(row.client_id ?? '') ?? null }))
        .sort((a, b) => (b.ready_count ?? 0) - (a.ready_count ?? 0) || (a.name ?? '').localeCompare(b.name ?? '')),
    )
    setIsLoading(false)
  }, [currentBusiness])

  useEffect(() => {
    load()
  }, [load])

  const filtered = engagements.filter((engagement) => {
    const query = searchQuery.toLowerCase()
    const matchesSearch =
      !query ||
      (engagement.name ?? '').toLowerCase().includes(query) ||
      (engagement.client_name ?? '').toLowerCase().includes(query)
    const matchesStatus = statusFilter === 'all' || engagement.status === statusFilter
    const matchesReady = !readyOnly || (engagement.ready_count ?? 0) > 0
    return matchesSearch && matchesStatus && matchesReady
  })

  const readyTotal = engagements.reduce((sum, row) => sum + (row.ready_count ?? 0), 0)

  if (!currentBusiness) return null

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Contratos"
        description="Trabalho acordado com valor total e cronograma de pagamentos. Nada daqui é enviado ao cliente sem uma ação sua."
      >
        <Button asChild>
          <Link href="/engagements/new">
            <Plus className="mr-2 h-4 w-4" />
            Novo contrato
          </Link>
        </Button>
      </PageHeader>

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar contratos..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filtrar por situação" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as situações</SelectItem>
            {ENGAGEMENT_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {ENGAGEMENT_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {readyOnly ? (
          <Badge className="bg-emerald-100 text-emerald-700" asChild>
            <Link href="/engagements">Somente prontos para faturar. Mostrar todos</Link>
          </Badge>
        ) : (
          readyTotal > 0 && (
            <Link href="/engagements?ready=1">
              <Badge className="bg-emerald-100 text-emerald-700">
                {readyTotal} prontos para faturar
              </Badge>
            </Link>
          )
        )}
      </div>

      <div className="mt-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <EmptyState
                icon={Handshake}
                title={
                  readyOnly
                    ? 'Nenhum contrato pronto para faturar'
                    : searchQuery || statusFilter !== 'all'
                      ? 'Nenhum contrato encontrado'
                      : 'Nenhum contrato cadastrado'
                }
                description={
                  readyOnly
                    ? 'Não há contratos prontos para faturar com os filtros atuais.'
                    : searchQuery || statusFilter !== 'all'
                      ? 'Ajuste a busca ou o filtro'
                      : 'Registre o valor acordado uma vez e fature conforme o cronograma, sem precisar lembrar quanto falta.'
                }
                action={
                  !readyOnly && !searchQuery && statusFilter === 'all'
                    ? { label: 'Novo contrato', href: '/engagements/new' }
                    : undefined
                }
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contrato</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Faturado</TableHead>
                    <TableHead className="text-right">Restante</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((engagement) => (
                    <TableRow key={engagement.engagement_id}>
                      <TableCell>
                        <Link
                          href={`/engagements/${engagement.engagement_id}`}
                          className="font-medium text-foreground hover:text-primary"
                        >
                          {engagement.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {engagement.client_name ?? 'Cliente desconhecido'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            engagement.status
                              ? ENGAGEMENT_STATUS_COLORS[engagement.status]
                              : undefined
                          }
                        >
                          {engagement.status
                            ? ENGAGEMENT_STATUS_LABELS[engagement.status]
                            : 'Desconhecida'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatContractMoney(engagement.total, engagement.currency)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatContractMoney(engagement.amount_billed, engagement.currency)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatContractMoney(engagement.amount_remaining, engagement.currency)}
                      </TableCell>
                      <TableCell className="text-right">
                        {(engagement.ready_count ?? 0) > 0 && (
                          <Badge className="bg-emerald-100 text-emerald-700">
                            Pronto para faturar
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
