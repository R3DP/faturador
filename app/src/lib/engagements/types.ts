import type { Database } from '@/types/database'
import type { BillingMode, DueRule, EngagementStatus, EntryStatus } from './schedule'

/**
 * Formatos de linha lidos pelas páginas de contratos, restringidos a partir
 * dos tipos gerados do banco de dados para que as colunas de texto carreguem
 * suas uniões reais (um status é uma entre cinco opções, não qualquer texto),
 * sem uma segunda cópia manual do esquema.
 */
export type EngagementRow = Omit<
  Database['public']['Tables']['engagements']['Row'],
  'status' | 'billing_mode'
> & {
  status: EngagementStatus
  billing_mode: BillingMode
}

export type EngagementEntryRow = Omit<
  Database['public']['Tables']['engagement_entries']['Row'],
  'status' | 'due_rule'
> & {
  status: EntryStatus
  due_rule: DueRule
}

export type EngagementSummaryRow = Omit<
  Database['public']['Views']['engagement_summary']['Row'],
  'status' | 'billing_mode'
> & {
  status: EngagementStatus | null
  billing_mode: BillingMode | null
}

/** Linha de resumo com o nome do cliente já resolvido, para a página de lista. */
export interface EngagementListRow extends EngagementSummaryRow {
  client_name: string | null
}

export const ENGAGEMENT_STATUS_COLORS: Record<EngagementStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-700',
  paused: 'bg-amber-100 text-amber-700',
  completed: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-700',
}

/** Rótulos humanos dos status; os códigos persistidos permanecem em inglês. */
export const ENGAGEMENT_STATUS_LABELS: Record<EngagementStatus, string> = {
  draft: 'Rascunho',
  active: 'Ativo',
  paused: 'Pausado',
  completed: 'Concluído',
  cancelled: 'Cancelado',
}

export const ENTRY_STATUS_COLORS: Record<EntryStatus, string> = {
  pending: 'bg-gray-100 text-gray-700',
  ready_to_bill: 'bg-emerald-100 text-emerald-700',
  invoiced: 'bg-indigo-100 text-indigo-700',
  waived: 'bg-gray-100 text-gray-500',
}

export const ENTRY_STATUS_LABELS: Record<EntryStatus, string> = {
  pending: 'Pendente',
  ready_to_bill: 'Pronto para faturar',
  invoiced: 'Faturado',
  waived: 'Dispensado',
}

/** Como cada regra de vencimento aparece para quem consulta o cronograma. */
export const DUE_RULE_LABELS: Record<DueRule, string> = {
  on_start: 'Quando o trabalho começar',
  on_complete: 'Na conclusão',
  on_milestone: 'Quando marcado como concluído',
  on_date: 'Em uma data',
  manual: 'Quando você decidir',
}

export const BILLING_MODE_LABELS: Record<BillingMode, string> = {
  percent_split: 'Divisão percentual',
  equal_installments: 'Parcelas iguais',
  milestones: 'Etapas',
  manual: 'Manual',
}
