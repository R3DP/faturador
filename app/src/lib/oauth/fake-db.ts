/**
 * Substituto em memória, SOMENTE PARA TESTES, da parte do construtor de consultas
 * do Supabase usada por src/lib/oauth/store.ts. Não é importado em nenhum fluxo de execução.
 *
 * Ele existe porque as partes mais importantes do servidor OAuth são justamente
 * aquelas que um armazenamento simulado esconderia: um código resgatável exatamente
 * uma vez, um token de renovação rotacionado que revoga toda a família e uma chave de
 * acesso substituída marcada como revogada. Essas propriedades pertencem às CONSULTAS,
 * então os testes executam o armazenamento real sobre linhas reais mantidas em um objeto JavaScript.
 *
 * Suportados: from(table).select/insert/update/delete encadeados com
 * eq/is/in/lt/order/limit, finalizados com await, .maybeSingle() ou .single().
 *
 * Ele NÃO resolve a inclusão de recursos do PostgREST, intencionalmente.
 * Incluir `other_table(column)` exige SELECT em `other_table` para a função que
 * faz a CONSULTA; várias dessas tabelas revogam esse acesso. Um substituto que
 * aceitasse uma junção indicaria como válida uma consulta que o banco rejeitaria.
 * Em vez disso, cada lista de colunas solicitada é registrada em `selects`, permitindo
 * que o teste confirme o que foi realmente solicitado.
 */
import { randomUUID } from 'node:crypto'

export type Row = Record<string, unknown>

type Filter = { method: 'eq' | 'is' | 'in' | 'lt'; column: string; value: unknown }

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((filter) => {
    const actual = row[filter.column]
    switch (filter.method) {
      case 'eq':
        return actual === filter.value
      case 'is':
        return filter.value === null ? actual == null : actual === filter.value
      case 'in':
        return Array.isArray(filter.value) && filter.value.includes(actual)
      case 'lt':
        return (
          typeof actual === 'string' &&
          typeof filter.value === 'string' &&
          actual < filter.value
        )
    }
  })
}

export interface FakeDb {
  tables: Record<string, Row[]>
  /** Cada lista de colunas solicitada a este substituto, na ordem em que foi pedida. */
  selects: { table: string; columns: string }[]
  /** Conversão no ponto de uso; implementa somente o que o armazenamento chama. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any
}

export function createFakeDb(seed: Record<string, Row[]> = {}): FakeDb {
  const tables: Record<string, Row[]> = {}
  const selects: { table: string; columns: string }[] = []
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((row) => ({ ...row }))

  function rowsFor(table: string): Row[] {
    if (!tables[table]) tables[table] = []
    return tables[table]
  }

  function makeQuery(table: string, op: 'select' | 'insert' | 'update' | 'delete', payload?: Row) {
    const filters: Filter[] = []

    function run(): Row[] {
      const rows = rowsFor(table)
      if (op === 'insert') {
        const inserted: Row = {
          id: randomUUID(),
          created_at: new Date().toISOString(),
          ...payload,
        }
        rows.push(inserted)
        return [{ ...inserted }]
      }
      const hit = rows.filter((row) => matches(row, filters))
      if (op === 'select') return hit.map((row) => ({ ...row }))
      if (op === 'update') {
        for (const row of hit) Object.assign(row, payload)
        return hit.map((row) => ({ ...row }))
      }
      for (const row of hit) rows.splice(rows.indexOf(row), 1)
      return hit.map((row) => ({ ...row }))
    }

    const chain: Record<string, unknown> = {
      eq: (column: string, value: unknown) => {
        filters.push({ method: 'eq', column, value })
        return chain
      },
      is: (column: string, value: unknown) => {
        filters.push({ method: 'is', column, value })
        return chain
      },
      in: (column: string, value: unknown) => {
        filters.push({ method: 'in', column, value })
        return chain
      },
      lt: (column: string, value: unknown) => {
        filters.push({ method: 'lt', column, value })
        return chain
      },
      select: (columns?: string) => {
        if (typeof columns === 'string') selects.push({ table, columns })
        return chain
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => {
        const [row] = run()
        return row ? { data: row, error: null } : { data: null, error: { message: 'no rows' } }
      },
      then: (
        onFulfilled: (value: { data: Row[]; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => Promise.resolve({ data: run(), error: null }).then(onFulfilled, onRejected),
    }
    return chain
  }

  const client = {
    from(table: string) {
      return {
        select: (columns?: string) => {
          if (typeof columns === 'string') selects.push({ table, columns })
          return makeQuery(table, 'select')
        },
        insert: (payload: Row) => makeQuery(table, 'insert', payload),
        update: (payload: Row) => makeQuery(table, 'update', payload),
        delete: () => makeQuery(table, 'delete'),
      }
    },
  }

  return { tables, selects, client }
}

/** Substituto do limitador de requisições que sempre permite, para que os limites não ocultem uma falha real. */
export function allowAllRateLimitStore() {
  return {
    rpc: async () => ({
      data: [{ allowed: true, remaining: 100, retry_after_seconds: 0 }],
      error: null,
    }),
  }
}
