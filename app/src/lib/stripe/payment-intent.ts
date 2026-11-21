import 'server-only'
import type Stripe from 'stripe'
import { amountToMinorUnits } from '@/lib/stripe/money'

export interface PaymentIntentInput {
  currency: string
  invoiceNumber: string
  /** Saldo devido determinado pelo servidor, em unidades principais da moeda. */
  balanceDue: number | string
  invoiceId: string
  businessId: string
  publicId: string
}

/**
 * Função pura que monta o PaymentIntent usado pelo Payment Element incorporado.
 * O valor é recalculado a partir da linha da fatura carregada pelo servidor,
 * usando o helper compartilhado amountToMinorUnits. Os metadados de fatura,
 * empresa e ID público são gravados no PaymentIntent (e, portanto, na cobrança),
 * para que os handlers payment_intent.succeeded, charge.refunded e
 * charge.dispute.created do webhook possam associá-lo à fatura.
 */
export function buildPaymentIntentParams(
  input: PaymentIntentInput
): Stripe.PaymentIntentCreateParams {
  const amount = amountToMinorUnits(input.balanceDue, input.currency)

  return {
    amount,
    currency: input.currency.toLowerCase(),
    description: `Invoice ${input.invoiceNumber}`,
    // Permite que os métodos de pagamento habilitados na conta Stripe (cartões,
    // carteiras digitais e débitos bancários) apareçam no Payment Element, sem
    // manter uma lista fixa no Faturador que poderia ficar desatualizada.
    automatic_payment_methods: { enabled: true },
    metadata: {
      invoice_id: input.invoiceId,
      business_id: input.businessId,
      public_id: input.publicId,
    },
  }
}

/**
 * Formato mínimo de um PaymentIntent já criado, necessário para decidir o que
 * fazer em uma nova visita à página da fatura.
 */
export interface ExistingPaymentIntent {
  status: Stripe.PaymentIntent.Status
  amount: number
  currency: string
}

export type PaymentIntentDecision = 'reuse' | 'update' | 'create' | 'already_paid'

/**
 * Indica se um intent já cobrou (ou está cobrando) o valor da pessoa pagadora;
 * oferecer outra forma de pagar esta fatura poderia gerar uma cobrança duplicada.
 * `processing` também conta: métodos assíncronos são concluídos depois, e a
 * fatura continua mostrando balance_due > 0 até a chegada do webhook.
 */
export function isIntentSettled(status: Stripe.PaymentIntent.Status): boolean {
  return status === 'succeeded' || status === 'processing' || status === 'requires_capture'
}

/**
 * Decide se o PaymentIntent existente da fatura pode ser reutilizado ao
 * recarregar a página, em vez de criar um intent novo toda vez que o formulário
 * de pagamento é montado (o que deixaria intents abandonados na conta Stripe e
 * faria o stripe_payment_intent_id da fatura - usado para associar estornos e
 * contestações - mudar sem necessidade).
 *
 * O caso importante é `already_paid`: se o intent já teve sucesso ou ainda
 * está em processamento, a chamada deve se recusar a fornecer qualquer segredo
 * de cliente. O webhook pode ainda não ter chegado, então a fatura pode continuar
 * mostrando balance_due > 0; sem esta verificação, uma pessoa que recarregasse a
 * página depois de pagar veria um formulário ativo e poderia ser cobrada outra vez.
 */
export function decidePaymentIntentReuse(
  existing: ExistingPaymentIntent | null,
  desiredAmount: number,
  desiredCurrency: string
): PaymentIntentDecision {
  if (!existing) return 'create'

  if (isIntentSettled(existing.status)) return 'already_paid'

  switch (existing.status) {
    case 'requires_payment_method':
    case 'requires_confirmation':
    case 'requires_action':
      break
    default:
      // canceled ou qualquer status futuro desconhecido: crie um novo intent,
      // em vez de tentar reutilizar o anterior.
      return 'create'
  }

  // A moeda de um intent não pode ser alterada depois de sua criação; uma
  // mudança de moeda exige um novo intent.
  if (existing.currency.toLowerCase() !== desiredCurrency.toLowerCase()) return 'create'
  if (existing.amount !== desiredAmount) return 'update'
  return 'reuse'
}
