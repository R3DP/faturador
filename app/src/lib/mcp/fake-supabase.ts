/**
 * Simulação EXCLUSIVA DE TESTES da parte do construtor de consultas supabase-js usada pelas ferramentas MCP
 * Não é importada por nenhum caminho de execução.
 *
 * Ela permite testar handlers de ponta a ponta (registrar a ferramenta,
 * chamá-la e verificar o JSON retornado) sem banco de dados, sendo a
 * única forma de testar cálculos como a conversão de estimativa em fatura ou verificar que um
 * handler rejeita um registro fora do escopo.
 *
 * Cadeia compatível: from(table).select(...).eq/neq/in/is/not/ilike/gt/gte/lt/lte/order/limit
 * finalizada por await, .maybeSingle() ou .single(); também há suporte a .insert(), .update() e
 * .delete().
 *
 * Também oferece suporte a rpc(fn, args), usado por todas as gravações transacionais para acessar
 * o banco de dados. Sem isso, esses pontos de chamada não poderiam ser
 * testados, motivo pelo qual record_payment ficou temporariamente sem cobertura.
 */

export interface FakeQuery {
  /** Nome da tabela ou, em uma chamada rpc, nome da função do Postgres. */
  table: string
  op: 'select' | 'insert' | 'update' | 'delete' | 'rpc'
  /** Definido apenas quando op é "rpc". Tem o mesmo valor de `table`, escrito separadamente para facilitar a leitura. */
  fn?: string
  filters: { method: string; args: unknown[] }[]
  /** Conteúdo de insert/update ou, em uma chamada rpc, objeto com argumentos nomeados. */
  payload?: unknown
}

export type FakeResult = { data: unknown; error: unknown }

export type FakeHandler = (query: FakeQuery) => FakeResult

export interface FakeSupabase {
  from: (table: string) => unknown
  rpc: (fn: string, args?: unknown) => unknown
  /** Todas as consultas emitidas pelo código em teste, na ordem. */
  calls: FakeQuery[]
}

const CHAIN_METHODS = [
  'select',
  'eq',
  'neq',
  'in',
  'is',
  'not',
  'ilike',
  'gt',
  'gte',
  'lt',
  'lte',
  'order',
  'limit',
  'range',
] as const

/**
 * @param handlers mapa de `"<table>.<op>"` (por exemplo, "invoices.insert") para o
 * resultado que a consulta deve retornar. Chamadas RPC usam a chave
 * `"rpc.<function>"` (por exemplo, "rpc.record_invoice_payment"). Usa como alternativa o
 * nome simples da tabela ou função e, em seguida, um resultado vazio, para que os testes indiquem apenas
 * o que realmente importa.
 */
export function createFakeSupabase(handlers: Record<string, FakeHandler | FakeResult>): FakeSupabase {
  const calls: FakeQuery[] = []

  function resolve(query: FakeQuery): FakeResult {
    const key = query.op === 'rpc' ? `rpc.${query.table}` : `${query.table}.${query.op}`
    const handler = handlers[key] ?? handlers[query.table]
    if (!handler) return { data: null, error: null }
    return typeof handler === 'function' ? handler(query) : handler
  }

  function makeChain(query: FakeQuery) {
    const chain: Record<string, unknown> = {}

    for (const method of CHAIN_METHODS) {
      chain[method] = (...args: unknown[]) => {
        query.filters.push({ method, args })
        return chain
      }
    }

    chain.maybeSingle = async () => resolve(query)
    chain.single = async () => resolve(query)
    chain.then = (onFulfilled: (value: FakeResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(resolve(query)).then(onFulfilled, onRejected)

    return chain
  }

  return {
    calls,
    /**
     * Imita supabase-js: `.rpc()` retorna diretamente `{ data, error }`
     * em que data contém o retorno da função; também pode ser
     * reduzido com `.single()` quando a função retorna SETOF.
     */
    rpc(fn: string, args?: unknown) {
      const query: FakeQuery = { table: fn, op: 'rpc', fn, filters: [], payload: args }
      calls.push(query)
      return makeChain(query)
    },
    from(table: string) {
      const start = (op: FakeQuery['op'], payload?: unknown) => {
        const query: FakeQuery = { table, op, filters: [], payload }
        calls.push(query)
        return makeChain(query)
      }

      return {
        select: (...args: unknown[]) => {
          const chain = start('select') as Record<string, (...a: unknown[]) => unknown>
          return chain.select(...args)
        },
        insert: (payload: unknown) => start('insert', payload),
        update: (payload: unknown) => start('update', payload),
        delete: () => start('delete'),
      }
    },
  }
}
