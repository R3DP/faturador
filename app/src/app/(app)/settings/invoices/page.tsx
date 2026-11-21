'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsLayout } from '@/components/settings/settings-layout'
import { useBusiness } from '@/lib/hooks/use-business'
import { updateInvoiceDefaultsAction } from '@/lib/actions/business'

const invoiceSettingsSchema = z.object({
  default_currency: z.string(),
  default_payment_terms: z.number().int().min(0),
  invoice_prefix: z.string().min(1),
  estimate_prefix: z.string().min(1),
  invoice_notes: z.string().optional(),
  invoice_footer: z.string().optional(),
})

type InvoiceSettingsForm = z.infer<typeof invoiceSettingsSchema>

export default function InvoiceSettingsPage() {
  const { currentBusiness, refreshBusinesses, isLoading } = useBusiness()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
  } = useForm<InvoiceSettingsForm>({
    resolver: zodResolver(invoiceSettingsSchema),
    defaultValues: {
      default_currency: currentBusiness?.default_currency || 'USD',
      default_payment_terms: currentBusiness?.default_payment_terms || 30,
      invoice_prefix: currentBusiness?.invoice_prefix || 'INV',
      estimate_prefix: currentBusiness?.estimate_prefix || 'EST',
      invoice_notes: currentBusiness?.invoice_notes || '',
      invoice_footer: currentBusiness?.invoice_footer || '',
    },
  })

  const currency = watch('default_currency')

  // As empresas carregam de forma assíncrona; sincroniza o formulário quando os dados chegam
  useEffect(() => {
    if (currentBusiness) {
      reset({
        default_currency: currentBusiness.default_currency || 'USD',
        default_payment_terms: currentBusiness.default_payment_terms || 30,
        invoice_prefix: currentBusiness.invoice_prefix || 'INV',
        estimate_prefix: currentBusiness.estimate_prefix || 'EST',
        invoice_notes: currentBusiness.invoice_notes || '',
        invoice_footer: currentBusiness.invoice_footer || '',
      })
    }
  }, [currentBusiness, reset])

  async function onSubmit(data: InvoiceSettingsForm) {
    if (!currentBusiness) return

    setIsSubmitting(true)
    setMessage(null)

    const result = await updateInvoiceDefaultsAction(currentBusiness.id, data)

    setIsSubmitting(false)

    if ('error' in result) {
      setMessage({ type: 'error', text: result.error })
    } else {
      setMessage({ type: 'success', text: 'Configurações de faturas atualizadas' })
      refreshBusinesses()
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!currentBusiness) {
    return null
  }

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Configurações"
        description="Gerencie as configurações e preferências da sua empresa"
      />

      <div className="mt-6">
        <SettingsLayout>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {message && (
              <div
                className={`rounded-lg p-3 text-sm ${
                  message.type === 'success'
                    ? 'bg-green-50 text-green-800'
                    : 'bg-red-50 text-red-800'
                }`}
              >
                {message.text}
              </div>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Padrões de fatura</CardTitle>
                <CardDescription>
                  Configurações padrão para novas faturas e orçamentos
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="default_currency">Moeda padrão</Label>
                    <Select
                      value={currency}
                      onValueChange={(value) => setValue('default_currency', value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USD">USD - dólar americano</SelectItem>
                        <SelectItem value="EUR">EUR - euro</SelectItem>
                        <SelectItem value="GBP">GBP - libra esterlina</SelectItem>
                        <SelectItem value="CAD">CAD - dólar canadense</SelectItem>
                        <SelectItem value="AUD">AUD - dólar australiano</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="default_payment_terms">Prazo de pagamento (dias)</Label>
                    <Input
                      id="default_payment_terms"
                      type="number"
                      min={0}
                      {...register('default_payment_terms', { valueAsNumber: true })}
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="invoice_prefix">Prefixo do número da fatura</Label>
                    <Input id="invoice_prefix" {...register('invoice_prefix')} />
                    <p className="text-xs text-muted-foreground">
                      Próxima fatura: {currentBusiness.invoice_prefix}-
                      {String(currentBusiness.next_invoice_number).padStart(4, '0')}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="estimate_prefix">Prefixo do número do orçamento</Label>
                    <Input id="estimate_prefix" {...register('estimate_prefix')} />
                    <p className="text-xs text-muted-foreground">
                      Próximo orçamento: {currentBusiness.estimate_prefix}-
                      {String(currentBusiness.next_estimate_number).padStart(4, '0')}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Texto padrão</CardTitle>
                <CardDescription>
                  Observações e rodapé padrão que aparecerão em novas faturas
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="invoice_notes">Observações padrão</Label>
                  <Textarea
                    id="invoice_notes"
                    {...register('invoice_notes')}
                    placeholder="Agradecemos por escolher nossa empresa!"
                    rows={3}
                  />
                  <p className="text-xs text-muted-foreground">
                    Exibido na seção de observações das faturas
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="invoice_footer">Rodapé padrão</Label>
                  <Textarea
                    id="invoice_footer"
                    {...register('invoice_footer')}
                    placeholder="CNPJ, condições etc."
                    rows={2}
                  />
                  <p className="text-xs text-muted-foreground">
                    Exibido no rodapé das faturas
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar alterações
              </Button>
            </div>
          </form>
        </SettingsLayout>
      </div>
    </div>
  )
}

