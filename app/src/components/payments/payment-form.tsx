'use client'

import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CalendarIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Calendar } from '@/components/ui/calendar'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { paymentMethods } from '@/lib/constants'
import type { Invoice, Client } from '@/types'

const paymentSchema = z.object({
  invoice_id: z.string().min(1, 'Selecione uma fatura'),
  amount: z.coerce.number().min(0.01, 'O valor deve ser maior que zero'),
  payment_date: z.date(),
  payment_method: z.string().min(1, 'Selecione uma forma de pagamento'),
  reference_number: z.string().optional(),
  notes: z.string().optional(),
})

export type PaymentFormData = z.infer<typeof paymentSchema>

interface PaymentFormProps {
  invoices: (Invoice & { client: Client })[]
  onSubmit: (data: PaymentFormData) => Promise<void>
  onCancel: () => void
  defaultInvoiceId?: string
}

export function PaymentForm({
  invoices,
  onSubmit,
  onCancel,
  defaultInvoiceId,
}: PaymentFormProps) {
  const unpaidInvoices = invoices.filter(
    (inv) => inv.balance_due > 0 && inv.status !== 'cancelled'
  )

  const form = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema) as Resolver<PaymentFormData>,
    defaultValues: {
      invoice_id: defaultInvoiceId || '',
      amount: 0,
      payment_date: new Date(),
      payment_method: '',
      reference_number: '',
      notes: '',
    },
  })

  const selectedInvoiceId = form.watch('invoice_id')
  const selectedInvoice = unpaidInvoices.find(
    (inv) => inv.id === selectedInvoiceId
  )

  const handleInvoiceChange = (invoiceId: string) => {
    const invoice = unpaidInvoices.find((inv) => inv.id === invoiceId)
    if (invoice) {
      form.setValue('invoice_id', invoiceId)
      form.setValue('amount', invoice.balance_due)
    }
  }

  const handleSubmit = async (data: PaymentFormData) => {
    await onSubmit(data)
  }

  const formatCurrency = (amount: number, currency = 'USD') => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
    }).format(amount)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <Card>
          <CardContent className="pt-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="invoice_id"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Fatura</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={handleInvoiceChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione uma fatura" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {unpaidInvoices.length === 0 ? (
                          <p className="p-4 text-center text-sm text-muted-foreground">
                            Nenhuma fatura em aberto
                          </p>
                        ) : (
                          unpaidInvoices.map((invoice) => (
                            <SelectItem key={invoice.id} value={invoice.id}>
                              <div className="flex items-center justify-between gap-4">
                                <span>
                                  {invoice.invoice_number} - {invoice.client.name}
                                </span>
                                <span className="text-muted-foreground">
                                  {formatCurrency(invoice.balance_due, invoice.currency)} due
                                </span>
                              </div>
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {selectedInvoice && (
                <div className="rounded-lg bg-muted p-4 sm:col-span-2">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <p className="text-sm text-muted-foreground">Total da fatura</p>
                      <p className="font-medium tabular-nums">
                        {formatCurrency(selectedInvoice.total, selectedInvoice.currency)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Já pago</p>
                      <p className="font-medium tabular-nums text-green-600">
                        {formatCurrency(selectedInvoice.amount_paid, selectedInvoice.currency)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Saldo devido</p>
                      <p className="font-medium tabular-nums">
                        {formatCurrency(selectedInvoice.balance_due, selectedInvoice.currency)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Valor do pagamento</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                          $
                        </span>
                        <Input
                          type="number"
                          step="0.01"
                          min="0.01"
                          max={selectedInvoice?.balance_due}
                          placeholder="0.00"
                          className="pl-7"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    {selectedInvoice && field.value < selectedInvoice.balance_due && (
                      <FormDescription>
                        Este é um pagamento parcial
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="payment_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data do pagamento</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              'w-full justify-start text-left font-normal',
                              !field.value && 'text-muted-foreground'
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {field.value ? (
                              format(field.value, 'PPP', { locale: ptBR })
                            ) : (
                              <span>Escolha uma data</span>
                            )}
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          autoFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="payment_method"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Forma de pagamento</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione uma forma de pagamento" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {paymentMethods
                          .filter((m) => m.value !== 'stripe')
                          .map((method) => (
                            <SelectItem key={method.value} value={method.value}>
                              {method.label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="reference_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Número de referência (opcional)</FormLabel>
                    <FormControl>
                      <Input placeholder="ex.: cheque nº 1234" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Observações (opcional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Observações adicionais sobre este pagamento"
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Registrando...' : 'Registrar pagamento'}
          </Button>
        </div>
      </form>
    </Form>
  )
}

