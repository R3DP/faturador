import { describe, it, expect } from 'vitest'
import { csvFilename, escapeCsvValue, toCsv, withReportContext } from '@/lib/reports/csv'

describe('escapeCsvValue', () => {
  it('coloca entre aspas valores com vírgulas, aspas ou quebras de linha', () => {
    expect(escapeCsvValue('Acme, Inc')).toBe('"Acme, Inc"')
    expect(escapeCsvValue('He said "hi"')).toBe('"He said ""hi"""')
    expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"')
  })
  it('neutraliza injeção de fórmulas em planilhas', () => {
    expect(escapeCsvValue('=1+1')).toBe("'=1+1")
    expect(escapeCsvValue('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(escapeCsvValue('-5 Ltd')).toBe("'-5 Ltd")
  })
  it('gera campo vazio para null e undefined e mantém os números', () => {
    expect(escapeCsvValue(null)).toBe('')
    expect(escapeCsvValue(undefined)).toBe('')
    expect(escapeCsvValue(1234.5)).toBe('1234.5')
  })
})

describe('toCsv', () => {
  it('gera uma linha de cabeçalho e uma linha por registro', () => {
    const csv = toCsv(
      [
        { name: 'Acme', amount: 100 },
        { name: 'Globex, Ltd', amount: 250.5 },
      ],
      [
        { header: 'Client', value: (r) => r.name },
        { header: 'Amount', value: (r) => r.amount },
      ]
    )
    expect(csv.split('\n')).toEqual(['Client,Amount', 'Acme,100', '"Globex, Ltd",250.5'])
  })
  it('gera somente o cabeçalho quando o relatório está vazio', () => {
    expect(toCsv([], [{ header: 'Client', value: () => '' }])).toBe('Client')
  })
})

describe('withReportContext', () => {
  it('indica no início o conteúdo abrangido pela exportação', () => {
    const out = withReportContext('A,B\n1,2', {
      title: 'AR aging',
      range: { start: '2026-01-01', end: '2026-03-31' },
      currency: 'USD',
    })
    expect(out.split('\n')[0]).toBe('AR aging,1 de jan. a 31 de mar. de 2026,Valores em USD')
    expect(out).toContain('A,B\n1,2')
  })
})

describe('csvFilename', () => {
  it('gera um nome seguro para o sistema de arquivos que inclui o intervalo', () => {
    expect(csvFilename('AR Aging', { start: '2026-01-01', end: '2026-03-31' })).toBe(
      'billr-ar-aging-2026-01-01-to-2026-03-31.csv'
    )
  })
})
