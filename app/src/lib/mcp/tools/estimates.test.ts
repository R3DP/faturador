import { describe, it, expect, vi, beforeEach } from 'vitest'
import { addDays } from 'date-fns'
import { parseDay, toISODate } from '@/lib/dates'
import type { McpServer } from '@modelcontextprotocol/server'
import { createFakeSupabase, type FakeQuery, type FakeHandler, type FakeResult } from '@/lib/mcp/fake-supabase'
import { createScopedDb } from '@/lib/mcp/scoped-db'
import { registerEstimateTools } from './estimates'
import type { McpCtx } from '@/lib/mcp/context'

interface Registered {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (input: any) => Promise<{ content: { text: string }[]; isError?: true }>
  description: string
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

const ESTIMATE = {
  id: 'e1',
  business_id: 'b1',
  client_id: 'c1',
  estimate_number: 'EST-0007',
  status: 'accepted',
  public_id: 'estpub',
  currency: 'USD',
  issue_date: '2026-08-01',
  expiry_date: '2026-08-31',
  subtotal: 0.02,
  discount_type: 'percentage',
  discount_value: 0,
  discount_amount: 0,
  tax_rate: 0,
  tax_amount: 0,
  shipping_amount: 0,
  total: 0.02,
  notes: 'Somente a primeira etapa',
  terms: 'Pagamento líquido em 14 dias',
  converted_invoice_id: null,
}

// Três itens de meio centavo: cada um arredonda para 0,01 separadamente;
// somá-los daria 0,03, mas o subtotal correto, arredondado uma única vez, é 0,02.
const ESTIMATE_LINES = [
  { description: 'Meio centavo A', quantity: 1, rate: 0.005, sort_order: 0 },
  { description: 'Meio centavo B', quantity: 1, rate: 0.005, sort_order: 1 },
  { description: 'Meio centavo C', quantity: 1, rate: 0.005, sort_order: 2 },
]

function setup(overrides: Record<string, FakeHandler | FakeResult> = {}) {
  const svc = createFakeSupabase({
    'estimates.select': { data: ESTIMATE, error: null },
    'estimates.update': { data: null, error: null },
    'estimate_line_items.select': { data: ESTIMATE_LINES, error: null },
    'businesses.select': { data: BUSINESS, error: null },
    'businesses.update': { data: null, error: null },
    // allocate_document_number substitui atomicamente a leitura de
    // businesses.next_*_number e a gravação do valor lido + 1. Retorna o número
    // reivindicado junto com o prefixo da empresa.
    'rpc.create_estimate_document': {data: {...ESTIMATE, id: 'e9', public_id: 'pub9', estimate_number: 'EST-0007', status: 'draft', subtotal:450,total:450},error:null},
    'rpc.allocate_document_number': (query) => {
      const kind = (query.payload as { p_kind: string }).p_kind
      return kind === 'estimate'
        ? { data: { doc_number: BUSINESS.next_estimate_number, doc_prefix: BUSINESS.estimate_prefix }, error: null }
        : { data: { doc_number: BUSINESS.next_invoice_number, doc_prefix: BUSINESS.invoice_prefix }, error: null }
    },
    // assertClientAccess termina em maybeSingle (uma linha); a busca de nome de
    // resolveClient usa ilike e retorna uma lista.
    'clients.select': (query) =>
      query.filters.some((f) => f.method === 'ilike')
        ? { data: [CLIENT], error: null }
        : { data: CLIENT, error: null },
    'invoices.insert': (query) => ({
      data: { ...(query.payload as object), id: 'inv1', public_id: 'invpub' },
      error: null,
    }),
    'invoice_line_items.insert': { data: null, error: null },
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
      tools.set(name, { inputSchema: def.inputSchema, handler: handler as Registered['handler'], description: def.description })
    },
  } as unknown as McpServer

  registerEstimateTools(server, ctx)

  return { svc, tools, ctx }
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

describe('interface das ferramentas de orçamento', () => {
  it('registra exatamente as seis ferramentas de orçamento', () => {
    const { tools } = setup()
    expect([...tools.keys()].sort()).toEqual([
      'convert_estimate_to_invoice',
      'create_estimate',
      'get_estimate',
      'list_estimates',
      'send_estimate',
      'update_draft_estimate',
    ])
  })

  it('informa ao agente quando NÃO usar cada ferramenta', () => {
    const { tools } = setup()
    for (const [name, tool] of tools) {
      expect(tool.description.length, `${name} precisa de uma descrição clara`).toBeGreaterThan(80)
      expect(/não|recusa|em vez|NÃO/i.test(tool.description), `${name} precisa de uma orientação sobre quando não usar`).toBe(
        true
      )
    }
  })

  it('não usa travessões longos nas descrições das ferramentas', () => {
    const { tools } = setup()
    for (const [name, tool] of tools) {
      expect(tool.description, `${name}`).not.toContain('\u2014')
    }
  })

  it('descreve todos os campos de entrada, pois o agente lê esse texto', () => {
    const { tools } = setup()
    for (const [name, tool] of tools) {
      for (const [field, schema] of Object.entries(tool.inputSchema.shape)) {
        expect((schema as { description?: string }).description, `${name}.${field}`).toBeTruthy()
      }
    }
  })
})

/**
 * Simulação com estado da RPC convert_estimate_to_invoice.
 *
 * Ela modela a propriedade que a RPC deve garantir: a reivindicação
 * condicional tem sucesso para exatamente UMA chamada; todas as seguintes
 * recebem a informação de que o orçamento já foi convertido e a fatura
 * existente. `conversions` conta quantas faturas foram realmente criadas,
 * valor verificado pelo teste de repetição.
 */
function conversionRpc(overrides: Partial<Record<string, unknown>> = {}) {
  const state = { conversions: 0, invoice: null as Record<string, unknown> | null }

  const handler: FakeHandler = (query) => {
    const args = query.payload as Record<string, unknown>
    if (state.invoice) {
      // Perdeu a reivindicação. Nada é gravado; a fatura da chamada vencedora é retornada.
      return {
        data: { claimed: false, invoice: state.invoice, invoice_number: state.invoice.invoice_number },
        error: null,
      }
    }
    state.conversions += 1
    state.invoice = {
      id: 'inv1',
      public_id: 'invpub',
      business_id: 'b1',
      client_id: 'c1',
      invoice_number: 'INV-0042',
      status: 'draft',
      issue_date: args.p_issue_date,
      due_date: args.p_due_date,
      currency: 'USD',
      subtotal: args.p_subtotal,
      total: args.p_total,
      balance_due: args.p_total,
      ...overrides,
    }
    return {
      data: { claimed: true, invoice: state.invoice, invoice_number: state.invoice.invoice_number },
      error: null,
    }
  }

  return { state, handler }
}

function convertSetup(overrides: Record<string, FakeHandler | FakeResult> = {}) {
  const rpc = conversionRpc()
  const harness = setup({ 'rpc.convert_estimate_to_invoice': rpc.handler, ...overrides })
  return { ...harness, rpc }
}

function rpcCalls(svc: { calls: FakeQuery[] }, fn: string) {
  return svc.calls.filter((c) => c.op === 'rpc' && c.table === fn)
}

describe('convert_estimate_to_invoice', () => {
  it('preserva o total informado ao converter orçamentos antigos', async () => {
    const { tools, svc } = convertSetup()
    const result = await tools.get('convert_estimate_to_invoice')!.handler({ estimate_id: 'e1' })

    const args = rpcCalls(svc, 'convert_estimate_to_invoice')[0].payload as Record<string, unknown>
    expect(args.p_subtotal).toBe(0.02)
    expect(args.p_total).toBe(0.02)
    // Três itens de meio centavo: cada um arredonda para 0,01, mas o subtotal é
    // arredondado uma única vez sobre a soma bruta de 0,015, resultando em 0,02, não 0,03.
    expect((args.p_line_items as { amount: number }[]).map((l) => l.amount)).toEqual([0.01, 0.01, 0.01])
    expect(body(result).invoice.total).toBe(0.02)
    expect(body(result).invoice.balance_due).toBe(0.02)
  })

  it('faz a reivindicação, a fatura e os itens em uma chamada, em vez de três gravações', async () => {
    const { tools, svc } = convertSetup()
    await tools.get('convert_estimate_to_invoice')!.handler({ estimate_id: 'e1' })

    expect(rpcCalls(svc, 'convert_estimate_to_invoice')).toHaveLength(1)
    // O fluxo antigo inseria a fatura e seus itens e depois atualizava o orçamento,
    // sem bloqueio nem gravação condicional entre essas operações.
    expect(svc.calls.some((c) => c.table === 'invoices' && c.op === 'insert')).toBe(false)
    expect(svc.calls.some((c) => c.table === 'invoice_line_items' && c.op === 'insert')).toBe(false)
    expect(svc.calls.some((c) => c.table === 'estimates' && c.op === 'update')).toBe(false)
    // O número da fatura também é alocado na mesma transação, não por uma
    // leitura seguida de gravação separada em businesses.next_invoice_number.
    expect(svc.calls.some((c) => c.table === 'businesses' && c.op === 'update')).toBe(false)
  })

  it('envia os itens do orçamento e a origem do agente à RPC', async () => {
    const { tools, svc } = convertSetup()
    await tools.get('convert_estimate_to_invoice')!.handler({ estimate_id: 'e1' })

    const args = rpcCalls(svc, 'convert_estimate_to_invoice')[0].payload as Record<string, unknown>
    expect(args.p_estimate_id).toBe('e1')
    expect(args.p_created_via).toBe('agent')
    expect(args.p_created_by_key_id).toBe('key1')
    expect(typeof args.p_public_id).toBe('string')
    expect((args.p_public_id as string).length).toBeGreaterThan(0)
  })

  it('usa o prazo de pagamento da empresa como padrão para o vencimento', async () => {
    const { tools, svc } = convertSetup()
    await tools.get('convert_estimate_to_invoice')!.handler({ estimate_id: 'e1', issue_date: '2026-09-01' })

    const args = rpcCalls(svc, 'convert_estimate_to_invoice')[0].payload as Record<string, unknown>
    expect(args.p_issue_date).toBe('2026-09-01')
    // Usa a mesma expressão de create_invoice para que conversão e criação direta
    // não divirjam no tratamento de datas. Antes, o código usava
    // `format(addDays(new Date('2026-09-01'), 14), 'yyyy-MM-dd')`, que interpreta
    // a string como meia-noite UTC e, por isso, esperava 2026-09-14 em qualquer
    // fuso com deslocamento negativo. 1º de setembro + 14 dias é 15 de setembro.
    // Consulte src/lib/dates.ts.
    expect(args.p_due_date).toBe('2026-09-15')
    expect(args.p_due_date).toBe(toISODate(addDays(parseDay('2026-09-01'), 14)))
  })

  it('recusa um orçamento de outra empresa por meio de ScopedDb', async () => {
    const { tools, svc } = convertSetup({
      'estimates.select': { data: { ...ESTIMATE, business_id: 'bX' }, error: null },
    })
    const result = await tools.get('convert_estimate_to_invoice')!.handler({ estimate_id: 'e1' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('Orçamento não encontrado')
    expect(rpcCalls(svc, 'convert_estimate_to_invoice')).toHaveLength(0)
  })

  it('recusa um orçamento recusado antes de chegar à reivindicação', async () => {
    const { tools, svc } = convertSetup({
      'estimates.select': { data: { ...ESTIMATE, status: 'declined' }, error: null },
    })
    const result = await tools.get('convert_estimate_to_invoice')!.handler({ estimate_id: 'e1' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('declined')
    expect(rpcCalls(svc, 'convert_estimate_to_invoice')).toHaveLength(0)
  })

  it('recusa um orçamento sem itens em vez de faturar zero', async () => {
    const { tools, svc } = convertSetup({ 'estimate_line_items.select': { data: [], error: null } })
    const result = await tools.get('convert_estimate_to_invoice')!.handler({ estimate_id: 'e1' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('não há nada a faturar')
    expect(rpcCalls(svc, 'convert_estimate_to_invoice')).toHaveLength(0)
  })

  it('indica no resumo quando o orçamento não foi formalmente aceito', async () => {
    const { tools } = convertSetup({ 'estimates.select': { data: { ...ESTIMATE, status: 'sent' }, error: null } })
    const result = await tools.get('convert_estimate_to_invoice')!.handler({ estimate_id: 'e1' })
    expect(body(result).summary).toContain('sem aprovação formal')
  })

  it('não cria nada e informa isso quando a RPC falha', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { tools } = convertSetup({
      'rpc.convert_estimate_to_invoice': { data: null, error: { message: 'deadlock detected' } },
    })
    const result = await tools.get('convert_estimate_to_invoice')!.handler({ estimate_id: 'e1' })

    expect(result.isError).toBe(true)
    // Agora a conversão inteira ocorre em uma transação, então não há estado
    // parcialmente gravado sobre o qual seja necessário alertar a chamada.
    expect(result.content[0].text).toContain('nada foi criado')
  })
})

describe('segurança na repetição de convert_estimate_to_invoice', () => {
  it('cria exatamente uma fatura quando o mesmo orçamento é convertido duas vezes ao mesmo tempo', async () => {
    const rpc = conversionRpc()
    const { tools, svc } = setup({
      'rpc.convert_estimate_to_invoice': rpc.handler,
      'invoice_line_items.select': {
        data: [{ description: 'Meio centavo A', quantity: 1, rate: 0.005, amount: 0.01, sort_order: 0 }],
        error: null,
      },
    })

    // As duas chamadas leem o orçamento antes de qualquer gravação, exatamente
    // a intercalação que a antiga verificação por leitura e gravação não suportava:
    // ambas passavam pela checagem "ainda não convertido" e criavam uma fatura.
    const [first, second] = await Promise.all([
      tools.get('convert_estimate_to_invoice')!.handler({ estimate_id: 'e1' }),
      tools.get('convert_estimate_to_invoice')!.handler({ estimate_id: 'e1' }),
    ])

    // UMA fatura e, portanto, um único número de fatura consumido.
    expect(rpc.state.conversions).toBe(1)
    expect(rpcCalls(svc, 'convert_estimate_to_invoice')).toHaveLength(2)

    // Nenhuma chamada informa falha: a perdedora converge para o resultado da vencedora.
    expect(first.isError).toBeUndefined()
    expect(second.isError).toBeUndefined()

    const bodies = [body(first), body(second)]
    expect(bodies.filter((b) => b.already_converted === false)).toHaveLength(1)
    expect(bodies.filter((b) => b.already_converted === true)).toHaveLength(1)

    // Ambas apontam para a mesma fatura, para que o agente que repetiu a chamada
    // não conclua que existem duas faturas.
    expect(bodies.map((b) => b.invoice.id)).toEqual(['inv1', 'inv1'])
    expect(bodies.map((b) => b.invoice.invoice_number)).toEqual(['INV-0042', 'INV-0042'])
    expect(bodies.map((b) => b.estimate.converted_invoice_id)).toEqual(['inv1', 'inv1'])

    const loser = bodies.find((b) => b.already_converted)!
    expect(loser.summary).toContain('não existe uma segunda fatura')
  })

  it('retorna a fatura existente, sem erro, quando o orçamento já foi convertido', async () => {
    const { tools, svc } = setup({
      'estimates.select': { data: { ...ESTIMATE, status: 'converted', converted_invoice_id: 'inv0' }, error: null },
      // assertInvoiceAccess lê a fatura vinculada.
      'invoices.select': {
        data: {
          id: 'inv0',
          public_id: 'invpub0',
          business_id: 'b1',
          client_id: 'c1',
          invoice_number: 'INV-0041',
          status: 'draft',
          issue_date: '2026-08-02',
          due_date: '2026-08-16',
          currency: 'USD',
          subtotal: 0.02,
          total: 0.02,
          balance_due: 0.02,
        },
        error: null,
      },
      'invoice_line_items.select': {
        data: [{ description: 'Meio centavo A', quantity: 1, rate: 0.005, amount: 0.01, sort_order: 0 }],
        error: null,
      },
    })

    const result = await tools.get('convert_estimate_to_invoice')!.handler({ estimate_id: 'e1' })
    const json = body(result)

    expect(result.isError).toBeUndefined()
    expect(json.already_converted).toBe(true)
    expect(json.invoice.id).toBe('inv0')
    expect(json.invoice.invoice_number).toBe('INV-0041')
    expect(json.invoice.line_items).toHaveLength(1)
    // Importante: nem sequer houve uma segunda tentativa de conversão.
    expect(rpcCalls(svc, 'convert_estimate_to_invoice')).toHaveLength(0)
  })

  it('recusa em vez de adivinhar quando o vínculo da conversão não pode ser acessado', async () => {
    const { tools, svc } = setup({
      'estimates.select': { data: { ...ESTIMATE, status: 'converted', converted_invoice_id: 'inv0' }, error: null },
      'invoices.select': { data: null, error: null },
    })
    const result = await tools.get('convert_estimate_to_invoice')!.handler({ estimate_id: 'e1' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('inv0')
    expect(rpcCalls(svc, 'convert_estimate_to_invoice')).toHaveLength(0)
  })
})

describe('create_estimate', () => {
  it('usa o preço do catálogo de itens salvos e registra a origem', async () => {
    const { tools, svc } = setup({
      'items.select': {
        data: [
          {
            id: 'i1',
            business_id: 'b1',
            name: 'Consultoria',
            description: 'Serviços de consultoria',
            rate: 150,
            unit: 'hour',
            tax_rate: 0,
            type: 'service',
            is_active: true,
          },
        ],
        error: null,
      },
      'estimates.insert': (query) => ({
        data: { ...(query.payload as object), id: 'e9', public_id: 'pub9' },
        error: null,
      }),
      'estimate_line_items.insert': { data: null, error: null },
    })

    const result = await tools.get('create_estimate')!.handler({
      client_name: 'Globex',
      line_items: [{ item_name: 'Consultoria', quantity: 3 }],
    })

    const created = rpcCalls(svc, 'create_estimate_document')
    expect(created).toHaveLength(1)
    expect(created[0].payload).toMatchObject({p_business_id:'b1',p_client_id:'c1',p_key_id:'key1',p_lines:[{description:'Serviços de consultoria',quantity:3,rate:150}]})
    expect(body(result).estimate.line_items[0]).toEqual({
      description: 'Serviços de consultoria',
      quantity: 3,
      rate: 150,
      amount: 450,
    })
  })

  it('obtém o número do orçamento por allocate_document_number, sem leitura seguida de gravação', async () => {
    const { tools, svc } = setup({
      'estimates.insert': (query) => ({
        data: { ...(query.payload as object), id: 'e9', public_id: 'pub9' },
        error: null,
      }),
    })

    await tools.get('create_estimate')!.handler({
      client_name: 'Globex',
      line_items: [{ description: 'Work', quantity: 1, rate: 10 }],
    })

    const allocations = rpcCalls(svc, 'create_estimate_document')
    expect(allocations).toHaveLength(1)
    expect(allocations[0].payload).toMatchObject({ p_business_id: 'b1', p_client_id: 'c1' })
    // O código antigo gravava manualmente businesses.next_estimate_number = lido + 1;
    // duas criações simultâneas podiam calcular o valor com base na mesma leitura.
    expect(svc.calls.some((c) => c.table === 'businesses' && c.op === 'update')).toBe(false)
  })

  it('falha sem gravar o orçamento quando não é possível alocar um número', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { tools, svc } = setup({
      'rpc.create_estimate_document': { data: null, error: { message: 'forbidden' } },
    })

    const result = await tools.get('create_estimate')!.handler({
      client_name: 'Globex',
      line_items: [{ description: 'Work', quantity: 1, rate: 10 }],
    })

    expect(result.isError).toBe(true)
    expect(svc.calls.some((c) => c.table === 'estimates' && c.op === 'insert')).toBe(false)
  })
})

/**
 * update_draft_estimate agora usa replace_estimate_line_items em vez de excluir
 * as linhas antigas e inserir as novas em duas operações separadas, com uma
 * restauração manual entre elas. Essa restauração também podia falhar e, nesse
 * caso, a ferramenta precisava avisar que o orçamento ficara sem itens.
 */
describe('update_draft_estimate', () => {
  const DRAFT = { ...ESTIMATE, status: 'draft' }

  function updateSetup(overrides: Record<string, FakeHandler | FakeResult> = {}) {
    return setup({
      'estimates.select': { data: DRAFT, error: null },
      'rpc.replace_estimate_line_items': (query) => ({
        data: { ...DRAFT, ...((query.payload as { p_estimate_patch: object }).p_estimate_patch ?? {}) },
        error: null,
      }),
      ...overrides,
    })
  }

  it('substitui os itens e os totais em uma única transação', async () => {
    const { tools, svc } = updateSetup()
    const result = await tools.get('update_draft_estimate')!.handler({
      estimate_id: 'e1',
      line_items: [{ description: 'Retrabalho', quantity: 2, rate: 125 }],
    })

    const calls = rpcCalls(svc, 'replace_estimate_line_items')
    expect(calls).toHaveLength(1)
    const args = calls[0].payload as Record<string, never>
    expect(args.p_estimate_id).toBe('e1')
    expect(args.p_line_items).toEqual([{ description: 'Retrabalho', quantity: 2, rate: 125, amount: 250 }])
    expect((args.p_estimate_patch as { total: number }).total).toBe(250)
    expect((args.p_estimate_patch as { subtotal: number }).subtotal).toBe(250)

    // A sequência de excluir e inserir, e o intervalo entre as operações, foi eliminada.
    expect(svc.calls.some((c) => c.table === 'estimate_line_items' && c.op === 'delete')).toBe(false)
    expect(svc.calls.some((c) => c.table === 'estimate_line_items' && c.op === 'insert')).toBe(false)
    expect(body(result).estimate.total).toBe(250)
  })

  it('mantém os itens armazenados intactos quando somente os campos principais mudam', async () => {
    const { tools, svc } = updateSetup({
      'estimates.update': (query) => ({ data: { ...DRAFT, ...(query.payload as object) }, error: null }),
    })
    await tools.get('update_draft_estimate')!.handler({ estimate_id: 'e1', notes: 'Escopo revisado' })

    // Sem substituição, não há motivo para regravar os itens: um UPDATE simples
    // já é atômico por si só.
    expect(rpcCalls(svc, 'replace_estimate_line_items')).toHaveLength(0)
    const patch = payloadOf(svc, 'estimates', 'update')!
    expect(patch.notes).toBe('Escopo revisado')
    // Recalculado a partir dos itens de meio centavo armazenados, ainda arredondados uma única vez.
    expect(patch.total).toBe(0.03)
  })

  it('recusa um orçamento que já não está em rascunho', async () => {
    const { tools, svc } = updateSetup({ 'estimates.select': { data: ESTIMATE, error: null } })
    const result = await tools.get('update_draft_estimate')!.handler({
      estimate_id: 'e1',
      line_items: [{ description: 'Retrabalho', quantity: 1, rate: 10 }],
    })

    expect(result.isError).toBe(true)
    expect(rpcCalls(svc, 'replace_estimate_line_items')).toHaveLength(0)
  })

  it('nunca informa que um orçamento ficou sem itens, pois esse estado não pode ocorrer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { tools } = updateSetup({
      'rpc.replace_estimate_line_items': { data: null, error: { message: 'deadlock detected' } },
    })
    const result = await tools.get('update_draft_estimate')!.handler({
      estimate_id: 'e1',
      line_items: [{ description: 'Retrabalho', quantity: 1, rate: 10 }],
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('não foi alterado')
    expect(result.content[0].text).not.toContain('sem itens')
  })
})
