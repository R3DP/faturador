'use client'

import { useEffect, useState, useRef } from 'react'
import { toast } from 'sonner'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { sendInvoiceAction, sendEstimateAction } from '@/lib/actions/send-invoice'
import {
  buildDefaultSendMessage,
  buildSendSuccessMessage,
  getSendDocumentCopy,
} from '@/lib/invoices/send-document-copy'
import { parseDay } from '@/lib/dates'

interface SendInvoiceDialogProps {
  kind?: 'invoice' | 'estimate'
  open: boolean
  onOpenChange: (open: boolean) => void
  invoiceId: string
  invoiceNumber: string
  defaultEmail: string | null
  businessName: string
  amountDue: number
  currency: string
  dueDate: string
  primaryColor?: string | null
  onSent?: () => void
}

const formatCurrency = (amount: number, currency = 'USD') =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount)

const formatDate = (date: string) =>
  parseDay(date).toLocaleDateString('pt-BR', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

export function SendInvoiceDialog({
  kind = 'invoice',
  open,
  onOpenChange,
  invoiceId,
  invoiceNumber,
  defaultEmail,
  businessName,
  amountDue,
  currency,
  dueDate,
  primaryColor,
  onSent,
}: SendInvoiceDialogProps) {
  const copy = getSendDocumentCopy(kind)
  const label = copy.label
  const defaultSubject = `${label} ${invoiceNumber} - ${businessName}`
  const defaultMessage = buildDefaultSendMessage(
    kind,
    businessName,
    invoiceNumber,
    formatCurrency(amountDue, currency),
    formatDate(dueDate),
  )

  const [to, setTo] = useState(defaultEmail || '')
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
  const [subject, setSubject] = useState(defaultSubject)
  const [message, setMessage] = useState(defaultMessage)
  const [isSending, setIsSending] = useState(false)

  // Preencher novamente sempre que o diálogo abrir para uma fatura (possivelmente diferente)
  useEffect(() => {
    if (open) {
      setTo(defaultEmail || '')
      setSubject(defaultSubject)
      setMessage(defaultMessage)
      setCc('')
      setBcc('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoiceId])

  const deliveryRequest = useRef<{input:string;id:string} | null>(null)
  const handleSend = async () => {
    setIsSending(true)
    try {
      const send = kind === 'invoice' ? sendInvoiceAction : sendEstimateAction
      const input = JSON.stringify({to,cc,bcc,subject,message})
      if (!deliveryRequest.current || deliveryRequest.current.input !== input) deliveryRequest.current = {input,id:crypto.randomUUID()}
      const result = await send(invoiceId, {
        requestId: deliveryRequest.current.id,
        to: to.trim(),
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        subject: subject.trim() || undefined,
        message: message.trim() || undefined,
      })
      if (result.success) {
        toast.success(buildSendSuccessMessage(kind, invoiceNumber, result.to ?? to.trim()))
        onOpenChange(false)
        onSent?.()
      } else {
        toast.error(result.error || copy.failureMessage)
      }
    } catch {
      toast.error(copy.failureMessage)
    } finally {
      setIsSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar {invoiceNumber}</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="compose">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="compose">Redigir</TabsTrigger>
            <TabsTrigger value="preview">Pré-visualizar</TabsTrigger>
          </TabsList>
          <TabsContent value="compose" className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="send-to">Para</Label>
              <Input
                id="send-to"
                type="email"
                placeholder="client@example.com"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="send-cc">Cc</Label>
                <Input
                  id="send-cc"
                  placeholder="Opcional, separado por vírgulas"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="send-bcc">Cco</Label>
                <Input
                  id="send-bcc"
                  placeholder="Opcional, separado por vírgulas"
                  value={bcc}
                  onChange={(e) => setBcc(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="send-subject">Assunto</Label>
              <Input
                id="send-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="send-message">Mensagem</Label>
              <Textarea
                id="send-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={7}
                className="font-mono text-sm"
              />
            </div>
          </TabsContent>
          <TabsContent value="preview" className="pt-2">
            <div className="max-h-[420px] overflow-y-auto rounded-lg border bg-muted/40 p-4">
              <div className="mx-auto max-w-md rounded-xl bg-background p-6 shadow-sm">
                <h2 className="text-lg font-bold">{businessName}</h2>
                <p className="mb-4 text-sm text-muted-foreground">
                  {label} {invoiceNumber}
                </p>
                {message && (
                  <p className="mb-4 whitespace-pre-wrap text-sm">{message}</p>
                )}
                <div className="mb-4 rounded-lg bg-muted p-4">
                  <p className="text-xs text-muted-foreground">{copy.amountLabel}</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(amountDue, currency)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {copy.datePrefix} {formatDate(dueDate)}
                  </p>
                </div>
                <div
                  className="rounded-lg p-3 text-center text-sm font-semibold text-white"
                  style={{ backgroundColor: primaryColor || '#2563eb' }}
                >
                  Visualizar {copy.article} {copy.noun}
                </div>
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  Enviado pelo Faturador
                </p>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              O e-mail também inclui os itens {copy.detailsPhrase} abaixo do valor.
            </p>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSending}
          >
            Cancelar
          </Button>
          <Button onClick={handleSend} disabled={isSending || !to.trim()}>
            <Send className="mr-2 h-4 w-4" />
            {isSending ? 'Enviando...' : `Enviar ${label}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
