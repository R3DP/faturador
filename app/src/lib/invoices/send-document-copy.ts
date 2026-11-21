export type SendDocumentKind = 'invoice' | 'estimate'

const DOCUMENT_COPY = {
  invoice: {
    label: 'Fatura',
    noun: 'fatura',
    article: 'a',
    possessive: 'sua',
    successParticiple: 'enviada',
    failureMessage: 'Falha ao enviar a fatura',
    amountLabel: 'Valor devido',
    dateLabel: 'Vencimento',
    datePrefix: 'Vence em',
    detailsPhrase: 'da fatura',
  },
  estimate: {
    label: 'Orçamento',
    noun: 'orçamento',
    article: 'o',
    possessive: 'seu',
    successParticiple: 'enviado',
    failureMessage: 'Falha ao enviar o orçamento',
    amountLabel: 'Valor total',
    dateLabel: 'Validade',
    datePrefix: 'Válido até',
    detailsPhrase: 'do orçamento',
  },
} as const satisfies Record<SendDocumentKind, {
  label: string
  noun: string
  article: string
  possessive: string
  successParticiple: string
  failureMessage: string
  amountLabel: string
  dateLabel: string
  datePrefix: string
  detailsPhrase: string
}>

export function getSendDocumentCopy(kind: SendDocumentKind) {
  return DOCUMENT_COPY[kind]
}

export function buildDefaultSendMessage(
  kind: SendDocumentKind,
  businessName: string,
  documentNumber: string,
  formattedAmount: string,
  formattedDate: string,
) {
  const copy = getSendDocumentCopy(kind)

  return 'Olá,\n\nSegue ' + copy.possessive + ' ' + copy.noun + ' de ' + businessName + '.' +
    '\n\n' + copy.label + ': ' + documentNumber + '\n' + copy.amountLabel + ': ' + formattedAmount +
    '\n' + copy.dateLabel + ': ' + formattedDate + '\n\nVocê pode consultar ' + copy.article + ' ' +
    copy.noun + ' e todos os detalhes pelo botão abaixo.\n\nObrigado!'
}

export function buildSendSuccessMessage(kind: SendDocumentKind, documentNumber: string, recipient: string) {
  const copy = getSendDocumentCopy(kind)
  return copy.label + ' ' + documentNumber + ' ' + copy.successParticiple + ' para ' + recipient
}
