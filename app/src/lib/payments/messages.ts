/**
 * As mensagens exibidas quando uma gravação de pagamento é recusada.
 *
 * Antes, elas ficavam no diálogo de correções, o que funcionava enquanto o
 * navegador chamava as RPCs diretamente. Agora as gravações são executadas em
 * ações de servidor (src/lib/actions/payments.ts), então a ação transforma o
 * erro do Postgres em uma mensagem compreensível e o diálogo apenas a exibe.
 * Este módulo é TypeScript simples para permitir a importação pelos dois lados:
 * um arquivo 'use server' só pode exportar funções assíncronas, e um arquivo
 * 'use client' não deve ser incluído no pacote do servidor.
 */

export const STRIPE_LOCKED_MESSAGE =
  'Recebido pelo Stripe. Pagamentos com cartão não podem ser editados nem estornados aqui. Reembolse a cobrança no Stripe; o reembolso será registrado como um lançamento separado.'

/** Converte um erro do Postgres das RPCs de pagamento em uma mensagem útil. */
export function correctionMessage(message: string, fallback: string): string {
  if (message.includes('stripe_payment_locked')) return STRIPE_LOCKED_MESSAGE
  if (message.includes('payment_already_voided')) return 'Este pagamento já foi estornado.'
  if (message.includes('amount_exceeds_invoice_total'))
    return 'Esse valor faria a soma da fatura ultrapassar o total, considerando os outros pagamentos.'
  if (message.includes('request_id_reused')) return 'Essa correção já foi salva com valores diferentes.'
  if (message.includes('void_reason_required')) return 'Informe o motivo do estorno deste pagamento.'
  if (message.includes('invalid_amount')) return 'O valor deve ser maior que zero.'
  if (message.includes('payment_not_found')) return 'Esse pagamento não foi encontrado.'
  return fallback
}
