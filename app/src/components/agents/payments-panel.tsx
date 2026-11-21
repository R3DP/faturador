'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, Loader2 } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { getStripeSetupAction, type StripeSetupView } from '@/lib/actions/stripe-setup'
import { STRIPE_WEBHOOK_EVENTS } from '@/lib/stripe/webhook-events'

/**
 * Os pagamentos com cartão usam a conta Stripe cujas chaves estão configuradas nesta
 * instalação. Este painel informa se estão ativados e, caso não estejam, o que
 * deve ser configurado. Ele nunca exibe o valor de uma chave.
 */
export function PaymentsPanel() {
  const [setup, setSetup] = useState<StripeSetupView | null | undefined>(undefined)

  useEffect(() => {
    let active = true
    getStripeSetupAction()
      .then((value) => {
        if (active) setSetup(value)
      })
      .catch(() => {
        if (active) setSetup(null)
      })
    return () => {
      active = false
    }
  }, [])

  if (setup === undefined) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (setup === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Não foi possível ler as configurações de pagamento. Recarregue a página para tentar novamente.
      </p>
    )
  }

  const forwardTo = setup.webhookUrl.replace(/^https?:\/\//, '')

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pagamentos com cartão</CardTitle>
        <CardDescription>
          Os clientes pagam faturas com cartão na página da fatura. O dinheiro vai para a conta Stripe
          cujas chaves estão configuradas neste Faturador, e todas as empresas aqui usam
          essa mesma conta.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {setup.configured ? (
          <div className="flex items-start gap-3 rounded-lg bg-green-50 p-4 text-green-800">
            <CheckCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">Pagamentos com cartão ativados</p>
              <p>
                {setup.mode === 'test'
                  ? 'Modo de teste: use cartões de teste da Stripe. Nenhum dinheiro real será movimentado.'
                  : 'Modo de produção: os clientes pagam valores reais na sua conta Stripe.'}
              </p>
              <p>
                Endpoint de webhook: <code className="break-all">{setup.webhookUrl}</code>
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3 rounded-lg bg-amber-50 p-4 text-amber-900">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">Pagamentos com cartão desativados</p>
                <p>{setup.problem ?? `Não configurado: ${setup.missing.join(', ')}.`}</p>
              </div>
            </div>
            <ol className="list-decimal space-y-3 pl-5">
              <li>
                No painel da Stripe, abra <strong>Desenvolvedores (Developers)</strong> e depois <strong>Chaves de API</strong>. Copie a chave publicável (<code>pk_...</code>) e
                a chave secreta (<code>sk_...</code>). Comece pelas chaves de teste.
              </li>
              <li>
                Abra <strong>Desenvolvedores (Developers)</strong>, depois <strong>Webhooks</strong> e adicione um
                endpoint em <code className="break-all">{setup.webhookUrl}</code> que envie{' '}
                {STRIPE_WEBHOOK_EVENTS.map((type, index) => (
                  <span key={type}>
                    {index > 0 ? ', ' : ''}
                    <code>{type}</code>
                  </span>
                ))}
                . Copie o segredo de assinatura (<code>whsec_...</code>). Se estiver executando o Faturador no seu próprio computador, o comando <code>stripe listen --forward-to {forwardTo}</code> exibirá um segredo de assinatura
                para usar no lugar.
              </li>
              <li>
                Configure <code>STRIPE_SECRET_KEY</code>, <code>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code>{' '}
                e <code>STRIPE_WEBHOOK_SECRET</code> em <code>app/.env.local</code> (ou no ambiente do servidor) e reinicie o Faturador. Ao reconstruir uma imagem Docker, a chave publicável será incorporada ao código do navegador.
              </li>
            </ol>
          </>
        )}
        <p className="text-muted-foreground">
          Sem pagamentos com cartão, você ainda pode registrar pagamentos manualmente em qualquer fatura.
        </p>
      </CardContent>
    </Card>
  )
}
