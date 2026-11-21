import { describe, it, expect } from 'vitest'
import { periodRange, sumBy, topClients, summarizeByCurrency, type SummaryRow } from './info'

// Ponto de referência fixo para manter determinísticos os limites dos períodos:
// 15/03/2026 fica no meio do mês e do ano; o mês anterior (fevereiro de 2026)
// tem 28 dias, pois não é ano bissexto.
const NOW = new Date(2026, 2, 15, 12, 0, 0)

function row(overrides: Partial<SummaryRow> = {}): SummaryRow {
  return {
    status: 'sent',
    total: 0,
    amount_paid: 0,
    balance_due: 0,
    currency: 'USD',
    due_date: '2099-01-01',
    client_id: null,
    ...overrides,
  }
}

describe('periodRange', () => {
  it('this_month abrange do primeiro ao último dia do mês atual', () => {
    expect(periodRange('this_month', NOW)).toEqual({ start: '2026-03-01', end: '2026-03-31' })
  })

  it('last_month abrange o mês anterior, respeitando sua duração real', () => {
    expect(periodRange('last_month', NOW)).toEqual({ start: '2026-02-01', end: '2026-02-28' })
  })

  it('this_year abrange de 1º de janeiro a 31 de dezembro', () => {
    expect(periodRange('this_year', NOW)).toEqual({ start: '2026-01-01', end: '2026-12-31' })
  })

  it('all não aplica filtro de data', () => {
    expect(periodRange('all', NOW)).toBeNull()
  })

  it('trata o primeiro dia do mês sem recuar para o mês anterior', () => {
    const firstOfMarch = new Date(2026, 2, 1, 0, 0, 0)
    expect(periodRange('this_month', firstOfMarch)).toEqual({ start: '2026-03-01', end: '2026-03-31' })
    expect(periodRange('last_month', firstOfMarch)).toEqual({ start: '2026-02-01', end: '2026-02-28' })
  })

  it('trata o último dia do ano sem avançar para o ano seguinte', () => {
    const newYearsEve = new Date(2026, 11, 31, 23, 0, 0)
    expect(periodRange('this_month', newYearsEve)).toEqual({ start: '2026-12-01', end: '2026-12-31' })
    expect(periodRange('last_month', newYearsEve)).toEqual({ start: '2026-11-01', end: '2026-11-30' })
    expect(periodRange('this_year', newYearsEve)).toEqual({ start: '2026-01-01', end: '2026-12-31' })
  })

  it('retrocede last_month para o ano anterior quando parte de janeiro', () => {
    const january = new Date(2026, 0, 10, 12, 0, 0)
    expect(periodRange('last_month', january)).toEqual({ start: '2025-12-01', end: '2025-12-31' })
  })

  it('retorna 29 de fevereiro em ano bissexto', () => {
    const leapMarch = new Date(2028, 2, 10, 12, 0, 0)
    expect(periodRange('last_month', leapMarch)).toEqual({ start: '2028-02-01', end: '2028-02-29' })
  })
})

describe('sumBy', () => {
  it('soma o campo monetário solicitado', () => {
    const rows = [row({ total: 10.5 }), row({ total: 4.25 })]
    expect(sumBy(rows, 'total')).toBe(14.75)
  })

  it('trata valores nulos como zero em vez de produzir NaN', () => {
    expect(sumBy([row({ total: null }), row({ total: 5 })], 'total')).toBe(5)
  })

  it('arredonda imprecisões de ponto flutuante para centavos', () => {
    const rows = [row({ balance_due: 0.1 }), row({ balance_due: 0.2 })]
    expect(sumBy(rows, 'balance_due')).toBe(0.3)
  })

  it('retorna 0 para um conjunto vazio', () => {
    expect(sumBy([], 'amount_paid')).toBe(0)
  })
})

describe('topClients', () => {
  it('soma por cliente e ordena pelo valor faturado em ordem decrescente', () => {
    const rows = [
      row({ client_id: 'a', total: 100, clients: { name: 'Acme' } }),
      row({ client_id: 'b', total: 300, clients: { name: 'Beta' } }),
      row({ client_id: 'a', total: 50, clients: { name: 'Acme' } }),
    ]
    expect(topClients(rows)).toEqual([
      { name: 'Beta', invoiced: 300 },
      { name: 'Acme', invoiced: 150 },
    ])
  })

  it('limita o resultado a 5 clientes', () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      row({ client_id: `c${i}`, total: i + 1, clients: { name: `Client ${i}` } })
    )
    const result = topClients(rows)
    expect(result).toHaveLength(5)
    expect(result.map((c) => c.name)).toEqual([
      'Client 7',
      'Client 6',
      'Client 5',
      'Client 4',
      'Client 3',
    ])
  })

  it('desempata pela primeira ocorrência (a ordenação é estável)', () => {
    const rows = [
      row({ client_id: 'a', total: 100, clients: { name: 'Acme' } }),
      row({ client_id: 'b', total: 100, clients: { name: 'Beta' } }),
      row({ client_id: 'c', total: 100, clients: { name: 'Gamma' } }),
    ]
    expect(topClients(rows).map((c) => c.name)).toEqual(['Acme', 'Beta', 'Gamma'])
  })

  it('ignora linhas sem client_id', () => {
    const rows = [row({ client_id: null, total: 999 }), row({ client_id: 'a', total: 1, clients: { name: 'Acme' } })]
    expect(topClients(rows)).toEqual([{ name: 'Acme', invoiced: 1 }])
  })

  it('identifica o cliente cujo nome não pôde ser associado', () => {
    expect(topClients([row({ client_id: 'a', total: 5, clients: null })])).toEqual([
      { name: 'Cliente desconhecido', invoiced: 5 },
    ])
  })

  it('retorna uma lista vazia quando não há linhas', () => {
    expect(topClients([])).toEqual([])
  })
})

describe('summarizeByCurrency', () => {
  it('nunca soma valores de moedas diferentes', () => {
    const rows = [
      row({ currency: 'USD', total: 100, amount_paid: 40, balance_due: 60 }),
      row({ currency: 'EUR', total: 200, amount_paid: 0, balance_due: 200 }),
      row({ currency: 'USD', total: 10, amount_paid: 10, balance_due: 0 }),
    ]
    const result = summarizeByCurrency(rows)
    expect(result.map((c) => c.currency)).toEqual(['USD', 'EUR'])
    expect(result[0]).toMatchObject({
      currency: 'USD',
      invoiced_total: 110,
      paid_total: 50,
      outstanding_total: 60,
    })
    expect(result[1]).toMatchObject({ currency: 'EUR', invoiced_total: 200, outstanding_total: 200 })
  })

  it('contabiliza em overdue_total apenas linhas vencidas com status sent/viewed/partial', () => {
    const rows = [
      row({ status: 'sent', due_date: '2000-01-01', balance_due: 30 }),
      row({ status: 'draft', due_date: '2000-01-01', balance_due: 70 }),
      row({ status: 'sent', due_date: '2099-01-01', balance_due: 500 }),
    ]
    // draft é filtrado antes por EXCLUDED_FROM_TOTALS, mas isOverdue
    // também não o contabiliza aqui; a linha com data futura não está vencida.
    expect(summarizeByCurrency(rows)[0].overdue_total).toBe(30)
  })

  it('retorna uma lista vazia quando não há linhas', () => {
    expect(summarizeByCurrency([])).toEqual([])
  })
})
