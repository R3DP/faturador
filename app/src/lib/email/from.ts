/**
 * Remetente de e-mails de faturas e orçamentos: RESEND_INVOICE_FROM, um
 * endereço em um domínio verificado na sua própria conta do Resend.
 */
export function invoiceFromEmail(): string {
  const value = process.env.RESEND_INVOICE_FROM?.trim()
  if (!value)
    throw new Error(
      'Configure RESEND_INVOICE_FROM com um endereço em um domínio verificado no Resend',
    )
  return value
}

/**
 * Envolve um endereço com um nome de exibição, de forma preventiva.
 *
 * O nome de exibição aparece no cabeçalho From; portanto, CR, LF ou sinais
 * de menor/maior permitiriam que quem chama acrescentasse outros cabeçalhos.
 * Nenhum ponto de chamada atual passa texto não confiável, mas esta função
 * monta o cabeçalho, então é aqui que essa garantia deve ser assegurada.
 */
export function formatFromAddress(displayName: string, email: string): string {
  const name = displayName.replace(/[\r\n<>"]/g, '').trim()
  const address = email.replace(/[\r\n<>]/g, '').trim()
  if (!address) throw new Error('É necessário informar um endereço de e-mail remetente')
  return name ? `${name} <${address}>` : address
}
