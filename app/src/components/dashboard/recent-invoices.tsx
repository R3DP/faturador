'use client'

import Link from 'next/link'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { FileText, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { invoiceStatusColors } from '@/types'
import type { Invoice, Client, InvoiceStatus } from '@/types'
import { parseDay } from '@/lib/dates'

const invoiceStatusLabels: Record<InvoiceStatus, string> = {
  draft: 'Rascunho',
  sent: 'Enviada',
  viewed: 'Visualizada',
  paid: 'Paga',
  partial: 'Parcial',
  overdue: 'Atrasada',
  cancelled: 'Cancelada',
}

interface RecentInvoicesProps {
  invoices: (Invoice & { client: Client })[]
}

export function RecentInvoices({ invoices }: RecentInvoicesProps) {
  const formatCurrency = (amount: number, currency = 'USD') => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
    }).format(amount)
  }

  if (invoices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Faturas recentes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <FileText className="h-10 w-10 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              Você ainda não tem faturas. Crie sua primeira fatura para começar.
            </p>
            <Button className="mt-4" asChild>
              <Link href="/invoices/new">Criar fatura</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Faturas recentes</CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/invoices">
            Ver todas
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-zinc-100">
          {invoices.map((invoice) => (
            <Link
              key={invoice.id}
              href={`/invoices/${invoice.id}`}
              className="flex flex-wrap items-center justify-between gap-3 py-4 transition-colors hover:bg-zinc-50/60"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-50">
                  <FileText className="h-4 w-4 text-zinc-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">
                    {invoice.invoice_number}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {invoice.client.name}
                  </p>
                </div>
              </div>
              <div className="flex min-w-0 items-center gap-3">
                <div className="text-right">
                  <p className="font-medium tabular-nums">
                    {formatCurrency(invoice.total, invoice.currency)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Vence em {format(parseDay(invoice.due_date), 'd MMM', { locale: ptBR })}
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className={invoiceStatusColors[invoice.status]}
                >
                  {invoiceStatusLabels[invoice.status]}
                </Badge>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
