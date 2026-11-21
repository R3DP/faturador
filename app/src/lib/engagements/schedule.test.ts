import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SCHEDULE_TEMPLATES,
  ScheduleError,
  expandSchedule,
  expandTemplate,
  type ScheduleEntry,
} from './schedule'

/**
 * CASOS COMPARTILHADOS.
 *
 * Cada caso em SPLIT_CASES é verificado duas vezes: aqui, contra a expansão
 * TypeScript usada na prévia da interface, e em supabase/tests/engagements.sql,
 * contra expand_engagement_schedule(), que grava as linhas de fato. As duas
 * listas são mantidas literalmente idênticas, caso a caso e centavo a centavo,
 * porque a prévia precisa refletir exatamente o que o banco de dados fará.
 */
const SPLIT_CASES: {
  name: string
  mode: 'percent_split' | 'equal_installments'
  total: number
  percents?: number[]
  count?: number
  expected: number[]
}[] = [
  { name: '50/50 de 1000', mode: 'percent_split', total: 1000, percents: [50, 50], expected: [500, 500] },
  {
    name: '30/70 de 999.99 arredonda para cima e deixa o último item absorver o saldo',
    mode: 'percent_split',
    total: 999.99,
    percents: [30, 70],
    expected: [300, 699.99],
  },
  {
    name: 'terços de 100 em percentuais',
    mode: 'percent_split',
    total: 100,
    percents: [33.33, 33.33, 33.34],
    expected: [33.33, 33.33, 33.34],
  },
  { name: '3 parcelas iguais de 100', mode: 'equal_installments', total: 100, count: 3, expected: [33.33, 33.33, 33.34] },
  {
    name: '3 parcelas iguais de 1000',
    mode: 'equal_installments',
    total: 1000,
    count: 3,
    expected: [333.33, 333.33, 333.34],
  },
  {
    name: '7 parcelas iguais de 100',
    mode: 'equal_installments',
    total: 100,
    count: 7,
    expected: [14.29, 14.29, 14.29, 14.29, 14.29, 14.29, 14.26],
  },
  {
    name: '10 parcelas iguais de 1000.05 arredondam cada meio centavo para cima',
    mode: 'equal_installments',
    total: 1000.05,
    count: 10,
    expected: [100.01, 100.01, 100.01, 100.01, 100.01, 100.01, 100.01, 100.01, 100.01, 99.96],
  },
  {
    name: '10 parcelas iguais de 0.1 deixam o saldo no último item',
    mode: 'equal_installments',
    total: 0.1,
    count: 10,
    expected: [0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01],
  },
]

function amounts(entries: ScheduleEntry[]): number[] {
  return entries.map((entry) => entry.amount)
}

function sum(values: number[]): number {
  return Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100
}

describe('expansão do cronograma', () => {
  for (const testCase of SPLIT_CASES) {
    it(`divide: ${testCase.name}`, () => {
      const entries = expandSchedule({
        billing_mode: testCase.mode,
        total: testCase.total,
        entries: testCase.percents?.map((percent) => ({ percent })) ?? null,
        installments: testCase.count ?? null,
      })

      expect(amounts(entries)).toEqual(testCase.expected)
      expect(sum(amounts(entries))).toBe(testCase.total)
    })
  }

  it('numera as posições a partir de zero, na ordem informada', () => {
    const entries = expandSchedule({
      billing_mode: 'equal_installments',
      total: 300,
      installments: 3,
    })
    expect(entries.map((entry) => entry.position)).toEqual([0, 1, 2])
  })

  it('mantém os percentuais informados em uma divisão percentual', () => {
    const entries = expandSchedule({
      billing_mode: 'percent_split',
      total: 1000,
      entries: [{ percent: 30 }, { percent: 70 }],
    })
    expect(entries.map((entry) => entry.percent)).toEqual([30, 70])
  })

  it('deixa o percentual vazio quando a divisão não foi especificada em percentuais', () => {
    const entries = expandSchedule({ billing_mode: 'equal_installments', total: 300, installments: 3 })
    expect(entries.map((entry) => entry.percent)).toEqual([null, null, null])
  })

  it('define por padrão as regras de vencimento como início, etapas e conclusão', () => {
    const entries = expandSchedule({ billing_mode: 'equal_installments', total: 400, installments: 4 })
    expect(entries.map((entry) => entry.due_rule)).toEqual([
      'on_start',
      'on_milestone',
      'on_milestone',
      'on_complete',
    ])
  })

  it('define a conclusão como padrão para um único item', () => {
    const entries = expandSchedule({ billing_mode: 'milestones', total: 400, entries: [{ amount: 400 }] })
    expect(entries[0].due_rule).toBe('on_complete')
  })

  it('mantém cada item de um contrato manual aguardando uma pessoa', () => {
    const entries = expandSchedule({
      billing_mode: 'manual',
      total: 400,
      entries: [{ amount: 100 }, { amount: 300 }],
    })
    expect(entries.map((entry) => entry.due_rule)).toEqual(['manual', 'manual'])
  })

  it('mantém a regra de vencimento e a data informadas explicitamente', () => {
    const entries = expandSchedule({
      billing_mode: 'milestones',
      total: 400,
      entries: [
        { amount: 100, due_rule: 'on_date', due_on: '2026-10-01' },
        { amount: 300, due_rule: 'manual' },
      ],
    })
    expect(entries[0].due_rule).toBe('on_date')
    expect(entries[0].due_on).toBe('2026-10-01')
    expect(entries[1].due_on).toBeNull()
  })

  it('remove a data de um item que não vence em uma data específica', () => {
    const entries = expandSchedule({
      billing_mode: 'milestones',
      total: 100,
      entries: [{ amount: 100, due_rule: 'on_complete', due_on: '2026-10-01' }],
    })
    expect(entries[0].due_on).toBeNull()
  })

  it('define nomes para itens sem rótulo', () => {
    const entries = expandSchedule({ billing_mode: 'equal_installments', total: 200, installments: 2 })
    expect(entries.map((entry) => entry.label)).toEqual(['Parcela 1 de 2', 'Parcela 2 de 2'])
  })

  it('mantém os rótulos informados', () => {
    const entries = expandSchedule({
      billing_mode: 'percent_split',
      total: 200,
      entries: [
        { label: 'Entrada', percent: 50 },
        { label: 'Na conclusão', percent: 50 },
      ],
    })
    expect(entries.map((entry) => entry.label)).toEqual(['Entrada', 'Na conclusão'])
  })
})

describe('recusas da expansão do cronograma', () => {
  const cases: { name: string; code: string; input: Parameters<typeof expandSchedule>[0] }[] = [
    {
      name: 'percentuais cuja soma não chega a 100',
      code: 'percent_must_total_100',
      input: { billing_mode: 'percent_split', total: 1000, entries: [{ percent: 30 }, { percent: 60 }] },
    },
    {
      name: 'divisão percentual com item sem percentual',
      code: 'invalid_percent',
      input: { billing_mode: 'percent_split', total: 1000, entries: [{ percent: 100 }, {}] },
    },
    {
      name: 'valores das etapas cuja soma não corresponde ao total',
      code: 'entries_must_total_engagement',
      input: { billing_mode: 'milestones', total: 10000, entries: [{ amount: 2500 }, { amount: 2500 }] },
    },
    {
      name: 'etapa sem valor',
      code: 'entry_amount_required',
      input: { billing_mode: 'milestones', total: 100, entries: [{ label: 'Início' }] },
    },
    {
      name: 'total igual a zero',
      code: 'invalid_total',
      input: { billing_mode: 'equal_installments', total: 0, installments: 2 },
    },
    {
      name: 'total negativo',
      code: 'invalid_total',
      input: { billing_mode: 'equal_installments', total: -100, installments: 2 },
    },
    {
      name: 'nenhuma quantidade de parcelas informada',
      code: 'invalid_installments',
      input: { billing_mode: 'equal_installments', total: 100 },
    },
    {
      name: 'quantidade de parcelas acima do limite do cronograma',
      code: 'invalid_installments',
      input: { billing_mode: 'equal_installments', total: 100, installments: 101 },
    },
    {
      name: 'cronograma sem itens',
      code: 'entries_required',
      input: { billing_mode: 'milestones', total: 100, entries: [] },
    },
    {
      name: 'item com vencimento em data específica, mas sem data informada',
      code: 'due_on_required',
      input: {
        billing_mode: 'milestones',
        total: 100,
        entries: [{ amount: 100, due_rule: 'on_date' }],
      },
    },
    {
      name: 'divisão em parcelas cujo valor não permite dar um centavo a cada item',
      code: 'invalid_entry_amount',
      input: { billing_mode: 'equal_installments', total: 0.01, installments: 3 },
    },
  ]

  for (const testCase of cases) {
    it(`recusa: ${testCase.name}`, () => {
      try {
        expandSchedule(testCase.input)
        throw new Error('era esperado que expandSchedule recusasse este cronograma')
      } catch (error) {
        expect(error).toBeInstanceOf(ScheduleError)
        expect((error as ScheduleError).code).toBe(testCase.code)
      }
    })
  }
})

describe('modelos de cronograma', () => {
  it('expande cada modelo inicial em um cronograma cuja soma corresponde ao total', () => {
    for (const template of DEFAULT_SCHEDULE_TEMPLATES) {
      const entries = expandTemplate(template, 12345.67)
      expect(sum(amounts(entries))).toBe(12345.67)
      expect(entries.length).toBeGreaterThan(0)
    }
  })

  it('expande 50/50 e 30/70 conforme indicado pelos nomes', () => {
    const half = expandTemplate(DEFAULT_SCHEDULE_TEMPLATES[0], 8000)
    expect(amounts(half)).toEqual([4000, 4000])
    expect(half.map((entry) => entry.due_rule)).toEqual(['on_start', 'on_complete'])

    const deposit = expandTemplate(DEFAULT_SCHEDULE_TEMPLATES[1], 8000)
    expect(amounts(deposit)).toEqual([2400, 5600])
  })

  it('expande o modelo de três fases em três itens nomeados de mesmo valor', () => {
    const phases = expandTemplate(DEFAULT_SCHEDULE_TEMPLATES[2], 100)
    expect(amounts(phases)).toEqual([33.33, 33.33, 33.34])
    expect(phases.map((entry) => entry.label)).toEqual(['Design', 'Desenvolvimento', 'Lançamento'])
  })

  it('expande dez parcelas', () => {
    expect(expandTemplate(DEFAULT_SCHEDULE_TEMPLATES[3], 1000)).toHaveLength(10)
  })
})
