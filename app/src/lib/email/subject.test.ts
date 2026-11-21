import { describe, expect, it } from 'vitest'
import { MAX_SUBJECT_LENGTH, safeSubject } from './subject'

const FALLBACK = 'Fatura INV-0001 de Fieldstone Digital'

describe('safeSubject', () => {
  it('mantém o assunto comum como foi escrito', () => {
    expect(safeSubject('Sua fatura de março', FALLBACK)).toBe('Sua fatura de março')
  })

  it('remove CR e LF para impedir que o assunto inicie outra linha de cabeçalho', () => {
    const injected = 'Fatura 1\r\nBcc: attacker@evil.example'
    const result = safeSubject(injected, FALLBACK)
    expect(result).not.toContain('\r')
    expect(result).not.toContain('\n')
    expect(result).toBe('Fatura 1 Bcc: attacker@evil.example')
  })

  it('remove outros caracteres de controle', () => {
    expect(safeSubject('Fatura\u00001\u0007 vencida\u007f', FALLBACK)).toBe('Fatura 1 vencida')
  })

  it('limita o comprimento', () => {
    const result = safeSubject('x'.repeat(5000), FALLBACK)
    expect(result).toHaveLength(MAX_SUBJECT_LENGTH)
  })

  it('usa o valor alternativo quando quem chama não envia nada utilizável', () => {
    expect(safeSubject(undefined, FALLBACK)).toBe(FALLBACK)
    expect(safeSubject('   ', FALLBACK)).toBe(FALLBACK)
    expect(safeSubject('\r\n\t', FALLBACK)).toBe(FALLBACK)
  })

  it('também limpa o valor alternativo, pois ele inclui o nome da empresa', () => {
    const result = safeSubject('', 'Fatura 1 de Conta Maliciosa\r\nBcc: attacker@evil.example')
    expect(result).toBe('Fatura 1 de Conta Maliciosa Bcc: attacker@evil.example')
  })

  it('nunca retorna um assunto vazio', () => {
    expect(safeSubject('', '\r\n')).toBe('Faturador')
  })
})
