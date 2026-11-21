'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Plus, Search, FileText, MoreHorizontal } from 'lucide-react'
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
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { useBusiness } from '@/lib/hooks/use-business'
import { estimateStatusColors } from '@/types'
import type { Estimate, Client } from '@/types'

import { parseDay } from '@/lib/dates'

export default function EstimatesPage() {
  const router = useRouter()
  const { currentBusiness } = useBusiness()
  const [estimates, setEstimates] = useState<(Estimate & { client: Client })[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  useEffect(() => {
    async function fetchEstimates() {
      if (!currentBusiness) return

      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { data } = await supabase
        .from('estimates')
        .select('*, client:clients(*)')
        .eq('business_id', currentBusiness.id)
        .order('created_at', { ascending: false })

      if (data) {
        setEstimates(data as (Estimate & { client: Client })[])
      }
      setIsLoading(false)
    }

    fetchEstimates()
  }, [currentBusiness])

  const filteredEstimates = estimates.filter((estimate) => {
    const matchesSearch =
      estimate.estimate_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      estimate.client.name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesStatus = statusFilter === 'all' || estimate.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const formatCurrency = (amount: number, currency = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amount)
  }

  const handleConvertToInvoice = async (estimate: Estimate & { client: Client }) => {
    if (!currentBusiness) return

    try {
      const { convertEstimateAction } = await import('@/lib/actions/estimates')
      const invoice = await convertEstimateAction(estimate.id)
      toast.success('Orçamento convertido em fatura')
      router.push(`/invoices/${invoice.id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível converter o orçamento')
    }
  }

  if (!currentBusiness) return null

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Orçamentos"
        description="Crie e gerencie orçamentos de projetos"
      >
        <Button asChild>
          <Link href="/estimates/new">
            <Plus className="mr-2 h-4 w-4" />
            Novo orçamento
          </Link>
        </Button>
      </PageHeader>

      {/* Filtros */}
      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar orçamentos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filtrar por status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="draft">Rascunho</SelectItem>
            <SelectItem value="sent">Enviada</SelectItem>
            <SelectItem value="viewed">Visualizada</SelectItem>
            <SelectItem value="accepted">Aceito</SelectItem>
            <SelectItem value="rejected">Recusado</SelectItem>
            <SelectItem value="expired">Expirado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Lista de orçamentos */}
      <div className="mt-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : filteredEstimates.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <EmptyState
                icon={FileText}
                title={searchQuery || statusFilter !== 'all' ? 'Nenhum orçamento encontrado' : 'Nenhum orçamento cadastrado'}
                description={
                  searchQuery || statusFilter !== 'all'
                    ? 'Ajuste a busca ou o filtro'
                    : 'Crie orçamentos para enviar propostas aos seus clientes'
                }
                action={
                  !searchQuery && statusFilter === 'all'
                    ? { label: 'Criar orçamento', href: '/estimates/new' }
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
                    <TableHead>Orçamento</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Validade</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEstimates.map((estimate) => (
                    <TableRow key={estimate.id}>
                      <TableCell>
                        <Link
                          href={`/estimates/${estimate.id}`}
                          className="font-medium hover:text-primary"
                        >
                          {estimate.estimate_number}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/clients/${estimate.client_id}`}
                          className="hover:text-primary"
                        >
                          {estimate.client.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={estimateStatusColors[estimate.status]}
                        >
                          {estimate.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {format(parseDay(estimate.expiry_date as string), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCurrency(estimate.total, estimate.currency)}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={'Ações do orçamento ' + estimate.estimate_number}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link href={`/estimates/${estimate.id}`}>
                                Ver
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link href={`/estimates/${estimate.id}/edit`}>
                                Editar
                              </Link>
                            </DropdownMenuItem>
                            {estimate.status === 'accepted' && !estimate.converted_invoice_id && (
                              <DropdownMenuItem
                                onClick={() => handleConvertToInvoice(estimate)}
                              >
                                Converter em fatura
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem asChild>
                              <Link
                                href={`/e/${estimate.public_id}`}
                                target="_blank"
                              >
                                Ver link público
                              </Link>
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
    </div>
  )
}

