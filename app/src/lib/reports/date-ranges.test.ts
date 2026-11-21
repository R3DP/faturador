import { describe, it, expect } from 'vitest'
import {
  bucketKeyFor,
  chooseBucket,
  enumerateBuckets,
  formatBucketLabel,
  formatRangeLabel,
  isValidRange,
  parseDay,
  previousRange,
  rangeLengthInDays,
  resolveRange,
  toISODate,
} from '@/lib/reports/date-ranges'

// Uma quinta-feira no meio do trimestre, para que os limites de mês, trimestre e ano sejam distintos.
const TODAY = new Date(2026, 7, 27) // 27 de ago. de 2026, horário local

describe('parseDay', () => {
  it('converte para meia-noite LOCAL, sem deslocar o dia do calendário', () => {
    const d = parseDay('2026-03-01')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(2)
    expect(d.getDate()).toBe(1)
    expect(d.getHours()).toBe(0)
  })
  it('faz a conversão de ida e volta por toISODate', () => {
    expect(toISODate(parseDay('2025-12-31'))).toBe('2025-12-31')
  })
})

describe('resolveRange', () => {
  it('o mês atual vai do dia 1 até hoje', () => {
    expect(resolveRange('this_month', TODAY)).toEqual({ start: '2026-08-01', end: '2026-08-27' })
  })
  it('o mês anterior corresponde a um mês-calendário completo', () => {
    expect(resolveRange('last_month', TODAY)).toEqual({ start: '2026-07-01', end: '2026-07-31' })
  })
  it('o trimestre até hoje começa no início do trimestre', () => {
    expect(resolveRange('quarter_to_date', TODAY)).toEqual({ start: '2026-07-01', end: '2026-08-27' })
  })
  it('o ano até hoje começa em 1º de janeiro', () => {
    expect(resolveRange('year_to_date', TODAY)).toEqual({ start: '2026-01-01', end: '2026-08-27' })
  })
  it('os últimos 12 meses começam 11 meses atrás, no início do mês', () => {
    expect(resolveRange('last_12_months', TODAY)).toEqual({ start: '2025-09-01', end: '2026-08-27' })
  })
  it('o intervalo personalizado mantém o intervalo informado pela chamada', () => {
    const custom = { start: '2026-02-03', end: '2026-02-09' }
    expect(resolveRange('custom', TODAY, custom)).toEqual(custom)
  })
})

describe('previousRange', () => {
  it('o mês atual é comparado ao mesmo período do mês anterior', () => {
    const range = resolveRange('this_month', TODAY)
    expect(previousRange(range, 'this_month')).toEqual({ start: '2026-07-01', end: '2026-07-27' })
  })
  it('ajusta um mês longo ao mês anterior, mais curto', () => {
    // De 1 a 31 de março comparado a fevereiro, que tem 28 dias em 2026.
    const range = { start: '2026-03-01', end: '2026-03-31' }
    expect(previousRange(range, 'this_month')).toEqual({ start: '2026-02-01', end: '2026-02-28' })
  })
  it('o mês anterior é comparado ao mês completo que veio antes dele', () => {
    const range = resolveRange('last_month', TODAY)
    expect(previousRange(range, 'last_month')).toEqual({ start: '2026-06-01', end: '2026-06-30' })
  })
  it('o trimestre até hoje é comparado ao mesmo período do trimestre anterior', () => {
    const range = resolveRange('quarter_to_date', TODAY)
    expect(previousRange(range, 'quarter_to_date')).toEqual({ start: '2026-04-01', end: '2026-05-28' })
  })
  it('o ano até hoje é comparado ao mesmo período do ano passado', () => {
    const range = resolveRange('year_to_date', TODAY)
    expect(previousRange(range, 'year_to_date')).toEqual({ start: '2025-01-01', end: '2025-08-27' })
  })
  it('um intervalo personalizado é comparado ao período de mesma duração imediatamente anterior', () => {
    const range = { start: '2026-02-10', end: '2026-02-19' } // 10 days
    const prev = previousRange(range, 'custom')
    expect(prev).toEqual({ start: '2026-01-31', end: '2026-02-09' })
    expect(rangeLengthInDays(prev)).toBe(rangeLengthInDays(range))
  })
  it('nunca se sobrepõe ao intervalo usado na comparação', () => {
    const range = { start: '2026-05-01', end: '2026-05-31' }
    expect(previousRange(range, 'custom').end < range.start).toBe(true)
  })
})

describe('chooseBucket', () => {
  it('usa dias para períodos de até um mês', () => {
    expect(chooseBucket({ start: '2026-08-01', end: '2026-08-27' })).toBe('day')
    expect(chooseBucket({ start: '2026-01-01', end: '2026-01-31' })).toBe('day')
  })
  it('usa semanas para um trimestre', () => {
    expect(chooseBucket({ start: '2026-01-01', end: '2026-03-31' })).toBe('week')
  })
  it('usa meses para períodos mais longos', () => {
    expect(chooseBucket({ start: '2025-09-01', end: '2026-08-27' })).toBe('month')
  })
})

describe('enumerateBuckets', () => {
  it('gera o início de cada mês, incluindo as duas extremidades', () => {
    expect(enumerateBuckets({ start: '2026-01-15', end: '2026-03-02' }, 'month')).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ])
  })
  it('começa as semanas na segunda-feira, como date_trunc do Postgres', () => {
    // 2026-08-27 é uma quinta-feira; a semana começa na segunda-feira, 2026-08-24.
    expect(enumerateBuckets({ start: '2026-08-27', end: '2026-09-01' }, 'week')).toEqual([
      '2026-08-24',
      '2026-08-31',
    ])
  })
  it('gera todos os dias em um agrupamento diário', () => {
    expect(enumerateBuckets({ start: '2026-02-27', end: '2026-03-01' }, 'day')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
    ])
  })
})

describe('bucketKeyFor', () => {
  it('mapeia uma data para o início do agrupamento correspondente', () => {
    expect(bucketKeyFor('2026-08-27', 'month')).toBe('2026-08-01')
    expect(bucketKeyFor('2026-08-27', 'week')).toBe('2026-08-24')
    expect(bucketKeyFor('2026-08-27', 'day')).toBe('2026-08-27')
  })
})

describe('rótulos e validação', () => {
  it('rotula os agrupamentos conforme a unidade', () => {
    expect(formatBucketLabel('2026-08-01', 'month')).toBe('ago. de 2026')
    expect(formatBucketLabel('2026-08-24', 'week')).toBe('24 de ago.')
  })
  it('omite o ano repetido no rótulo de um intervalo dentro do mesmo ano', () => {
    expect(formatRangeLabel({ start: '2026-01-01', end: '2026-03-31' })).toBe('1 de jan. a 31 de mar. de 2026')
    expect(formatRangeLabel({ start: '2025-12-01', end: '2026-01-31' })).toBe('1 de dez. de 2025 a 31 de jan. de 2026')
  })
  it('recusa intervalos personalizados inválidos ou invertidos', () => {
    expect(isValidRange({ start: '2026-01-01', end: '2026-01-31' })).toBe(true)
    expect(isValidRange({ start: '2026-02-01', end: '2026-01-31' })).toBe(false)
    expect(isValidRange({ start: '', end: '2026-01-31' })).toBe(false)
    expect(isValidRange({ start: '01/01/2026', end: '2026-01-31' })).toBe(false)
  })
})
