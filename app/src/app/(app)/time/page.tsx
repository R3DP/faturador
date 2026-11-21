'use client'

import { toast } from 'sonner'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Plus,
  Search,
  Clock,
  MoreHorizontal,
  Pencil,
  Trash2,
  DollarSign,
} from 'lucide-react'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { useBusiness } from '@/lib/hooks/use-business'
import type { TimeEntry, Client } from '@/types'

import { deleteTimeEntryAction } from '@/lib/actions/time'
import { entrySeconds } from '@/lib/work/time'
import { parseDay } from '@/lib/dates'

export default function TimePage() {
  const { currentBusiness } = useBusiness()
  const [timeEntries, setTimeEntries] = useState<(TimeEntry & { client: Client | null })[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [clientFilter, setClientFilter] = useState<string>('all')
  const [billedFilter, setBilledFilter] = useState<string>('all')
  const [deleteEntry, setDeleteEntry] = useState<TimeEntry | null>(null)

  useEffect(() => {
    async function fetchTimeEntries() {
      if (!currentBusiness) return

      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { data } = await supabase
        .from('time_entries')
        .select('*, client:clients(*)')
        .eq('business_id', currentBusiness.id)
        .order('date', { ascending: false })

      if (data) {
        setTimeEntries(data as (TimeEntry & { client: Client | null })[])
      }
      setIsLoading(false)
    }

    fetchTimeEntries()
  }, [currentBusiness])

  const filteredEntries = timeEntries.filter((entry) => {
    const matchesSearch =
      entry.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.project_name?.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesClient =
      clientFilter === 'all' || entry.client_id === clientFilter
    const matchesBilled =
      billedFilter === 'all' ||
      (billedFilter === 'billed' && entry.is_billed) ||
      (billedFilter === 'unbilled' && !entry.is_billed && entry.is_billable)
    return matchesSearch && matchesClient && matchesBilled
  })

  // Calcula os totais
  const totalHours = filteredEntries.reduce((sum, e) => sum + entrySeconds(e) / 3600, 0)
  const billableHours = filteredEntries
    .filter((e) => e.is_billable && !e.is_billed)
    .reduce((sum, e) => sum + entrySeconds(e) / 3600, 0)
  const billableAmount = filteredEntries.filter(e=>(e.currency || currentBusiness?.default_currency)===currentBusiness?.default_currency)
    .filter((e) => e.is_billable && !e.is_billed)
    .reduce((sum, e) => sum + (e.amount ?? 0), 0)

  const formatCurrency = (amount: number, currency = currentBusiness?.default_currency || 'USD') => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
    }).format(amount)
  }

  const handleDelete = async () => {
    if (!deleteEntry) return

    const result = await deleteTimeEntryAction(deleteEntry.id)
    if ('error' in result) { toast.error(result.error); return }
    setTimeEntries(timeEntries.filter((e) => e.id !== deleteEntry.id))
    setDeleteEntry(null)
  }

  const uniqueClients = Array.from(
    new Map(
      timeEntries
        .filter((e) => e.client)
        .map((e) => [e.client!.id, e.client!])
    ).values()
  )

  if (!currentBusiness) return null

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Controle de horas"
        description="Acompanhe o tempo dedicado aos projetos dos clientes"
      >
        <Button asChild>
          <Link href="/time/new">
            <Plus className="mr-2 h-4 w-4" />
            Registrar horas
          </Link>
        </Button>
      </PageHeader>

      {/* Estatísticas */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total de horas</p>
                <p className="text-2xl font-bold tabular-nums">{totalHours.toFixed(1)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
                <Clock className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Horas não faturadas</p>
                <p className="text-2xl font-bold tabular-nums">{billableHours.toFixed(1)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Valor não faturado</p>
                <p className="text-2xl font-bold tabular-nums">{formatCurrency(billableAmount)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar lançamentos de horas..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Todos os clientes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os clientes</SelectItem>
            {uniqueClients.map((client) => (
              <SelectItem key={client.id} value={client.id}>
                {client.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={billedFilter} onValueChange={setBilledFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="unbilled">Não faturadas</SelectItem>
            <SelectItem value="billed">Faturado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Lançamentos de tempo */}
      <div className="mt-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : filteredEntries.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <EmptyState
                icon={Clock}
                title={searchQuery || clientFilter !== 'all' ? 'Nenhum lançamento de horas encontrado' : 'Nenhuma hora registrada'}
                description={
                  searchQuery || clientFilter !== 'all'
                    ? 'Ajuste os filtros da busca'
                    : 'Registre o tempo trabalhado para faturar seus clientes com precisão.'
                }
                action={
                  !searchQuery && clientFilter === 'all'
                    ? { label: 'Registrar horas', href: '/time/new' }
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
                    <TableHead>Data</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Cliente / Projeto</TableHead>
                    <TableHead className="text-right">Horas</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEntries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-medium">
                        {format(parseDay(entry.date), 'd MMM yyyy', { locale: ptBR })}
                      </TableCell>
                      <TableCell className="max-w-xs truncate">
                        {entry.description}
                      </TableCell>
                      <TableCell>
                        {entry.client ? (
                          <Link
                            href={`/clients/${entry.client_id}`}
                            className="hover:text-primary"
                          >
                            {entry.client.name}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                        {entry.project_name && (
                          <span className="ml-2 text-sm text-muted-foreground">
                            ({entry.project_name})
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {(entrySeconds(entry) / 3600).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {entry.is_billable
                          ? formatCurrency(entry.amount ?? 0, entry.currency)
                          : '-'}
                      </TableCell>
                      <TableCell>
                        {!entry.is_billable ? (
                          <Badge variant="secondary">Não faturável</Badge>
                        ) : entry.is_billed ? (
                          <Badge variant="secondary" className="bg-green-100 text-green-700">
                            Faturado
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-amber-100 text-amber-700">
                            Não faturadas
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button aria-label="Abrir ações do lançamento de horas" variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link href={`/time/${entry.id}`}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Editar
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setDeleteEntry(entry)}
                              className="text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Confirmação de exclusão */}
      <Dialog open={!!deleteEntry} onOpenChange={() => setDeleteEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir lançamento de horas</DialogTitle>
            <DialogDescription>
              Tem certeza de que deseja excluir este lançamento de horas? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteEntry(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

