'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import {
  Plus,
  Search,
  DollarSign,
  CreditCard,
  TrendingUp,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { PaymentCorrections, isStripeSourced } from '@/components/payments/payment-corrections'
import { useBusiness } from '@/lib/hooks/use-business'
import { paymentMethods } from '@/lib/constants'
import { formatCurrencyAmount, summarizePaymentsByCurrency } from '@/lib/payments/currency-summary'
import type { Payment, Invoice, Client } from '@/types'

import { parseDay } from '@/lib/dates'

export default function PaymentsPage() {
  const { currentBusiness, isLoading: isBusinessLoading } = useBusiness()
  const [payments, setPayments] = useState<(Payment & { invoice: Invoice & { client: Client } })[]>([])
  const [isPaymentsLoading, setIsPaymentsLoading] = useState(true)
  const [paymentsBusinessId, setPaymentsBusinessId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [methodFilter, setMethodFilter] = useState<string>('all')

  useEffect(() => {
    let active = true
    const businessId = currentBusiness?.id

    setPayments([])
    setPaymentsBusinessId(null)
    setLoadError(false)
    if (!businessId) {
      setIsPaymentsLoading(false)
      return () => {
        active = false
      }
    }
    const requestBusinessId: string = businessId

    setIsPaymentsLoading(true)
    async function loadPayments() {
      try {
        const { createClient } = await import('@/lib/supabase/client')
        const supabase = createClient()
        const { data, error } = await supabase
          .from('payments')
          .select('*, invoice:invoices(*, client:clients(*))')
          .eq('business_id', requestBusinessId)
          .order('payment_date', { ascending: false })

        if (!active) return
        setPaymentsBusinessId(requestBusinessId)
        if (error) {
          setPayments([])
          setLoadError(true)
        } else {
          setPayments((data ?? []) as (Payment & { invoice: Invoice & { client: Client } })[])
        }
      } catch {
        if (active) {
          setPayments([])
          setPaymentsBusinessId(requestBusinessId)
          setLoadError(true)
        }
      } finally {
        if (active) setIsPaymentsLoading(false)
      }
    }

    void loadPayments()
    return () => {
      active = false
    }
  }, [currentBusiness?.id, reloadToken])

  const businessPayments = paymentsBusinessId === currentBusiness?.id ? payments : []
  const isCurrentBusinessLoading =
    isBusinessLoading ||
    (currentBusiness !== null && (isPaymentsLoading || paymentsBusinessId !== currentBusiness.id))

  const filteredPayments = businessPayments.filter((payment) => {
    const matchesSearch =
      payment.invoice.invoice_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      payment.invoice.client.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      payment.reference_number?.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesMethod =
      methodFilter === 'all' || payment.payment_method === methodFilter
    return matchesSearch && matchesMethod
  })

  // Um pagamento estornado não representa dinheiro. Ele continua na lista, tachado, mas
  // nunca entra nos totais desta página nem de qualquer relatório.
  const livePayments = filteredPayments.filter((p) => !p.voided_at)
  const totalReceivedByCurrency = summarizePaymentsByCurrency(
    livePayments.map((payment) => ({ amount: payment.amount, currency: payment.invoice.currency })),
    currentBusiness?.default_currency || 'USD',
  )
  const thisMonthPayments = livePayments.filter((p) => {
    const paymentDate = parseDay(p.payment_date)
    const now = new Date()
    return (
      paymentDate.getMonth() === now.getMonth() &&
      paymentDate.getFullYear() === now.getFullYear()
    )
  })
  const thisMonthTotalsByCurrency = summarizePaymentsByCurrency(
    thisMonthPayments.map((payment) => ({ amount: payment.amount, currency: payment.invoice.currency })),
    currentBusiness?.default_currency || 'USD',
  )

  const getPaymentMethodLabel = (method: string) => {
    return paymentMethods.find((m) => m.value === method)?.label || method
  }

  if (!currentBusiness) {
    return (
      <div className="p-6 lg:p-8">
        {isBusinessLoading ? (
          <div role="status" aria-live="polite" className="flex items-center justify-center gap-3 py-12">
            <span className="sr-only">Carregando pagamentos...</span>
            <div aria-hidden="true" className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : (
          <Card>
            <CardContent className="py-12">
              <EmptyState
                icon={CreditCard}
                title="Nenhuma empresa disponível"
                description="Crie ou selecione uma empresa para ver os pagamentos"
              />
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Pagamentos"
        description="Veja o histórico e registre pagamentos"
      >
        <Button asChild>
          <Link href="/payments/new">
            <Plus className="mr-2 h-4 w-4" />
            Registrar pagamento
          </Link>
        </Button>
      </PageHeader>

      {/* Estatísticas */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total recebido</p>
                <p className="text-2xl font-bold tabular-nums">
                  {totalReceivedByCurrency.map(({ currency, total }) => (
                    <span key={currency} className="block">{formatCurrencyAmount(total, currency)}</span>
                  ))}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Este mês</p>
                <p className="text-2xl font-bold tabular-nums">
                  {thisMonthTotalsByCurrency.map(({ currency, total }) => (
                    <span key={currency} className="block">{formatCurrencyAmount(total, currency)}</span>
                  ))}
                </p>
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
            placeholder="Buscar pagamentos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={methodFilter} onValueChange={setMethodFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Todas as formas de pagamento" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as formas</SelectItem>
            {paymentMethods.map((method) => (
              <SelectItem key={method.value} value={method.value}>
                {method.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Lista de pagamentos */}
      <div className="mt-6">
        {isCurrentBusinessLoading ? (
          <div role="status" aria-live="polite" className="flex items-center justify-center gap-3 py-12">
            <span className="sr-only">Carregando pagamentos...</span>
            <div aria-hidden="true" className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : loadError && paymentsBusinessId === currentBusiness?.id ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
              <p role="alert" className="text-sm text-destructive">Não foi possível carregar os pagamentos. Verifique sua conexão e tente novamente.</p>
              <Button variant="outline" onClick={() => setReloadToken((token) => token + 1)}>Tentar novamente</Button>
            </CardContent>
          </Card>
        ) : filteredPayments.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <EmptyState
                icon={CreditCard}
                title={searchQuery || methodFilter !== 'all' ? 'Nenhum pagamento encontrado' : 'Nenhum pagamento registrado'}
                description={
                  searchQuery || methodFilter !== 'all'
                    ? 'Ajuste os filtros da busca'
                    : 'Os pagamentos aparecerão aqui quando as faturas forem pagas'
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
                    <TableHead>Fatura</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Forma de pagamento</TableHead>
                    <TableHead>Referência</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="w-[170px] text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPayments.map((payment) => (
                    <TableRow key={payment.id} className={payment.voided_at ? 'text-muted-foreground' : undefined}>
                      <TableCell className={payment.voided_at ? 'font-medium line-through' : 'font-medium'}>
                        {format(parseDay(payment.payment_date), 'dd/MM/yyyy')}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/invoices/${payment.invoice_id}`}
                          className="font-medium hover:text-primary"
                        >
                          {payment.invoice.invoice_number}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/clients/${payment.invoice.client_id}`}
                          className="hover:text-primary"
                        >
                          {payment.invoice.client.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant="secondary">
                            {getPaymentMethodLabel(payment.payment_method)}
                          </Badge>
                          {isStripeSourced(payment) && payment.payment_method !== 'stripe' && (
                            <Badge variant="outline">Stripe</Badge>
                          )}
                          {payment.voided_at && (
                            <Badge variant="outline" className="border-red-200 text-red-700">
                              Estornado
                            </Badge>
                          )}
                        </div>
                        {payment.voided_at && payment.void_reason && (
                          <p className="mt-1 text-xs text-muted-foreground">{payment.void_reason}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {payment.reference_number || '-'}
                      </TableCell>
                      <TableCell
                        className={
                          payment.voided_at
                            ? 'text-right font-medium tabular-nums text-muted-foreground line-through'
                            : 'text-right font-medium tabular-nums text-green-600'
                        }
                      >
                        +{formatCurrencyAmount(payment.amount, payment.invoice.currency)}
                      </TableCell>
                      <TableCell>
                        <PaymentCorrections
                          payment={payment}
                          onChanged={() => setReloadToken((token) => token + 1)}
                        />
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

