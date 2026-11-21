import { describe, expect, it } from 'vitest'
import { formatHours, formatMoney, formatMoneyCompact, formatPercent } from '@/lib/reports/money'

describe('formatadores monetários de relatórios', () => {
  it('formata BRL com agrupamento e decimais pt-BR', () => {
    expect(formatMoney(1234.56, 'BRL')).toBe('R$\u00a01.234,56')
  })

  it('formata moeda compacta em pt-BR', () => {
    expect(formatMoneyCompact(1234.56, 'BRL')).toBe('R$\u00a01,2\u00a0mil')
  })

  it('formata horas com separadores pt-BR e preserva o sufixo', () => {
    expect(formatHours(1234.5)).toBe('1.234,5h')
  })

  it('usa vírgula decimal em pontos percentuais e preserva a precisão', () => {
    expect(formatPercent(12.345, 2)).toBe('12,35%')
    expect(formatPercent(12.345, 1)).toBe('12,3%')
  })

  it('mantém fallback pt-BR para moeda inválida', () => {
    expect(formatMoney(1234.56, 'INVALID')).toBe('1.234,56 INVALID')
    expect(formatMoneyCompact(1234.56, 'INVALID')).toBe('1.235 INVALID')
  })
})
