import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/server'
import { createFakeSupabase, type FakeHandler, type FakeResult } from '@/lib/mcp/fake-supabase'
import { createScopedDb } from '@/lib/mcp/scoped-db'
import { registerPaymentTools, reconcilePayments } from './payments'
import { registerInvoiceSendTools } from './invoices-send'
import type { McpCtx } from '@/lib/mcp/context'

interface Registered {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (input: any) => Promise<{ content: { text: string }[]; isError?: true }>
}

const INVOICE = {
  id: 'inv1',
  business_id: 'b1',
  client_id: 'c1',
  public_id: 'pub1',
  invoice_number: 'INV-0042',
  status: 'partial',
  currency: 'USD',
  total: 1000,
  amount_paid: 400,
  balance_due: 600,
  due_date: '2099-01-01',
  paid_at: null,
}

const PAYMENTS = [
  {
    id: 'pay1',
    amount: 250,
    payment_date: '2026-08-01',
    payment_method: 'bank_transfer',
    reference_number: 'REF-1',
    notes: null,
    created_via: 'web',
    stripe_payment_id: null,
    source: 'manual',
    voided_at: null,
    void_reason: null,
  },
  {
    id: 'pay2',
    amount: 150,
    payment_date: '2026-08-10',
    payment_method: 'credit_card',
    reference_number: null,
    notes: null,
    created_via: 'stripe',
    stripe_payment_id: 'pi_123',
    source: 'stripe',
    voided_at: null,
    void_reason: null,
  },
]

const VOIDED_PAYMENT = {
  id: 'pay3',
  amount: 500,
  payment_date: '2026-08-15',
  payment_method: 'check',
  reference_number: 'REF-DUP',
  notes: null,
  created_via: 'web',
  stripe_payment_id: null,
  source: 'manual',
  voided_at: '2026-09-01T10:00:00Z',
  void_reason: 'Recorded twice',
}

function setup(overrides: Record<string, FakeHandler | FakeResult> = {}) {
  const svc = createFakeSupabase({
    'invoices.select': { data: INVOICE, error: null },
    'payments.select': { data: PAYMENTS, error: null },
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

  registerPaymentTools(server, ctx)
  // record_payment fica junto de send_invoice, não de get_payment_status, mas
  // é a parte de gravação do mesmo fluxo financeiro e por isso é testado aqui
  // ao lado da parte de leitura.
  registerInvoiceSendTools(server, ctx)
  return { svc, tools }
}

function rpcCalls(svc: { calls: { op: string; table: string; payload?: unknown }[] }, fn: string) {
  return svc.calls.filter((c) => c.op === 'rpc' && c.table === fn)
}

function body(result: { content: { text: string }[] }) {
  return JSON.parse(result.content[0].text)
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('reconcilePayments', () => {
  it('soma o histórico e confere com o valor amount_paid armazenado correspondente', () => {
    expect(reconcilePayments([{ amount: 250 }, { amount: 150 }], 400)).toEqual({
      ledger_total: 400,
      recorded_amount_paid: 400,
      mismatch: false,
    })
  })

  it('sinaliza quando o histórico diverge da fatura', () => {
    expect(reconcilePayments([{ amount: 250 }], 400).mismatch).toBe(true)
  })

  it('arredonda diferenças de ponto flutuante para centavos, sem indicar divergência indevida', () => {
    expect(reconcilePayments([{ amount: 0.1 }, { amount: 0.2 }], 0.3)).toEqual({
      ledger_total: 0.3,
      recorded_amount_paid: 0.3,
      mismatch: false,
    })
  })

  it('considera consistente um histórico vazio com saldo zero', () => {
    expect(reconcilePayments([], 0).mismatch).toBe(false)
  })
})

describe('get_payment_status', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('informa o valor devido, o valor pago e o histórico de pagamentos', async () => {
    const { tools } = setup()
    const result = await tools.get('get_payment_status')!.handler({ invoice_id: 'inv1' })
    const json = body(result)

    expect(json.invoice).toMatchObject({ total: 1000, amount_paid: 400, balance_due: 600 })
    expect(json.payments).toHaveLength(2)
    expect(json.payments_count).toBe(2)
    expect(json.reconciliation).toMatchObject({ ledger_total: 400, mismatch: false })
    expect(json.summary).toContain('$400.00 pagos')
    expect(json.summary).toContain('$600.00 ainda a pagar')
  })

  it('consulta o histórico de pagamentos', async () => {
    const { tools, svc } = setup()
    await tools.get('get_payment_status')!.handler({ invoice_id: 'inv1' })

    expect(svc.calls.some((c) => c.table === 'payments')).toBe(true)
  })

  it('limita a consulta do histórico à fatura e à empresa correspondentes', async () => {
    const { tools, svc } = setup()
    await tools.get('get_payment_status')!.handler({ invoice_id: 'inv1' })

    const ledgerQuery = svc.calls.find((c) => c.table === 'payments')!
    expect(ledgerQuery.filters).toContainEqual({ method: 'eq', args: ['invoice_id', 'inv1'] })
    expect(ledgerQuery.filters).toContainEqual({ method: 'eq', args: ['business_id', 'b1'] })
  })

  it('identifica o pagamento do Stripe como recebido pelo link de pagamento', async () => {
    const { tools } = setup()
    const json = body(await tools.get('get_payment_status')!.handler({ invoice_id: 'inv1' }))
    expect(json.payments.map((p: { source: string }) => p.source)).toEqual(['manual', 'stripe'])
  })

  it('retorna um payment_id estável por linha para identificar o pagamento a corrigir', async () => {
    const { tools } = setup()
    const json = body(await tools.get('get_payment_status')!.handler({ invoice_id: 'inv1' }))
    expect(json.payments.map((p: { payment_id: string }) => p.payment_id)).toEqual(['pay1', 'pay2'])
  })

  // O bug: um pagamento anulado que continua contando representa um valor que
  // não foi recebido. Ele deve sair da lista E do total de conciliação.
  it('exclui pagamentos anulados da lista e de todos os totais', async () => {
    const { tools } = setup({
      'payments.select': { data: [...PAYMENTS, VOIDED_PAYMENT], error: null },
    })
    const json = body(await tools.get('get_payment_status')!.handler({ invoice_id: 'inv1' }))

    expect(json.payments).toHaveLength(2)
    expect(json.voided_count).toBe(1)
    expect(json.reconciliation.ledger_total).toBe(400)
    expect(json.reconciliation.mismatch).toBe(false)
  })

  it('exibe pagamentos anulados e seus motivos quando solicitado, sem incluí-los nos totais', async () => {
    const { tools } = setup({
      'payments.select': { data: [...PAYMENTS, VOIDED_PAYMENT], error: null },
    })
    const json = body(
      await tools.get('get_payment_status')!.handler({ invoice_id: 'inv1', include_voided: true })
    )

    expect(json.payments).toHaveLength(3)
    expect(json.payments[2]).toMatchObject({
      payment_id: 'pay3',
      voided_at: '2026-09-01T10:00:00Z',
      void_reason: 'Recorded twice',
    })
    expect(json.reconciliation.ledger_total).toBe(400)
  })

  it('retorna o link de pagamento quando pagamentos on-line estão habilitados', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_example')
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_test_example')
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_example')
    const { tools } = setup()
    const json = body(await tools.get('get_payment_status')!.handler({ invoice_id: 'inv1' }))
    expect(json.online_payments_enabled).toBe(true)
    expect(json.pay_url).toContain('/i/pub1')
  })

  it('não retorna link de pagamento quando pagamentos com cartão não estão configurados', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', '')
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '')
    const { tools } = setup()
    const json = body(await tools.get('get_payment_status')!.handler({ invoice_id: 'inv1' }))
    expect(json.online_payments_enabled).toBe(false)
    expect(json.pay_url).toBeNull()
    expect(json.public_url).toContain('/i/pub1')
  })

  it('emite um aviso em vez de estimar quando o histórico diverge da fatura', async () => {
    const { tools } = setup({ 'payments.select': { data: [{ ...PAYMENTS[0] }], error: null } })
    const json = body(await tools.get('get_payment_status')!.handler({ invoice_id: 'inv1' }))

    expect(json.reconciliation.mismatch).toBe(true)
    expect(json.summary).toContain('valor diferente')
  })

  it('marca como vencida uma fatura cujo prazo passou', async () => {
    const { tools } = setup({
      'invoices.select': { data: { ...INVOICE, status: 'sent', due_date: '2000-01-01' }, error: null },
    })
    const json = body(await tools.get('get_payment_status')!.handler({ invoice_id: 'inv1' }))
    expect(json.invoice.is_overdue).toBe(true)
    expect(json.summary).toContain('em atraso desde 2000-01-01')
  })

  it('recusa o acesso a uma fatura de outra empresa via ScopedDb', async () => {
    const { tools, svc } = setup({ 'invoices.select': { data: { ...INVOICE, business_id: 'bX' }, error: null } })
    const result = await tools.get('get_payment_status')!.handler({ invoice_id: 'inv1' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('Fatura não encontrada')
    expect(svc.calls.some((c) => c.table === 'payments')).toBe(false)
  })
})

/**
 * record_payment usa a RPC record_invoice_payment, que insere a linha do razão
 * e recalcula a fatura a partir de SUM(payments) em uma única transação. Estes
 * testes existem porque esse ponto de chamada ficou sem cobertura ao migrar
 * para uma RPC: o fake de teste não tinha .rpc(), então o handler nunca passava
 * da verificação de escopo. Esse fluxo já causou dois bugs de registro
 * duplicado, portanto não pode ficar sem testes.
 */
describe('record_payment', () => {
  const RECORDED = {
    payment_id: 'pay1',
    duplicate: false,
    ledger_total: 1000,
    invoice: { status: 'paid', amount_paid: 1000, balance_due: 0 },
  }

  function paymentSetup(overrides: Record<string, FakeHandler | FakeResult> = {}) {
    return setup({ 'rpc.record_payment_once': { data: RECORDED, error: null }, ...overrides })
  }

  it('registra o pagamento em uma RPC, em vez de fazer uma inserção e uma atualização', async () => {
    const { tools, svc } = paymentSetup()
    await tools.get('record_payment')!.handler({ invoice_id: 'inv1', amount: 600, payment_date: '2026-08-20' })

    expect(rpcCalls(svc, 'record_payment_once')).toHaveLength(1)
    // Uma inserção separada no razão e uma atualização separada da fatura foram
    // exatamente o que permitiu registrar valores sem refleti-los na fatura.
    expect(svc.calls.some((c) => c.table === 'payments' && c.op === 'insert')).toBe(false)
    expect(svc.calls.some((c) => c.table === 'invoices' && c.op === 'update')).toBe(false)
  })

  it('encaminha o pagamento com a procedência do agente e a chave solicitante', async () => {
    const { tools, svc } = paymentSetup()
    await tools.get('record_payment')!.handler({
      invoice_id: 'inv1',
      amount: 600,
      payment_date: '2026-08-20',
      method: 'bank_transfer',
      reference_number: 'REF-9',
      notes: 'Wire',
    })

    expect(rpcCalls(svc, 'record_payment_once')[0].payload).toEqual({
      p_invoice_id: 'inv1',
      p_amount: 600,
      p_payment_date: '2026-08-20',
      p_payment_method: 'bank_transfer',
      p_reference_number: 'REF-9',
      p_notes: 'Wire',
      p_created_via: 'agent',
      p_created_by_key_id: 'key1',
    })
  })

  it('usa valores padrão para método e data do pagamento, em vez de deixá-los null', async () => {
    const { tools, svc } = paymentSetup()
    await tools.get('record_payment')!.handler({ invoice_id: 'inv1', amount: 600 })

    const args = rpcCalls(svc, 'record_payment_once')[0].payload as Record<string, unknown>
    expect(args.p_payment_method).toBe('other')
    expect(args.p_payment_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('informa o status e o saldo calculados pela RPC, sem estimativas locais', async () => {
    const { tools } = paymentSetup()
    const json = body(await tools.get('record_payment')!.handler({ invoice_id: 'inv1', amount: 600 }))

    expect(json.invoice).toEqual({ status: 'paid', amount_paid: 1000, balance_due: 0 })
    expect(json.summary).toContain('Pagamento de $600.00')
    expect(json.summary).toContain('O status agora é paid')
    expect(json.summary).toContain('$0.00 a pagar')
  })

  it('informa um pagamento parcial e o saldo restante', async () => {
    const { tools } = paymentSetup({
      'rpc.record_payment_once': {
        data: { ...RECORDED, ledger_total: 700, invoice: { status: 'partial', amount_paid: 700, balance_due: 300 } },
        error: null,
      },
    })
    const json = body(await tools.get('record_payment')!.handler({ invoice_id: 'inv1', amount: 300 }))

    expect(json.invoice.status).toBe('partial')
    expect(json.summary).toContain('$300.00 a pagar')
  })

  it('recusa faturas canceladas sem alterar o histórico', async () => {
    const { tools, svc } = paymentSetup({
      'invoices.select': { data: { ...INVOICE, status: 'cancelled' }, error: null },
    })
    const result = await tools.get('record_payment')!.handler({ invoice_id: 'inv1', amount: 100 })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('está cancelada')
    expect(rpcCalls(svc, 'record_payment_once')).toHaveLength(0)
  })

  it('recusa o acesso a uma fatura de outra empresa via ScopedDb', async () => {
    const { tools, svc } = paymentSetup({
      'invoices.select': { data: { ...INVOICE, business_id: 'bX' }, error: null },
    })
    const result = await tools.get('record_payment')!.handler({ invoice_id: 'inv1', amount: 100 })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('Fatura não encontrada')
    expect(rpcCalls(svc, 'record_payment_once')).toHaveLength(0)
  })

  it('informa a falha em vez de afirmar que o pagamento foi registrado', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { tools } = paymentSetup({
      'rpc.record_payment_once': { data: null, error: { message: 'invoice_not_found' } },
    })
    const result = await tools.get('record_payment')!.handler({ invoice_id: 'inv1', amount: 100 })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('Não foi possível registrar o pagamento.')
  })
})

/**
 * update_payment e void_payment. Essas ferramentas existem porque o razão só
 * permitia gravação: uma carga retroativa de um agente marcou quatorze faturas
 * já pagas com a data da carga, sem uma forma de autosserviço para devolver os
 * valores ao mês em que foram recebidos.
 *
 * As regras ficam na RPC; aqui é verificado o contrato desta camada: o escopo
 * é estabelecido antes da chamada, o ID da chave solicitante é passado como
 * ator, request_id é encaminhado sem alterações, pagamentos do Stripe são
 * recusados com uma explicação em vez de um código de erro, e uma recusa nunca
 * é apresentada como sucesso.
 */
describe('correções de pagamento', () => {
  const MANUAL_PAYMENT = {
    id: 'pay1',
    business_id: 'b1',
    invoice_id: 'inv1',
    amount: 400,
    currency: 'USD',
    payment_date: '2026-09-21',
    payment_method: 'bank_transfer',
    reference_number: null,
    notes: null,
    source: 'manual',
    voided_at: null,
    void_reason: null,
  }

  const UPDATED = {
    payment: { ...MANUAL_PAYMENT, payment_date: '2026-06-15' },
    invoice: { invoice_number: 'INV-0042', status: 'paid', amount_paid: 400, balance_due: 0, currency: 'USD' },
    replayed: false,
  }

  function correctionSetup(overrides: Record<string, FakeHandler | FakeResult> = {}) {
    return setup({
      'payments.select': { data: MANUAL_PAYMENT, error: null },
      'rpc.update_payment': { data: UPDATED, error: null },
      'rpc.void_payment': {
        data: {
          payment: { ...MANUAL_PAYMENT, voided_at: '2026-09-22T00:00:00Z', void_reason: 'Recorded twice' },
          invoice: { invoice_number: 'INV-0042', status: 'sent', amount_paid: 0, balance_due: 1000, currency: 'USD' },
          replayed: false,
        },
        error: null,
      },
      ...overrides,
    })
  }

  it('envia a correção à RPC com a chave solicitante como autora', async () => {
    const { tools, svc } = correctionSetup()
    await tools.get('update_payment')!.handler({
      request_id: 'fix-1',
      payment_id: 'pay1',
      payment_date: '2026-06-15',
    })

    expect(rpcCalls(svc, 'update_payment')[0].payload).toEqual({
      p_payment_id: 'pay1',
      p_request_id: 'fix-1',
      p_payment_date: '2026-06-15',
      p_method: undefined,
      p_notes: undefined,
      p_reference_number: undefined,
      p_amount: undefined,
      p_actor_key_id: 'key1',
    })
    // A correção é feita por uma única RPC transacional, nunca por gravação direta.
    expect(svc.calls.some((c) => c.table === 'payments' && c.op === 'update')).toBe(false)
    expect(svc.calls.some((c) => c.table === 'invoices' && c.op === 'update')).toBe(false)
  })

  it('informa o status e o saldo recalculados pela RPC', async () => {
    const { tools } = correctionSetup({
      'rpc.update_payment': {
        data: {
          ...UPDATED,
          payment: { ...MANUAL_PAYMENT, amount: 100 },
          invoice: { invoice_number: 'INV-0042', status: 'partial', amount_paid: 100, balance_due: 900, currency: 'USD' },
        },
        error: null,
      },
    })
    const json = body(
      await tools.get('update_payment')!.handler({ request_id: 'fix-1', payment_id: 'pay1', amount: 100 })
    )

    expect(json.invoice).toEqual({
      invoice_number: 'INV-0042',
      status: 'partial',
      amount_paid: 100,
      balance_due: 900,
    })
    expect(json.summary).toContain('agora é partial')
    expect(json.summary).toContain('$900.00 a pagar')
  })

  it('recusa a correção quando não há nada a alterar', async () => {
    const { tools, svc } = correctionSetup()
    const result = await tools.get('update_payment')!.handler({ request_id: 'fix-1', payment_id: 'pay1' })

    expect(result.isError).toBe(true)
    expect(rpcCalls(svc, 'update_payment')).toHaveLength(0)
  })

  it('recusa pagamentos do Stripe e explica como reembolsá-los, sem chamar a RPC', async () => {
    const { tools, svc } = correctionSetup({
      'payments.select': { data: { ...MANUAL_PAYMENT, source: 'stripe' }, error: null },
    })
    const result = await tools.get('update_payment')!.handler({
      request_id: 'fix-1',
      payment_id: 'pay1',
      payment_date: '2026-06-15',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('reembolso')
    expect(rpcCalls(svc, 'update_payment')).toHaveLength(0)
  })

  it('converte a recusa do banco para pagamentos do Stripe sem expor o código', async () => {
    const { tools } = correctionSetup({
      'rpc.update_payment': { data: null, error: { message: 'stripe_payment_locked' } },
    })
    const result = await tools.get('update_payment')!.handler({
      request_id: 'fix-1',
      payment_id: 'pay1',
      payment_date: '2026-06-15',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Stripe')
    expect(result.content[0].text).not.toContain('stripe_payment_locked')
  })

  it('explica o excesso de pagamento em vez de informar uma falha genérica', async () => {
    const { tools } = correctionSetup({
      'rpc.update_payment': { data: null, error: { message: 'amount_exceeds_invoice_total' } },
    })
    const result = await tools.get('update_payment')!.handler({
      request_id: 'fix-1',
      payment_id: 'pay1',
      amount: 99999,
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('total da fatura seria ultrapassado')
  })

  it('recusa o acesso a um pagamento de outra empresa via ScopedDb', async () => {
    const { tools, svc } = correctionSetup({
      'payments.select': { data: { ...MANUAL_PAYMENT, business_id: 'bX' }, error: null },
    })
    const result = await tools.get('update_payment')!.handler({
      request_id: 'fix-1',
      payment_id: 'pay1',
      payment_date: '2026-06-15',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('Pagamento não encontrado')
    expect(rpcCalls(svc, 'update_payment')).toHaveLength(0)
  })

  it('anula com justificativa e informa o saldo reaberto', async () => {
    const { tools, svc } = correctionSetup()
    const json = body(
      await tools.get('void_payment')!.handler({
        request_id: 'void-1',
        payment_id: 'pay1',
        reason: 'Recorded twice',
      })
    )

    expect(rpcCalls(svc, 'void_payment')[0].payload).toEqual({
      p_payment_id: 'pay1',
      p_request_id: 'void-1',
      p_reason: 'Recorded twice',
      p_actor_key_id: 'key1',
    })
    expect(json.payment.void_reason).toBe('Recorded twice')
    expect(json.invoice.status).toBe('sent')
    expect(json.summary).toContain('$1,000.00 a pagar')
  })

  it('recusa anular pagamentos do Stripe sem chamar a RPC', async () => {
    const { tools, svc } = correctionSetup({
      'payments.select': { data: { ...MANUAL_PAYMENT, source: 'stripe' }, error: null },
    })
    const result = await tools.get('void_payment')!.handler({
      request_id: 'void-1',
      payment_id: 'pay1',
      reason: 'Wrong',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('reembolso')
    expect(rpcCalls(svc, 'void_payment')).toHaveLength(0)
  })

  it('identifica uma repetição como tal, sem tratá-la como uma segunda correção', async () => {
    const { tools } = correctionSetup({
      'rpc.update_payment': { data: { ...UPDATED, replayed: true }, error: null },
    })
    const json = body(
      await tools.get('update_payment')!.handler({
        request_id: 'fix-1',
        payment_id: 'pay1',
        payment_date: '2026-06-15',
      })
    )

    expect(json.replayed).toBe(true)
    expect(json.summary).toContain('repetiu uma solicitação')
  })
})
