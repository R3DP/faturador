'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import type { StripeError } from '@stripe/stripe-js'
import { AlertCircle, CheckCircle2, CreditCard, Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { loadStripeJs } from '@/lib/stripe/stripe-js'

interface IntentResponse {
  client_secret: string
  publishable_key: string
  amount: number
  currency: string
}

type Phase =
  | { kind: 'loading' }
  /** O pagamento com cartão não está disponível; valem as instruções da própria fatura. */
  | { kind: 'unavailable'; message: string }
  /** A cobrança já foi processada e estamos aguardando o webhook. */
  | { kind: 'confirming' }
  | { kind: 'ready'; intent: IntentResponse }

const CARD_UNAVAILABLE =
  'O pagamento com cartão não está disponível para esta fatura. Siga as instruções de pagamento ou entre em contato com quem a enviou.'

interface InvoiceCheckoutProps {
  publicId: string
  balanceDue: number
  currency: string
  /** Chamado quando o webhook marcar a fatura como paga. */
  onConfirmed?: () => void
}

/**
 * Pagamento com cartão na página pública da fatura, usando a conta Stripe em que esta
 * instalação está configurada. Os dados do cartão vão direto do navegador
 * para a Stripe; o Faturador nunca os recebe.
 */
export function InvoiceCheckout({ publicId, balanceDue, currency, onConfirmed }: InvoiceCheckoutProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function createIntent() {
      try {
        const res = await fetch('/api/stripe/payment-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ public_id: publicId }),
        })
        const data = await res.json().catch(() => null)
        if (cancelled) return
        if (res.ok && data?.client_secret) {
          setPhase({ kind: 'ready', intent: data as IntentResponse })
          return
        }
        // Pagamento já realizado, mas o webhook ainda não chegou: manter o formulário ativo
        // poderia gerar cobranças duplicadas.
        if (res.status === 409 && data?.status === 'processing') {
          setPhase({ kind: 'confirming' })
          return
        }
        setPhase({
          kind: 'unavailable',
          message: typeof data?.error === 'string' ? data.error : CARD_UNAVAILABLE,
        })
      } catch {
        if (!cancelled) setPhase({ kind: 'unavailable', message: CARD_UNAVAILABLE })
      }
    }

    createIntent()
    return () => {
      cancelled = true
    }
  }, [publicId])

  const stripePromise = useMemo(
    () => (phase.kind === 'ready' ? loadStripeJs(phase.intent.publishable_key) : null),
    [phase],
  )

  if (phase.kind === 'loading') {
    return (
      <div className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando o formulário seguro de pagamento
      </div>
    )
  }

  if (phase.kind === 'confirming') {
    return <ConfirmingNotice publicId={publicId} onConfirmed={onConfirmed} />
  }

  if (phase.kind === 'unavailable') {
    return <p className="text-sm text-muted-foreground">{phase.message}</p>
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: phase.intent.client_secret,
        appearance: { theme: 'stripe', variables: { borderRadius: '8px' } },
      }}
    >
      <CheckoutForm
        publicId={publicId}
        balanceDue={balanceDue}
        currency={currency}
        onConfirmed={onConfirmed}
      />
    </Elements>
  )
}

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

function CheckoutForm({
  publicId,
  balanceDue,
  currency,
  onConfirmed,
}: InvoiceCheckoutProps) {
  const stripe = useStripe()
  const elements = useElements()
  const [ready, setReady] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [succeeded, setSucceeded] = useState(false)
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null)
  const [elementFailed, setElementFailed] = useState(false)

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      if (!stripe || !elements || submitting) return

      setSubmitting(true)
      setError(null)

      const result = await stripe
        .confirmPayment({
          elements,
          // Cartões e 3D Secure são processados na própria página (a Stripe exibe a
          // etapa de autenticação em uma janela). Somente formas de pagamento que
          // realmente exigem sair da página usarão return_url e, ao retornar,
          // abrirão a mesma fatura com o aviso de pagamento.
          redirect: 'if_required',
          confirmParams: {
            return_url: `${window.location.origin}/i/${publicId}?paid=1`,
          },
        })
        .catch((err: unknown) => {
          // confirmPayment falha apenas diante de um erro real de rede ou execução.
          return { error: { type: 'api_connection_error', message: String(err) } as StripeError }
        })

      if (result.error) {
        setSubmitting(false)
        setError(describeStripeError(result.error))
        return
      }

      const status = result.paymentIntent?.status
      if (status === 'succeeded' || status === 'processing' || status === 'requires_capture') {
        // O webhook é a fonte da verdade. Nunca marque a fatura como paga
        // aqui: mostre um estado otimista e aguarde a confirmação da reconciliação.
        setSucceeded(true)
        setSubmitting(false)
        return
      }

      setSubmitting(false)
      setError({
        message: 'O pagamento não foi concluído. Tente novamente ou use outro cartão.',
        retryable: true,
      })
    },
    [stripe, elements, submitting, publicId]
  )

  if (succeeded) {
    return <ConfirmingNotice publicId={publicId} onConfirmed={onConfirmed} />
  }

  if (elementFailed) {
    return <p className="text-sm text-muted-foreground">{CARD_UNAVAILABLE}</p>
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        onReady={() => setReady(true)}
        onLoadError={() => setElementFailed(true)}
        options={{ layout: 'tabs' }}
      />

      {error && (
        <div className="flex items-start gap-3 rounded-lg bg-red-50 p-3 text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <p className="text-sm">{error.message}</p>
            {!error.retryable && (
              <button
                type="button"
                className="text-sm font-medium underline"
                onClick={() => window.location.reload()}
              >
                Recarregar e tentar novamente
              </button>
            )}
          </div>
        </div>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={!stripe || !ready || submitting}>
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Processando pagamento
          </>
        ) : (
          <>
            <CreditCard className="mr-2 h-4 w-4" />
            Pagar{' '}
            {formatAmount(balanceDue, currency)}
          </>
        )}
      </Button>

      <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" />
        Os pagamentos são processados pela Stripe. O Faturador nunca vê os dados do seu cartão.
      </p>
    </form>
  )
}

/**
 * Converte erros da Stripe.js em mensagens úteis para quem paga. Recusas de cartão,
 * problemas de validação e falhas de conexão exigem respostas diferentes,
 * e as próprias mensagens de recusa da Stripe já são adequadas para o pagador.
 */
function describeStripeError(error: StripeError): { message: string; retryable: boolean } {
  switch (error.type) {
    case 'card_error':
      return {
        message:
          error.message ||
          'Seu cartão foi recusado. Confira os dados ou tente outro cartão.',
        retryable: true,
      }
    case 'validation_error':
      return { message: error.message || 'Confira os dados do pagamento.', retryable: true }
    case 'api_connection_error':
      return {
        message: 'Não foi possível conectar à Stripe. Confira sua conexão e tente novamente.',
        retryable: true,
      }
    default:
      return {
        message: error.message || 'Ocorreu um erro ao processar o pagamento.',
        retryable: false,
      }
  }
}

/**
 * Estado otimista após a cobrança. O dinheiro já foi movimentado, mas o Faturador não marcará
 * a fatura como paga até receber a confirmação do webhook; por isso consulta a página pública
 * da fatura até a reconciliação ocorrer, sem afirmar um pagamento que o
 * livro-razão ainda não registrou.
 */
function ConfirmingNotice({
  publicId,
  onConfirmed,
}: {
  publicId: string
  onConfirmed?: () => void
}) {
  const [confirmed, setConfirmed] = useState(false)
  const onConfirmedRef = useRef(onConfirmed)
  onConfirmedRef.current = onConfirmed

  useEffect(() => {
    let cancelled = false
    let attempts = 0

    async function poll() {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      while (!cancelled && attempts < 20) {
        attempts += 1
        await new Promise((resolve) => setTimeout(resolve, 3000))
        if (cancelled) return

        const { data } = await supabase.rpc('get_public_invoice', { p_public_id: publicId })
        const status = (data as { invoice?: { status?: string } } | null)?.invoice?.status
        if (status === 'paid') {
          if (!cancelled) {
            setConfirmed(true)
            onConfirmedRef.current?.()
          }
          return
        }
      }
    }

    poll()
    return () => {
      cancelled = true
    }
  }, [publicId])

  if (confirmed) {
    return (
      <div className="flex items-start gap-3 rounded-lg bg-green-50 p-4 text-green-800">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-medium">Pagamento confirmado</p>
          <p className="text-sm">Esta fatura está marcada como paga. Obrigado.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-3 rounded-lg bg-green-50 p-4 text-green-800">
      <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin" />
      <div>
        <p className="font-medium">Pagamento recebido, aguardando confirmação</p>
        <p className="text-sm">
          Seu cartão foi cobrado. Estamos aguardando a confirmação da Stripe, que normalmente leva
          alguns segundos. Você pode fechar esta página com segurança.
        </p>
      </div>
    </div>
  )
}
