'use client'

/**
 * Controles de edição e estorno de um pagamento registrado, compartilhados pela página de pagamentos
 * e pela página da fatura, para que ambas ofereçam a mesma correção sob as mesmas regras.
 *
 * As duas ações passam pelas server actions em src/lib/actions/payments.ts,
 * que chamam as RPCs SECURITY DEFINER
 * update_payment e void_payment. As RPCs controlam todas as
 * demais regras: associação do usuário, bloqueio de pagamentos recebidos pela Stripe, bloqueio de
 * registros já estornados, idempotência em (payment_id, request_id), registro de auditoria
 * e recálculo de amount_paid, balance_due e status da fatura.
 * Nada aqui grava diretamente em `payments` ou `invoices`.
 *
 * Pagamentos recebidos pela Stripe ficam desativados, não ocultos, e o motivo aparece ao
 * passar o cursor, deixando claro que o controle existe e por que está indisponível.
 */

import { useRef, useState } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { toast } from 'sonner'
import { CalendarIcon, Ban, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Calendar } from '@/components/ui/calendar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { paymentMethods } from '@/lib/constants'
import { updatePaymentAction, voidPaymentAction } from '@/lib/actions/payments'
import { STRIPE_LOCKED_MESSAGE } from '@/lib/payments/messages'
import { parseDay, toISODate } from '@/lib/dates'
import type { Payment } from '@/types'

/** Somente o fluxo Stripe verificado pode registrar pagamentos com cartão, por isso essa opção não é oferecida. */
const EDITABLE_METHODS = paymentMethods.filter((method) => method.value !== 'stripe')

export function isStripeSourced(payment: Pick<Payment, 'source' | 'stripe_payment_id' | 'payment_method'>): boolean {
  if (payment.source) return payment.source === 'stripe'
  return !!payment.stripe_payment_id || payment.payment_method === 'stripe'
}

interface PaymentCorrectionsProps {
  payment: Payment
  /** Chamado após uma correção bem-sucedida para que a tela atualize os dados. */
  onChanged: () => void | Promise<void>
}

export function PaymentCorrections({ payment, onChanged }: PaymentCorrectionsProps) {
  const [editOpen, setEditOpen] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const stripeSourced = isStripeSourced(payment)
  const voided = !!payment.voided_at
  const disabled = stripeSourced || voided
  const reason = stripeSourced
    ? STRIPE_LOCKED_MESSAGE
    : voided
      ? 'Este pagamento já foi estornado.'
      : undefined

  return (
    <div className="flex items-center justify-end gap-1">
      <span title={reason}>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => setEditOpen(true)}
          aria-label="Editar pagamento"
        >
          <Pencil className="mr-1 h-3.5 w-3.5" />
          Editar
        </Button>
      </span>
      <span title={reason}>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => setVoidOpen(true)}
          aria-label="Estornar pagamento"
        >
          <Ban className="mr-1 h-3.5 w-3.5" />
          Estornar
        </Button>
      </span>
      <EditPaymentDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        payment={payment}
        onChanged={onChanged}
      />
      <VoidPaymentDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        payment={payment}
        onChanged={onChanged}
      />
    </div>
  )
}

interface DialogProps extends PaymentCorrectionsProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function EditPaymentDialog({ open, onOpenChange, payment, onChanged }: DialogProps) {
  const [date, setDate] = useState<Date>(parseDay(payment.payment_date))
  const [method, setMethod] = useState<string>(payment.payment_method)
  const [reference, setReference] = useState(payment.reference_number ?? '')
  const [notes, setNotes] = useState(payment.notes ?? '')
  const [amount, setAmount] = useState(String(payment.amount))
  const [saving, setSaving] = useState(false)
  // Um ID de requisição por diálogo aberto, para que um envio duplicado ou uma nova tentativa após
  // uma falha de rede repita a mesma correção, sem aplicá-la novamente.
  const requestId = useRef<string | null>(null)

  async function save() {
    const parsedAmount = Number(amount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast.error('O valor deve ser maior que zero.')
      return
    }

    setSaving(true)
    try {
      const result = await updatePaymentAction(
        payment.id,
        {
          payment_date: toISODate(date),
          method,
          notes: notes.trim() || null,
          reference_number: reference.trim() || null,
          amount: parsedAmount,
        },
        (requestId.current ??= crypto.randomUUID()),
      )

      if ('error' in result) {
        toast.error(result.error)
        return
      }

      toast.success('Pagamento atualizado')
      onOpenChange(false)
      await onChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar pagamento</DialogTitle>
          <DialogDescription>
            Corrige o que foi registrado. O total pago, o saldo e o status da fatura são recalculados com base
            nos pagamentos que permanecem ativos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Data do pagamento</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(date, 'PPP', { locale: ptBR })}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={date} onSelect={(d) => d && setDate(d)} />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label htmlFor="payment-amount">Valor total</Label>
            <Input
              id="payment-amount"
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Método</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione uma forma de pagamento" />
              </SelectTrigger>
              <SelectContent>
                {EDITABLE_METHODS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="payment-reference">Referência</Label>
            <Input
              id="payment-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Número do cheque ou da transação"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="payment-notes">Observações</Label>
            <Textarea id="payment-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar alterações'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function VoidPaymentDialog({ open, onOpenChange, payment, onChanged }: DialogProps) {
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const requestId = useRef<string | null>(null)

  async function submit() {
    if (!reason.trim()) {
      toast.error('Informe o motivo do estorno deste pagamento.')
      return
    }
    if (!confirmed) {
      setConfirmed(true)
      return
    }

    setSaving(true)
    try {
      const result = await voidPaymentAction(
        payment.id,
        reason.trim(),
        (requestId.current ??= crypto.randomUUID()),
      )

      if ('error' in result) {
        toast.error(result.error)
        return
      }

      toast.success('Pagamento estornado')
      onOpenChange(false)
      await onChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setConfirmed(false)
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Estornar este pagamento</DialogTitle>
          <DialogDescription>
            O pagamento permanece no histórico, riscado e acompanhado do motivo, mas deixa de contar como
            recebimento. A fatura reabre com esse valor, que também deixa de integrar os totais e relatórios.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="void-reason">Motivo</Label>
          <Textarea
            id="void-reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              setConfirmed(false)
            }}
            rows={3}
            placeholder="Registrado em duplicidade, fatura incorreta, valor não recebido..."
          />
        </div>

        {confirmed && (
          <p className="text-sm font-medium text-destructive">
            O estorno reabre o saldo desta fatura. Pressione Estornar pagamento novamente para confirmar.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={submit} disabled={saving}>
            {saving ? 'Estornando...' : confirmed ? 'Sim, estornar pagamento' : 'Estornar pagamento'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
