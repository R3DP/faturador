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

const BUILT_IN_TEMPLATE_TRANSLATIONS: Record<
  string,
  { sourceName: string; name: string; entryLabels: Record<string, string> }
> = {
  '50_50': {
    sourceName: '50/50',
    name: '50/50',
    entryLabels: { Deposit: 'Entrada', 'On completion': 'Na conclusão' },
  },
  '30_70': {
    sourceName: '30/70',
    name: '30/70',
    entryLabels: { Deposit: 'Entrada', 'On completion': 'Na conclusão' },
  },
  design_build_launch: {
    sourceName: 'Design / Build / Launch',
    name: 'Design / Desenvolvimento / Lançamento',
    entryLabels: { Build: 'Desenvolvimento', Launch: 'Lançamento' },
  },
  '10_equal': {
    sourceName: '10 equal installments',
    name: '10 parcelas iguais',
    entryLabels: {},
  },
}

/** Traduz somente os valores originais dos modelos incluídos no produto. */
export function localizeBuiltInScheduleTemplate(template: ScheduleTemplate): ScheduleTemplate {
  const translation = BUILT_IN_TEMPLATE_TRANSLATIONS[template.key]
  if (!translation) return template

  return {
    ...template,
    name: template.name === translation.sourceName ? translation.name : template.name,
    entries: template.entries?.map((entry) => ({
      ...entry,
      label: entry.label ? translation.entryLabels[entry.label] ?? entry.label : entry.label,
    })),
  }
}
