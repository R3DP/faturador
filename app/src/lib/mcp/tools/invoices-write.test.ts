import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/server'
import { createFakeSupabase, type FakeQuery, type FakeHandler, type FakeResult } from '@/lib/mcp/fake-supabase'
import { createScopedDb } from '@/lib/mcp/scoped-db'
import { registerInvoiceWriteTools } from './invoices-write'
import type { McpCtx } from '@/lib/mcp/context'

interface Registered {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (input: any) => Promise<{ content: { text: string }[]; isError?: true }>
}

const BUSINESS = {
  id: 'b1',
  name: 'Acme',
  default_currency: 'USD',
  default_payment_terms: 14,
  invoice_prefix: 'INV',
  next_invoice_number: 42,
  estimate_prefix: 'EST',
  next_estimate_number: 7,
  invoice_notes: null,
  invoice_footer: null,
}

const CLIENT = { id: 'c1', business_id: 'b1', name: 'Globex', currency: 'USD', email: 'ap@globex.test' }

const DRAFT_INVOICE = {
  id: 'inv1',
  business_id: 'b1',
  client_id: 'c1',
  public_id: 'invpub',
  invoice_number: 'INV-0042',
  status: 'draft',
  currency: 'USD',
  issue_date: '2026-08-01',
  due_date: '2026-08-15',
  subtotal: 100,
  discount_type: 'percentage',
  discount_value: 0,
  discount_amount: 0,
  tax_rate: 0,
  tax_amount: 0,
  shipping_amount: 0,
  total: 100,
  amount_paid: 0,
  balance_due: 100,
  notes: null,
}

const STORED_LINES = [{ description: 'Original', quantity: 1, rate: 100, sort_order: 0 }]

function setup(overrides: Record<string, FakeHandler | FakeResult> = {}) {
  const svc = createFakeSupabase({
    'businesses.select': { data: BUSINESS, error: null },
    'clients.select': (query) =>
      query.filters.some((f) => f.method === 'ilike')
        ? { data: [CLIENT], error: null }
        : { data: CLIENT, error: null },
    'invoices.select': { data: DRAFT_INVOICE, error: null },
    'invoices.insert': (query) => ({
      data: { ...(query.payload as object), id: 'inv1', public_id: 'invpub' },
      error: null,
    }),
    'invoices.update': (query) => ({ data: { ...DRAFT_INVOICE, ...(query.payload as object) }, error: null }),
    'invoice_line_items.select': { data: STORED_LINES, error: null },
    'invoice_line_items.insert': { data: null, error: null },
    'rpc.create_invoice_document': {
      data: DRAFT_INVOICE,
      error: null,
    },
    'rpc.replace_invoice_line_items': (query) => ({
      data: { ...DRAFT_INVOICE, ...((query.payload as { p_invoice_patch: object }).p_invoice_patch ?? {}) },
      error: null,
    }),
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
    registerTool: (name: string, _def: unknown, handler: unknown) => {
      tools.set(name, { handler: handler as Registered['handler'] })
    },
  } as unknown as McpServer

  registerInvoiceWriteTools(server, ctx)
  return { svc, tools }
}

function rpcCalls(svc: { calls: FakeQuery[] }, fn: string) {
  return svc.calls.filter((c) => c.op === 'rpc' && c.table === fn)
}

function payloadOf(svc: { calls: FakeQuery[] }, table: string, op: FakeQuery['op']) {
  return svc.calls.find((c) => c.table === table && c.op === op)?.payload as Record<string, unknown> | undefined
}

function body(result: { content: { text: string }[] }) {
  return JSON.parse(result.content[0].text)
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('numeração de create_invoice', () => {
  it('cria a fatura e reserva o trabalho em uma transação que pode ser repetida', async () => {
    const { tools, svc } = setup()
    await tools.get('create_invoice')!.handler({
      client_name: 'Globex',
      request_id: '10000000-0000-4000-8000-000000000001',
      line_items: [{ description: 'Work', quantity: 2, rate: 50 }],
    })

    const calls = rpcCalls(svc, 'create_invoice_document')
    expect(calls).toHaveLength(1)
    expect(calls[0].payload).toMatchObject({ p_business_id: 'b1', p_client_id: 'c1', p_request_id: '10000000-0000-4000-8000-000000000001' })
    expect(payloadOf(svc, 'invoices', 'insert')).toBeUndefined()

    // O contador é incrementado dentro dessa mesma instrução. Atualizar
    // businesses.next_invoice_number = read + 1 manualmente, como este fluxo
    // substitui, fazia duas criações simultâneas receberem o mesmo número.
    expect(svc.calls.some((c) => c.table === 'businesses' && c.op === 'update')).toBe(false)
  })

  it('não grava nenhuma fatura quando não é possível atribuir um número', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { tools, svc } = setup({
      'rpc.create_invoice_document': { data: null, error: { message: 'forbidden' } },
    })
    const result = await tools.get('create_invoice')!.handler({
      client_name: 'Globex',
      request_id: '10000000-0000-4000-8000-000000000001',
      line_items: [{ description: 'Work', quantity: 1, rate: 10 }],
    })

    expect(result.isError).toBe(true)
    expect(svc.calls.some((c) => c.table === 'invoices' && c.op === 'insert')).toBe(false)
  })
})

/**
 * Faturamento do trabalho acordado conforme o cronograma do contrato. A camada
 * da ferramenta envia somente os IDs: a descrição do item, o valor e a reserva
 * que o marca como faturado são definidos em SQL dentro da mesma transação,
 * evitando que o item seja reprecificado aqui ou apareça em duas faturas.
 */
describe('create_invoice a partir dos itens do contrato', () => {
  it('envia os IDs dos itens à RPC sem calcular os valores', async () => {
    const { tools, svc } = setup()
    const result = body(
      await tools.get('create_invoice')!.handler({
        client_name: 'Globex',
        request_id: '10000000-0000-4000-8000-000000000001',
        engagement_entry_ids: ['ent1', 'ent2'],
      })
    )

    const call = rpcCalls(svc, 'create_invoice_document')[0]
    expect(call.payload).toMatchObject({ p_engagement_entry_ids: ['ent1', 'ent2'] })
    // Nenhum item foi informado diretamente: o cronograma os fornece.
    expect((call.payload as { p_lines: unknown[] }).p_lines).toEqual([])
    expect(result.billed_engagement_entry_ids).toEqual(['ent1', 'ent2'])
    expect(result.summary).toContain('não poderão ser faturados novamente')
  })

  it('envia uma lista vazia quando nenhum item foi solicitado', async () => {
    const { tools, svc } = setup()
    const result = body(
      await tools.get('create_invoice')!.handler({
        client_name: 'Globex',
        request_id: '10000000-0000-4000-8000-000000000001',
        line_items: [{ description: 'Work', quantity: 1, rate: 10 }],
      })
    )
    expect(rpcCalls(svc, 'create_invoice_document')[0].payload).toMatchObject({
      p_engagement_entry_ids: [],
    })
    expect(result.summary).not.toContain('não poderão ser faturados novamente')
  })

  it('transmite a recusa de faturamento duplicado com uma orientação útil', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { tools, svc } = setup({
      'rpc.create_invoice_document': {
        data: null,
        error: { message: 'engagement_entry_already_invoiced' },
      },
    })
    const result = await tools.get('create_invoice')!.handler({
      client_name: 'Globex',
      request_id: '10000000-0000-4000-8000-000000000001',
      engagement_entry_ids: ['ent1'],
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('já está em uma fatura')
    expect(svc.calls.some((c) => c.table === 'invoices' && c.op === 'insert')).toBe(false)
  })

  it('explica que o item ainda não pode ser faturado', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { tools } = setup({
      'rpc.create_invoice_document': {
        data: null,
        error: { message: 'engagement_entry_not_ready' },
      },
    })
    const result = await tools.get('create_invoice')!.handler({
      client_name: 'Globex',
      request_id: '10000000-0000-4000-8000-000000000001',
      engagement_entry_ids: ['ent1'],
    })
    expect(result.content[0].text).toContain('ainda não está pronto para faturar')
  })

  it('explica a divergência de moeda sem converter valores', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { tools } = setup({
      'rpc.create_invoice_document': {
        data: null,
        error: { message: 'engagement_entry_currency_mismatch' },
      },
    })
    const result = await tools.get('create_invoice')!.handler({
      client_name: 'Globex',
      request_id: '10000000-0000-4000-8000-000000000001',
      currency: 'EUR',
      engagement_entry_ids: ['ent1'],
    })
    expect(result.content[0].text).toContain('nunca converte valores')
  })
})

/**
 * update_draft_invoice agora usa replace_invoice_line_items em vez de excluir
 * as linhas armazenadas, inserir as novas e tentar reinserir as anteriores em
 * caso de falha. Se a restauração também falhasse, a fatura ficava com um total,
 * mas sem itens, e a ferramenta pedia ao solicitante que corrigisse o documento
 * manualmente.
 */
describe('update_draft_invoice', () => {
  it('substitui os itens e os totais em uma única transação', async () => {
    const { tools, svc } = setup()
    const result = await tools.get('update_draft_invoice')!.handler({
      invoice_id: 'inv1',
      line_items: [{ description: 'Rework', quantity: 2, rate: 125 }],
    })

    const calls = rpcCalls(svc, 'replace_invoice_line_items')
    expect(calls).toHaveLength(1)
    const args = calls[0].payload as Record<string, never>
    expect(args.p_invoice_id).toBe('inv1')
    expect(args.p_line_items).toEqual([{ description: 'Rework', quantity: 2, rate: 125, amount: 250 }])
    expect((args.p_invoice_patch as { total: number }).total).toBe(250)

    // balance_due nunca é enviado: a RPC o calcula como total - amount_paid,
    // para que a edição da fatura não apague pagamentos já registrados.
    expect(args.p_invoice_patch).not.toHaveProperty('balance_due')

    expect(svc.calls.some((c) => c.table === 'invoice_line_items' && c.op === 'delete')).toBe(false)
    expect(svc.calls.some((c) => c.table === 'invoice_line_items' && c.op === 'insert')).toBe(false)
    expect(body(result).invoice.total).toBe(250)
  })

  it('mantém os itens armazenados quando somente os campos do cabeçalho mudam', async () => {
    const { tools, svc } = setup()
    await tools.get('update_draft_invoice')!.handler({ invoice_id: 'inv1', notes: 'Revised' })

    expect(rpcCalls(svc, 'replace_invoice_line_items')).toHaveLength(0)
    const patch = payloadOf(svc, 'invoices', 'update')!
    expect(patch.notes).toBe('Revised')
    // Recalculado com base no item armazenado, sem alterações.
    expect(patch.total).toBe(100)
  })

  it('recusa uma fatura que não está mais em rascunho', async () => {
    const { tools, svc } = setup({
      'invoices.select': { data: { ...DRAFT_INVOICE, status: 'sent' }, error: null },
    })
    const result = await tools.get('update_draft_invoice')!.handler({
      invoice_id: 'inv1',
      line_items: [{ description: 'Rework', quantity: 1, rate: 10 }],
    })

    expect(result.isError).toBe(true)
    expect(rpcCalls(svc, 'replace_invoice_line_items')).toHaveLength(0)
  })

  it('recusa, via ScopedDb, uma fatura que pertence a outra empresa', async () => {
    const { tools, svc } = setup({
      'invoices.select': { data: { ...DRAFT_INVOICE, business_id: 'bX' }, error: null },
    })
    const result = await tools.get('update_draft_invoice')!.handler({
      invoice_id: 'inv1',
      line_items: [{ description: 'Rework', quantity: 1, rate: 10 }],
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('Fatura não encontrada')
    expect(rpcCalls(svc, 'replace_invoice_line_items')).toHaveLength(0)
  })

  it('nunca informa que a fatura ficou sem itens, pois esse estado não pode ocorrer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { tools } = setup({
      'rpc.replace_invoice_line_items': { data: null, error: { message: 'deadlock detected' } },
    })
    const result = await tools.get('update_draft_invoice')!.handler({
      invoice_id: 'inv1',
      line_items: [{ description: 'Rework', quantity: 1, rate: 10 }],
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('não foi alterada')
    expect(result.content[0].text).not.toContain('sem itens de linha')
  })
})
