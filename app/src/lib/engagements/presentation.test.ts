import { describe, expect, it } from 'vitest'
import {
  formatContractDate,
  formatContractMoney,
  localizeBuiltInScheduleTemplate,
} from './presentation'
import { ENGAGEMENT_STATUS_LABELS } from './types'
import { ENGAGEMENT_STATUSES } from './schedule'

describe('formatação exibida nos contratos', () => {
  it('traduz os status sem alterar seus códigos internos', () => {
    expect(Object.keys(ENGAGEMENT_STATUS_LABELS)).toEqual([...ENGAGEMENT_STATUSES])
    expect(Object.values(ENGAGEMENT_STATUS_LABELS)).toEqual([
      'Rascunho',
      'Ativo',
      'Pausado',
      'Concluído',
      'Cancelado',
    ])
  })

  it('formata valores na convenção brasileira sem trocar a moeda informada', () => {
    expect(formatContractMoney(1234.56, 'BRL')).toContain('1.234,56')
    expect(formatContractMoney(1234.56, 'USD')).toContain('1.234,56')
  })

  it('apresenta datas sem deslocá-las por fuso horário', () => {
    expect(formatContractDate('2026-03-15')).toBe('15 de mar. de 2026')
  })

  it('localiza nomes e lançamentos dos modelos embutidos sem mudar suas chaves', () => {
    const localized = localizeBuiltInScheduleTemplate({
      key: 'design_build_launch',
      name: 'Design / Build / Launch',
      billing_mode: 'equal_installments',
      installments: 3,
      entries: [
        { label: 'Design', due_rule: 'on_start' },
        { label: 'Build', due_rule: 'on_milestone' },
        { label: 'Launch', due_rule: 'on_complete' },
      ],
    })

    expect(localized).toMatchObject({
      key: 'design_build_launch',
      name: 'Design / Desenvolvimento / Lançamento',
      entries: [{ label: 'Design' }, { label: 'Desenvolvimento' }, { label: 'Lançamento' }],
    })
  })
})
