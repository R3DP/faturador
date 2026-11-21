const ACTIVITY_ENTITIES = [
  'invoice', 'client', 'estimate', 'time_entry', 'expense', 'payment',
] as const

type ActivityEntity = (typeof ACTIVITY_ENTITIES)[number]

export interface ActivityRow {
  entity_type: ActivityEntity
  entity_id: string
  business_id: string
  label: string
  amount: number | null
  created_at: string
  created_via: string
  created_by_key_id: string | null
}

export function activityHref(row: ActivityRow): string {
  switch (row.entity_type) {
    case 'invoice': return `/invoices/${row.entity_id}`
    case 'client': return `/clients/${row.entity_id}`
    case 'estimate': return `/estimates/${row.entity_id}`
    case 'time_entry': return '/time'
    case 'expense': return '/expenses'
    case 'payment': return '/payments'
  }
}

function isActivityEntity(value: unknown): value is ActivityEntity {
  return typeof value === 'string' && (ACTIVITY_ENTITIES as readonly string[]).includes(value)
}

/**
 * Converte uma linha bruta retornada pela RPC `get_agent_activity` em uma
 * `ActivityRow`. Os tipos gerados do Supabase (`src/types/database.ts`)
 * indicam `amount` e `created_by_key_id` como strings/números não nulos, mas
 * o SQL real retorna NULL para ambos em vários tipos de entidade (por exemplo,
 * linhas de `client`/`time_entry` sempre têm `amount` NULL; linhas criadas fora
 * do fluxo MCP/agente têm `created_by_key_id` NULL), portanto quem chama não deve
 * confiar diretamente nos tipos gerados `Args`/`Returns` e deve passar cada
 * linha bruta da RPC por este mapeador.
 *
 * Linhas com `entity_type` fora dos seis valores literais conhecidos são
 * descartadas (retornam `null`) em vez de gerar uma exceção, pois o feed de
 * atividades é uma lista de interface de melhor esforço: um tipo de linha
 * desconhecido/futuro não deve derrubar o feed inteiro. Quem chama deve filtrar
 * os valores nulos, por exemplo:
 * `rows.map(toActivityRow).filter((r): r is ActivityRow => r !== null)`.
 */
export function toActivityRow(raw: unknown): ActivityRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  if (!isActivityEntity(r.entity_type)) return null
  if (typeof r.entity_id !== 'string') return null
  if (typeof r.business_id !== 'string') return null
  if (typeof r.label !== 'string') return null
  if (typeof r.created_at !== 'string') return null
  if (typeof r.created_via !== 'string') return null

  const amount = typeof r.amount === 'number' ? r.amount : null
  const created_by_key_id = typeof r.created_by_key_id === 'string' ? r.created_by_key_id : null

  return {
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    business_id: r.business_id,
    label: r.label,
    amount,
    created_at: r.created_at,
    created_via: r.created_via,
    created_by_key_id,
  }
}
