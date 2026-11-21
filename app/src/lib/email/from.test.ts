import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatFromAddress, invoiceFromEmail } from './from'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('invoiceFromEmail', () => {
  it('usa RESEND_INVOICE_FROM', () => {
    vi.stubEnv('RESEND_INVOICE_FROM', ' invoices@fieldstone.example ')
    expect(invoiceFromEmail()).toBe('invoices@fieldstone.example')
  })

  it('não tenta adivinhar o remetente quando nenhum está configurado', () => {
    vi.stubEnv('RESEND_INVOICE_FROM', '')
    expect(() => invoiceFromEmail()).toThrow('RESEND_INVOICE_FROM')
  })
})

describe('formatFromAddress', () => {
  it('envolve o endereço com um nome de exibição', () => {
    expect(formatFromAddress('Fieldstone Digital', 'invoices@fieldstone.example')).toBe(
      'Fieldstone Digital <invoices@fieldstone.example>',
    )
  })

  it('remove caracteres que poderiam injetar cabeçalhos', () => {
    expect(formatFromAddress('Malicioso\r\nBcc: x', 'a@b.example')).toBe('MaliciosoBcc: x <a@b.example>')
  })
})
