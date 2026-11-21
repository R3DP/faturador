import { describe, expect, it } from 'vitest'
import {
  buildDefaultSendMessage,
  buildSendSuccessMessage,
  getSendDocumentCopy,
} from '@/lib/invoices/send-document-copy'

describe('copy do envio de documentos', () => {
  it('usa substantivo e concordância femininos para fatura', () => {
    const copy = getSendDocumentCopy('invoice')
    const message = buildDefaultSendMessage('invoice', 'R3DP', 'F-1', 'R$ 10,00', '20 de novembro')

    expect(message).toContain('Segue sua fatura de R3DP.')
    expect(message).toContain('Você pode consultar a fatura')
    expect(copy.failureMessage).toBe('Falha ao enviar a fatura')
    expect(buildSendSuccessMessage('invoice', 'F-1', 'cliente@example.test'))
      .toBe('Fatura F-1 enviada para cliente@example.test')
  })

  it('usa substantivo e concordância masculinos para orçamento', () => {
    const copy = getSendDocumentCopy('estimate')
    const message = buildDefaultSendMessage('estimate', 'R3DP', 'O-1', 'R$ 10,00', '20 de novembro')

    expect(message).toContain('Segue seu orçamento de R3DP.')
    expect(message).toContain('Você pode consultar o orçamento')
    expect(copy.failureMessage).toBe('Falha ao enviar o orçamento')
    expect(buildSendSuccessMessage('estimate', 'O-1', 'cliente@example.test'))
      .toBe('Orçamento O-1 enviado para cliente@example.test')
  })
})
