/**
 * Único local em que o assunto de um e-mail de fatura ou orçamento é montado.
 *
 * O assunto vai para um cabeçalho de e-mail. O Resend é uma API HTTPS JSON,
 * então CR ou LF
 * neste campo não vira um segundo cabeçalho como aconteceria com um cliente
 * SMTP direto. Ainda assim, a garantia pertence à função que monta o cabeçalho
 * e não ao transporte usado hoje. O
 * assunto é sanitizado aqui, em um só lugar, antes de chegar ao transporte.
 *
 * Três regras, nesta ordem:
 *   1. CR, LF e qualquer outro caractere de controle C0/C7f viram espaço;
 *      quem chama não pode iniciar outra linha de cabeçalho nem ocultar texto de um registro;
 *   2. sequências de espaços em branco são reduzidas e o resultado é aparado;
 *   3. o resultado tem tamanho limitado. A RFC 5322 recomenda que linhas de cabeçalho sem quebras fiquem
 *      abaixo de 998 octetos; 200 caracteres está bem abaixo disso e já é
 *      maior que qualquer assunto gerado pelo produto.
 */
export const MAX_SUBJECT_LENGTH = 200

export function safeSubject(value: string | null | undefined, fallback: string): string {
  const cleaned = (value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SUBJECT_LENGTH)
  if (cleaned) return cleaned
  // O valor alternativo é montado por esta base de código, mas inclui o nome
  // de uma empresa; por isso, passa pela mesma limpeza, sem atalhos.
  const safeFallback = fallback
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SUBJECT_LENGTH)
  return safeFallback || 'Faturador'
}
