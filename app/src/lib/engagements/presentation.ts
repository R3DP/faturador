import type { ScheduleTemplate } from './schedule'

/** Formatação de valores e datas apresentada nas telas de contratos. */
export function formatContractMoney(
  amount: number | null | undefined,
  currency: string | null | undefined,
) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currency || 'USD',
  }).format(amount ?? 0)
}

export function formatContractDate(date: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00.000Z`))
}

type BuiltInTemplateTranslation = {
  sourceName: string
  name: string
  sourceLabels: string[]
  labels: string[]
}

const LEGACY_BUILT_IN_TEMPLATE_TRANSLATIONS: Record<string, BuiltInTemplateTranslation> = {
  '50_50': {
    sourceName: '50/50',
    name: '50/50',
    sourceLabels: ['Deposit', 'On completion'],
    labels: ['Entrada', 'Na conclusão'],
  },
  '30_70': {
    sourceName: '30/70',
    name: '30/70',
    sourceLabels: ['Deposit', 'On completion'],
    labels: ['Entrada', 'Na conclusão'],
  },
  design_build_launch: {
    sourceName: 'Design / Build / Launch',
    name: 'Design / Desenvolvimento / Lançamento',
    sourceLabels: ['Design', 'Build', 'Launch'],
    labels: ['Design', 'Desenvolvimento', 'Lançamento'],
  },
  '10_equal': {
    sourceName: '10 equal installments',
    name: '10 parcelas iguais',
    sourceLabels: [],
    labels: [],
  },
}

/** Localiza apenas os modelos legados intactos; valores personalizados ficam como estão. */
export function localizeBuiltInScheduleTemplate(template: ScheduleTemplate): ScheduleTemplate {
  const translation = LEGACY_BUILT_IN_TEMPLATE_TRANSLATIONS[template.key]
  if (
    !translation ||
    template.name !== translation.sourceName ||
    (template.entries ?? []).length !== translation.sourceLabels.length ||
    (template.entries ?? []).some((entry, index) => entry.label !== translation.sourceLabels[index])
  ) {
    return template
  }

  return {
    ...template,
    name: translation.name,
    entries: template.entries?.map((entry, index) => ({
      ...entry,
      label: entry.label ? translation.labels[index] : entry.label,
    })),
  }
}
