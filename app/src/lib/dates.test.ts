import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { addDaysISO, isISODate, parseDay, toISODate, todayISO } from './dates'

describe('parseDay', () => {
  it('converte para meia-noite LOCAL, não para meia-noite UTC', () => {
    const d = parseDay('2026-01-05')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(0)
    expect(d.getDate()).toBe(5)
    expect(d.getHours()).toBe(0)
  })

  it('não desloca o dia como `new Date(iso)` a oeste de Greenwich', () => {
    // new Date('2026-01-05') corresponde à meia-noite UTC; lido pelos campos
    // locais, corresponde a 4 de jan. em qualquer fuso de deslocamento negativo.
    // parseDay mantém o resultado estável em todos os lugares.
    expect(parseDay('2026-01-05').getDate()).toBe(5)
  })
})

describe('toISODate', () => {
  it('formata usando os campos do calendário LOCAL', () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('preenche com zeros à esquerda', () => {
    expect(toISODate(new Date(2026, 8, 9))).toBe('2026-09-09')
  })

  it('não desloca o dia como `toISOString().slice(0, 10)`', () => {
    // Um seletor de data retorna a meia-noite local. toISOString() converte
    // primeiro para UTC, que corresponde ao dia anterior em qualquer fuso de
    // deslocamento negativo.
    expect(toISODate(new Date(2026, 0, 5, 0, 0, 0))).toBe('2026-01-05')
  })
})

describe('ida e volta', () => {
  const days = [
    '2026-01-01',
    '2026-01-05',
    '2026-02-28',
    '2024-02-29',
    '2026-03-08', // Início do horário de verão nos EUA
    '2026-03-29', // Início do horário de verão na Europa
    '2026-06-30',
    '2026-11-01', // Fim do horário de verão nos EUA
    '2026-12-31',
  ]

  it('string -> Date -> string mantém o valor, inclusive durante o horário de verão', () => {
    for (const day of days) {
      expect(toISODate(parseDay(day)), day).toBe(day)
    }
  })
})

describe('todayISO', () => {
  it('lê o dia local do calendário indicado pelo relógio fornecido', () => {
    expect(todayISO(new Date(2026, 7, 27, 23, 59))).toBe('2026-08-27')
    expect(todayISO(new Date(2026, 7, 27, 0, 1))).toBe('2026-08-27')
  })

  it('é uma data de calendário bem formada para o relógio atual', () => {
    expect(isISODate(todayISO())).toBe(true)
  })
})

describe('addDaysISO', () => {
  it('atravessa limites de mês e ano', () => {
    expect(addDaysISO('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('não perde um dia durante a transição do horário de verão', () => {
    expect(addDaysISO('2026-03-07', 1)).toBe('2026-03-08')
    expect(addDaysISO('2026-11-01', 1)).toBe('2026-11-02')
  })

  it('trata um dia bissexto', () => {
    expect(addDaysISO('2024-02-28', 1)).toBe('2024-02-29')
  })
})

describe('isISODate', () => {
  it('aceita e rejeita os casos mais evidentes', () => {
    expect(isISODate('2026-01-05')).toBe(true)
    expect(isISODate('2026-1-5')).toBe(false)
    expect(isISODate('05/01/2026')).toBe(false)
    expect(isISODate('')).toBe(false)
  })
})

/**
 * Verificação, no mesmo espírito da checagem de travessão em
 * src/lib/mcp/tool-catalog.test.ts: as duas construções proibidas são fáceis de usar
 * e estão erradas sem aviso; por isso, falhe a compilação em vez de depender
 * da revisão para detectá-las. O próprio src/lib/dates.ts é uma exceção, pois
 * documenta essas expressões.
 */
describe('expressões de data proibidas', () => {
  const ROOT = join(process.cwd(), 'src')
  const EXEMPT = new Set([join(ROOT, 'lib', 'dates.ts'), join(ROOT, 'lib', 'dates.test.ts')])

  function walk(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) out.push(...walk(full))
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
    }
    return out
  }

  const files = walk(ROOT).filter((f) => !EXEMPT.has(f))

  it('nenhum arquivo-fonte converte um Date em dia do calendário por meio de UTC', () => {
    const offenders = files.filter((f) => {
      const src = readFileSync(f, 'utf8')
      return /toISOString\(\)\s*\.\s*(slice\(0,\s*10\)|split\('T'\)\[0\])/.test(src)
    })
    expect(offenders, 'use toISODate / todayISO de @/lib/dates').toEqual([])
  })

  it('nenhum arquivo-fonte interpreta uma data armazenada com new Date(...)', () => {
    const offenders = files.filter((f) => {
      const src = readFileSync(f, 'utf8')
      // new Date(<algo>.issue_date / due_date / payment_date / expiry_date / paid_at / .date)
      return /new Date\([A-Za-z_$][\w$.]*\.(issue_date|due_date|expiry_date|payment_date|paid_at|date)\b/.test(
        src
      )
    })
    expect(offenders, 'use parseDay de @/lib/dates').toEqual([])
  })
})
