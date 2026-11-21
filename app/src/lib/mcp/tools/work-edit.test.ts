import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/server'
import { createFakeSupabase, type FakeHandler, type FakeResult } from '@/lib/mcp/fake-supabase'
import { createScopedDb } from '@/lib/mcp/scoped-db'
import { registerTimeTools } from './time'
import { registerExpenseTools } from './expenses'
import type { McpCtx } from '@/lib/mcp/context'

interface Registered {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (input: any) => Promise<{ content: { text: string }[]; isError?: true }>
  description: string
}

const TIME_ENTRY = {
  id: 't1',
  business_id: 'b1',
  client_id: 'c1',
  description: 'Discovery call',
  date: '2026-08-20',
  duration_minutes: 90,
  hourly_rate: 100,
  amount: 150,
  is_billable: true,
  is_billed: false,
  invoice_id: null,
}

const EXPENSE = {
  id: 'x1',
  business_id: 'b1',
  client_id: 'c1',
  description: 'Design tool',
  vendor: 'Figma',
  category: 'software',
  date: '2026-08-20',
  amount: 45,
  currency: 'USD',
  is_billable: true,
  is_billed: false,
  invoice_id: null,
}

function setup(overrides: Record<string, FakeHandler | FakeResult> = {}) {
  const svc = createFakeSupabase({
    'time_entries.select': { data: TIME_ENTRY, error: null },
    'time_entries.update': (query) => ({ data: { ...TIME_ENTRY, ...(query.payload as object) }, error: null }),
    'time_entries.delete': { data: null, error: null },
    'expenses.select': { data: EXPENSE, error: null },
    'expenses.update': (query) => ({ data: { ...EXPENSE, ...(query.payload as object) }, error: null }),
    'expenses.delete': { data: null, error: null },
    ...overrides,
  })

  const ctx: McpCtx = {
    userId: 'u1',
    keyId: 'key1',
    businessIds: ['b1'],
    db: createScopedDb({ userId: 'u1', businessIds: ['b1'] }, svc as never),
  }

  const tools = new Map<string, Registered>()
  const server = {
    registerTool: (name: string, def: { description: string; inputSchema: unknown }, handler: unknown) => {
      tools.set(name, {
        inputSchema: def.inputSchema,
        handler: handler as Registered['handler'],
        description: def.description,
      })
    },
  } as unknown as McpServer

  registerTimeTools(server, ctx)
  registerExpenseTools(server, ctx)
  return { svc, tools }
}

function body(result: { content: { text: string }[] }) {
  return JSON.parse(result.content[0].text)
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('ferramentas de exclusão são restritas por construção', () => {
  it('aceita somente um id explícito', () => {
    const { tools } = setup()
    expect(Object.keys(tools.get('delete_time_entry')!.inputSchema.shape)).toEqual(['time_entry_id'])
    expect(Object.keys(tools.get('delete_expense')!.inputSchema.shape)).toEqual(['expense_id'])
  })

  it('exige esse id em vez de presumir uma exclusão em lote', () => {
    const { tools } = setup()
    expect(() => tools.get('delete_time_entry')!.inputSchema.parse({})).toThrow()
    expect(() => tools.get('delete_expense')!.inputSchema.parse({})).toThrow()
  })

  it('retorna os dados excluídos para que possam ser registrados novamente', async () => {
    const { tools } = setup()
    const time = body(await tools.get('delete_time_entry')!.handler({ time_entry_id: 't1' }))
    expect(time.deleted_time_entry).toMatchObject({ id: 't1', hours: 1.5, rate: 100, amount: 150 })

    const expense = body(await tools.get('delete_expense')!.handler({ expense_id: 'x1' }))
    expect(expense.deleted_expense).toMatchObject({ id: 'x1', amount: 45, currency: 'USD' })
  })

  it('limita a exclusão ao id da linha e à empresa correspondente', async () => {
    const { tools, svc } = setup()
    await tools.get('delete_time_entry')!.handler({ time_entry_id: 't1' })

    const del = svc.calls.find((c) => c.table === 'time_entries' && c.op === 'delete')!
    expect(del.filters).toContainEqual({ method: 'eq', args: ['id', 't1'] })
    expect(del.filters).toContainEqual({ method: 'eq', args: ['business_id', 'b1'] })
  })

  it('recusa uma linha que já foi faturada', async () => {
    const { tools, svc } = setup({
      'time_entries.select': { data: { ...TIME_ENTRY, invoice_id: 'inv9' }, error: null },
      'expenses.select': { data: { ...EXPENSE, invoice_id: 'inv9' }, error: null },
    })

    const time = await tools.get('delete_time_entry')!.handler({ time_entry_id: 't1' })
    expect(time.isError).toBe(true)
    expect(time.content[0].text).toContain('inv9')

    const expense = await tools.get('delete_expense')!.handler({ expense_id: 'x1' })
    expect(expense.isError).toBe(true)

    expect(svc.calls.some((c) => c.op === 'delete')).toBe(false)
  })

  it('recusa uma linha pertencente a outra empresa, por meio de ScopedDb', async () => {
    const { tools, svc } = setup({
      'time_entries.select': { data: { ...TIME_ENTRY, business_id: 'bX' }, error: null },
    })
    const result = await tools.get('delete_time_entry')!.handler({ time_entry_id: 't1' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('Lançamento de horas não encontrado')
    expect(svc.calls.some((c) => c.op === 'delete')).toBe(false)
  })
})

describe('update_time_entry', () => {
  it('recalcula o valor com base nas horas e na tarifa após a atualização', async () => {
    const { tools, svc } = setup()
    await tools.get('update_time_entry')!.handler({ time_entry_id: 't1', hours: 2 })

    const payload = svc.calls.find((c) => c.table === 'time_entries' && c.op === 'update')!.payload as Record<
      string,
      unknown
    >
    expect(payload.duration_seconds).toBe(7200)
    // A tarifa existente de 100 é aplicada às novas horas, não ao valor anterior.
    expect(payload.amount).toBe(200)
  })

  it('mantém uma tarifa null como null em vez de inventar um valor zero', async () => {
    const { tools, svc } = setup({
      'time_entries.select': { data: { ...TIME_ENTRY, hourly_rate: null, amount: null }, error: null },
    })
    await tools.get('update_time_entry')!.handler({ time_entry_id: 't1', hours: 2 })

    const payload = svc.calls.find((c) => c.table === 'time_entries' && c.op === 'update')!.payload as Record<
      string,
      unknown
    >
    expect(payload.amount).toBeNull()
  })

  it('mantém o valor inalterado quando nem as horas nem a tarifa mudam', async () => {
    const { tools, svc } = setup()
    await tools.get('update_time_entry')!.handler({ time_entry_id: 't1', description: 'Renamed' })

    const payload = svc.calls.find((c) => c.table === 'time_entries' && c.op === 'update')!.payload as Record<
      string,
      unknown
    >
    expect(payload).toEqual({ description: 'Renamed' })
  })

  it('rejeita uma atualização vazia em vez de não gravar nada silenciosamente', async () => {
    const { tools } = setup()
    const result = await tools.get('update_time_entry')!.handler({ time_entry_id: 't1' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Nada para atualizar')
  })

  it('recusa editar um lançamento que já está em uma fatura', async () => {
    const { tools, svc } = setup({
      'time_entries.select': { data: { ...TIME_ENTRY, invoice_id: 'inv9' }, error: null },
    })
    const result = await tools.get('update_time_entry')!.handler({ time_entry_id: 't1', hours: 3 })

    expect(result.isError).toBe(true)
    expect(svc.calls.some((c) => c.op === 'update')).toBe(false)
  })
})

describe('update_expense', () => {
  it('aplica somente os campos informados pelo usuário', async () => {
    const { tools, svc } = setup()
    await tools.get('update_expense')!.handler({ expense_id: 'x1', amount: 60, category: 'travel' })

    const payload = svc.calls.find((c) => c.table === 'expenses' && c.op === 'update')!.payload
    expect(payload).toEqual({ amount: 60, category: 'travel' })
  })

  it('recusa editar uma despesa que já está em uma fatura', async () => {
    const { tools, svc } = setup({ 'expenses.select': { data: { ...EXPENSE, invoice_id: 'inv9' }, error: null } })
    const result = await tools.get('update_expense')!.handler({ expense_id: 'x1', amount: 60 })

    expect(result.isError).toBe(true)
    expect(svc.calls.some((c) => c.op === 'update')).toBe(false)
  })
})

describe('ferramentas de listagem', () => {
  it('agrupa os totais de despesas por moeda em vez de somá-los entre moedas', async () => {
    const { tools } = setup({
      'expenses.select': {
        data: [
          { ...EXPENSE, id: 'x1', amount: 10, currency: 'USD' },
          { ...EXPENSE, id: 'x2', amount: 20, currency: 'EUR' },
          { ...EXPENSE, id: 'x3', amount: 5, currency: 'USD' },
        ],
        error: null,
      },
    })
    const json = body(await tools.get('list_expenses')!.handler({}))

    expect(json.totals_by_currency).toEqual([
      { currency: 'USD', total: 15 },
      { currency: 'EUR', total: 20 },
    ])
  })

  it('converte os minutos armazenados de volta em horas e calcula o total', async () => {
    const { tools } = setup({
      'time_entries.select': {
        data: [
          { ...TIME_ENTRY, id: 't1', duration_minutes: 90 },
          { ...TIME_ENTRY, id: 't2', duration_minutes: 30 },
        ],
        error: null,
      },
    })
    const json = body(await tools.get('list_time_entries')!.handler({}))

    expect(json.entries.map((e: { hours: number }) => e.hours)).toEqual([1.5, 0.5])
    expect(json.total_hours).toBe(2)
  })

  it('filtra o trabalho não faturado por invoice_id nulo, em vez de usar o indicador is_billed', async () => {
    const { tools, svc } = setup({ 'time_entries.select': { data: [], error: null } })
    await tools.get('list_time_entries')!.handler({ billed: 'unbilled' })

    const query = svc.calls.find((c) => c.table === 'time_entries')!
    expect(query.filters).toContainEqual({ method: 'is', args: ['invoice_id', null] })
  })
})
