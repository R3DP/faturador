/**
 * Expansão do cronograma: a definição única de como um valor total acordado
 * se transforma em uma lista concreta de itens de faturamento.
 *
 * Este módulo é intencionalmente puro, sem banco de dados nem React, porque a
 * mesma expansão existe em dois lugares e as duas versões precisam coincidir
 * até o centavo:
 *
 *   * aqui, para que /engagements/new possa pré-visualizar o cronograma antes
 *     de qualquer gravação; e
 *   * em SQL, como expand_engagement_schedule(), que grava as linhas de fato,
 *     impedindo que uma chamada PostgREST escrita à mão ou um agente envie um
 *     cronograma cuja soma esteja incorreta.
 *
 * schedule.test.ts e supabase/tests/engagements.sql executam os MESMOS casos
 * nas duas implementações. Se as regras mudarem aqui, elas também precisam
 * mudar lá; caso contrário, um dos arquivos de teste vai falhar.
 *
 * Regra de arredondamento, em todos os lugares: todos os itens, menos o último,
 * são arredondados para centavos, e o ÚLTIMO absorve o saldo restante para que
 * a soma dos itens seja sempre exatamente igual ao total. Dividir 100 em três
 * resulta em 33.33, 33.33, 33.34, nunca em 99.99.
 */

export const BILLING_MODES = [
  'percent_split',
  'equal_installments',
  'milestones',
  'manual',
] as const
export type BillingMode = (typeof BILLING_MODES)[number]

export const DUE_RULES = ['on_start', 'on_complete', 'on_milestone', 'on_date', 'manual'] as const
export type DueRule = (typeof DUE_RULES)[number]

export type EntryStatus = 'pending' | 'ready_to_bill' | 'invoiced' | 'waived'

export const ENGAGEMENT_STATUSES = [
  'draft',
  'active',
  'paused',
  'completed',
  'cancelled',
] as const
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number]

/** Limite máximo útil para um cronograma, também imposto pelo SQL. */
export const MAX_ENTRIES = 100

interface ScheduleEntryInput {
  label?: string | null
  amount?: number | null
  percent?: number | null
  due_rule?: DueRule | null
  due_on?: string | null
}

export interface ScheduleEntry {
  position: number
  label: string
  amount: number
  percent: number | null
  due_rule: DueRule
  due_on: string | null
}

export interface ExpandInput {
  billing_mode: BillingMode
  total: number
  entries?: ScheduleEntryInput[] | null
  /** Usado apenas em equal_installments, quando os itens não são especificados. */
  installments?: number | null
}

/**
 * Cada recusa traz um código estável, escrito da mesma forma no SQL, para que
 * a camada de ferramentas e a interface convertam um vocabulário único em
 * frases, sem precisar interpretar dois textos de erro diferentes.
 */
export type ScheduleErrorCode =
  | 'invalid_billing_mode'
  | 'invalid_total'
  | 'entries_required'
  | 'too_many_entries'
  | 'invalid_percent'
  | 'percent_must_total_100'
  | 'entry_amount_required'
  | 'invalid_entry_amount'
  | 'entries_must_total_engagement'
  | 'invalid_installments'
  | 'invalid_due_rule'
  | 'due_on_required'

export class ScheduleError extends Error {
  code: ScheduleErrorCode
  constructor(code: ScheduleErrorCode, message: string) {
    super(message)
    this.name = 'ScheduleError'
    this.code = code
  }
}

/** Uma frase por recusa, compartilhada pela prévia da interface e pela camada de ferramentas. */
const SCHEDULE_ERROR_MESSAGES: Record<ScheduleErrorCode, string> = {
  invalid_billing_mode: 'Escolha uma forma de faturamento: percent_split, equal_installments, milestones ou manual.',
  invalid_total: 'O valor total do contrato deve ser maior que zero.',
  entries_required: 'Esta forma de faturamento exige pelo menos um item no cronograma.',
  too_many_entries: `Um cronograma pode ter no máximo ${MAX_ENTRIES} itens.`,
  invalid_percent: 'Cada item de uma divisão percentual precisa ter um percentual maior que 0 e menor ou igual a 100.',
  percent_must_total_100: 'Os percentuais da divisão devem somar exatamente 100.',
  entry_amount_required: 'Cada item precisa ter um valor nesta forma de faturamento.',
  invalid_entry_amount: 'O valor de cada item deve ser maior que zero.',
  entries_must_total_engagement: 'Os valores dos itens devem somar exatamente o valor total do contrato.',
  invalid_installments: `Escolha entre 1 e ${MAX_ENTRIES} parcelas.`,
  invalid_due_rule: 'Escolha uma regra de vencimento: on_start, on_complete, on_milestone, on_date ou manual.',
  due_on_required: 'Informe a data de vencimento do item.',
}

export function scheduleErrorMessage(code: string): string | null {
  return (SCHEDULE_ERROR_MESSAGES as Record<string, string | undefined>)[code] ?? null
}

function fail(code: ScheduleErrorCode): never {
  throw new ScheduleError(code, SCHEDULE_ERROR_MESSAGES[code])
}

/** Centavos, com a imprecisão de ponto flutuante corrigida antes do arredondamento. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Regra de vencimento padrão quando quem chamou não informa uma. Um plano de
 * pagamento quase sempre tem "algo no início, algo no fim e etapas entre eles",
 * então esse é o formato aplicado a um cronograma sem anotações. Um contrato
 * manual continua manual: cada item aguarda a ação de uma pessoa.
 */
function defaultDueRule(mode: BillingMode, index: number, count: number): DueRule {
  if (mode === 'manual') return 'manual'
  if (count === 1) return 'on_complete'
  if (index === 0) return 'on_start'
  if (index === count - 1) return 'on_complete'
  return 'on_milestone'
}

function defaultLabel(mode: BillingMode, index: number, count: number): string {
  return mode === 'equal_installments'
    ? `Parcela ${index + 1} de ${count}`
    : `Pagamento ${index + 1} de ${count}`
}

function normalizeEntry(
  mode: BillingMode,
  input: ScheduleEntryInput,
  index: number,
  count: number,
  amount: number,
  percent: number | null
): ScheduleEntry {
  const rule = (input.due_rule ?? defaultDueRule(mode, index, count)) as DueRule
  if (!DUE_RULES.includes(rule)) fail('invalid_due_rule')

  const dueOn = input.due_on ?? null
  if (rule === 'on_date' && (!dueOn || !ISO_DATE.test(dueOn))) fail('due_on_required')

  const label = (input.label ?? '').trim() || defaultLabel(mode, index, count)

  return {
    position: index,
    label: label.slice(0, 200),
    amount,
    percent,
    due_rule: rule,
    // A data só tem significado para um item on_date. Nos demais casos, mantém
    // null para que uma data desatualizada não faça a rotina liberar o item antes.
    due_on: rule === 'on_date' ? dueOn : null,
  }
}

/**
 * Divide `total` entre `count` itens, arredondando cada um para centavos; o
 * último absorve o saldo para que as partes somem exatamente o total.
 * `weights` representa percentuais quando informado; caso contrário, as partes são iguais.
 */
function splitTotal(total: number, count: number, weights: number[] | null): number[] {
  const amounts: number[] = []
  let allocated = 0
  for (let index = 0; index < count - 1; index += 1) {
    const share = weights ? round2((total * weights[index]) / 100) : round2(total / count)
    amounts.push(share)
    allocated = round2(allocated + share)
  }
  amounts.push(round2(total - allocated))
  return amounts
}

/**
 * Converte a forma de faturamento e a intenção geral de quem chamou nas linhas
 * concretas usadas para faturar um contrato. Lança ScheduleError; nunca retorna
 * um cronograma cuja soma não corresponda ao total.
 */
export function expandSchedule(input: ExpandInput): ScheduleEntry[] {
  const mode = input.billing_mode
  if (!BILLING_MODES.includes(mode)) fail('invalid_billing_mode')

  const total = round2(input.total)
  if (!Number.isFinite(total) || total <= 0 || total >= 100000000) fail('invalid_total')

  const given = input.entries ?? []

  if (mode === 'equal_installments') {
    const count = given.length > 0 ? given.length : (input.installments ?? 0)
    if (!Number.isInteger(count) || count < 1 || count > MAX_ENTRIES) fail('invalid_installments')

    const amounts = splitTotal(total, count, null)
    return amounts.map((amount, index) => {
      if (amount <= 0) fail('invalid_entry_amount')
      return normalizeEntry(mode, given[index] ?? {}, index, count, amount, null)
    })
  }

  if (given.length === 0) fail('entries_required')
  if (given.length > MAX_ENTRIES) fail('too_many_entries')
  const count = given.length

  if (mode === 'percent_split') {
    const percents = given.map((entry) => {
      const percent = round2(entry.percent ?? 0)
      if (!Number.isFinite(percent) || percent <= 0 || percent > 100) fail('invalid_percent')
      return percent
    })
    if (round2(percents.reduce((sum, percent) => round2(sum + percent), 0)) !== 100) {
      fail('percent_must_total_100')
    }

    const amounts = splitTotal(total, count, percents)
    return amounts.map((amount, index) => {
      if (amount <= 0) fail('invalid_entry_amount')
      return normalizeEntry(mode, given[index], index, count, amount, percents[index])
    })
  }

  // Em milestones e manual, quem chamou informa cada valor e a soma já precisa
  // estar correta. Nenhum valor é redistribuído sem aviso.
  const amounts = given.map((entry) => {
    if (entry.amount === null || entry.amount === undefined) fail('entry_amount_required')
    const amount = round2(entry.amount)
    if (!Number.isFinite(amount) || amount <= 0 || amount >= 100000000) fail('invalid_entry_amount')
    return amount
  })
  if (round2(amounts.reduce((sum, amount) => round2(sum + amount), 0)) !== total) {
    fail('entries_must_total_engagement')
  }

  return amounts.map((amount, index) =>
    normalizeEntry(mode, given[index], index, count, amount, null)
  )
}

/**
 * Modelos de cronograma da empresa, inseridos pelo banco em
 * businesses.schedule_templates. Também ficam aqui para que uma empresa
 * criada antes da coluna ainda tenha opções disponíveis e para que o teste
 * SQL possa confirmar que os dados iniciais correspondem aos do app.
 */
export interface ScheduleTemplate {
  key: string
  name: string
  billing_mode: BillingMode
  installments?: number
  entries?: ScheduleEntryInput[]
}

export const DEFAULT_SCHEDULE_TEMPLATES: ScheduleTemplate[] = [
  {
    key: '50_50',
    name: '50/50',
    billing_mode: 'percent_split',
    entries: [
      { label: 'Entrada', percent: 50, due_rule: 'on_start' },
      { label: 'Na conclusão', percent: 50, due_rule: 'on_complete' },
    ],
  },
  {
    key: '30_70',
    name: '30/70',
    billing_mode: 'percent_split',
    entries: [
      { label: 'Entrada', percent: 30, due_rule: 'on_start' },
      { label: 'Na conclusão', percent: 70, due_rule: 'on_complete' },
    ],
  },
  {
    key: 'design_build_launch',
    name: 'Design / Desenvolvimento / Lançamento',
    billing_mode: 'equal_installments',
    installments: 3,
    entries: [
      { label: 'Design', due_rule: 'on_start' },
      { label: 'Desenvolvimento', due_rule: 'on_milestone' },
      { label: 'Lançamento', due_rule: 'on_complete' },
    ],
  },
  {
    key: '10_equal',
    name: '10 parcelas iguais',
    billing_mode: 'equal_installments',
    installments: 10,
  },
]

/** Prévia da interface: cronograma que um modelo geraria para determinado total. */
export function expandTemplate(template: ScheduleTemplate, total: number): ScheduleEntry[] {
  return expandSchedule({
    billing_mode: template.billing_mode,
    total,
    entries: template.entries ?? null,
    installments: template.installments ?? null,
  })
}
