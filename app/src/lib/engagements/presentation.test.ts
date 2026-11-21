import { describe, expect, it } from 'vitest'
import {
  formatContractDate,
  formatContractMoney,
  localizeBuiltInScheduleTemplate,
} from './presentation'
import { ENGAGEMENT_STATUS_LABELS } from './types'
import { DEFAULT_SCHEDULE_TEMPLATES, ENGAGEMENT_STATUSES } from './schedule'

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

  it('mantém os modelos padrão reais em português sem alterar chaves ou valores', () => {
    expect(DEFAULT_SCHEDULE_TEMPLATES.map(localizeBuiltInScheduleTemplate)).toEqual(
      DEFAULT_SCHEDULE_TEMPLATES,
    )
  })

  it('localiza o modelo legado do banco e preserva personalizações', () => {
    // Replica o default legado de businesses.schedule_templates em 00001_baseline.sql.
    const legacyTemplate = {
      key: 'design_build_launch',
      name: 'Design / Build / Launch',
      billing_mode: 'equal_installments' as const,
      installments: 3,
      entries: [
        { label: 'Design', due_rule: 'on_start' as const },
        { label: 'Build', due_rule: 'on_milestone' as const },
        { label: 'Launch', due_rule: 'on_complete' as const },
      ],
    }
    expect(localizeBuiltInScheduleTemplate(legacyTemplate)).toEqual({
      ...legacyTemplate,
      name: 'Design / Desenvolvimento / Lançamento',
      entries: [
        { label: 'Design', due_rule: 'on_start' },
        { label: 'Desenvolvimento', due_rule: 'on_milestone' },
        { label: 'Lançamento', due_rule: 'on_complete' },
      ],
    })

    const customizedTemplate = { ...legacyTemplate, name: 'Plano sob medida' }
    expect(localizeBuiltInScheduleTemplate(customizedTemplate)).toEqual(customizedTemplate)
  })
})
