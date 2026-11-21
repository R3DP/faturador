import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '@/lib/mcp/fake-supabase'
import { BUSINESS_ID, CLIENT_ID, ROW_ID } from './action-fixture'

/**
 * Parte B dos contratos no navegador: faturar um lançamento da agenda em uma
 * fatura e transformar um orçamento aceito no contrato que ele descrevia.
 *
 * Estes testes comprovam os limites, não os cálculos. A lógica dos cálculos
 * fica no SQL e é verificada em supabase/tests/engagements.sql. Aqui, só é
 * possível confirmar que a action envia os IDs dos lançamentos, e NÃO os
 * valores, e que uma recusa retorna uma mensagem compreensível, em vez de um
 * erro do Postgres.
 */

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createInvoiceAction } from './invoices'
import { convertEstimateToEngagementAction } from './engagements'

const REQUEST_ID = '50000000-0000-4000-8000-000000000001'
const ENTRY_A = '70000000-0000-4000-8000-00000000000a'
const ENTRY_B = '70000000-0000-4000-8000-00000000000b'

const invoiceInput = {
  client_id: CLIENT_ID,
  invoice_number: 'INV-0042',
  issue_date: '2026-09-22',
  due_date: '2026-10-22',
  currency: 'USD',
  line_items: [
    {
      id: 'line-1',
      description: 'Consultoria',
      quantity: 1,
      rate: 250,
      amount: 250,
      tax_rate: 0,
      tax_amount: 0,
      discount_percent: 0,
      discount_amount: 0,
    },
  ],
  subtotal: 250,
  discount_type: 'percentage' as const,
  discount_value: 0,
  discount_amount: 0,
  tax_rate: 0,
  tax_amount: 0,
  shipping_amount: 0,
  total: 250,
  is_recurring: false,
}

let db: FakeSupabase

function setup(overrides: Record<string, { data: unknown; error: unknown }> = {}) {
  db = createFakeSupabase({
    'rpc.create_invoice_document': { data: { id: ROW_ID, invoice_number: 'INV-0042' }, error: null },
    'rpc.convert_estimate_to_engagement': {
      data: { engagement: { id: 'eng1' } },
      error: null,
    },
    ...overrides,
  })
  createClientMock.mockResolvedValue(db)
}

function rpcPayload(fn: string) {
  return db.calls.find((call) => call.op === 'rpc' && call.table === fn)?.payload as
    | Record<string, unknown>
    | undefined
}

beforeEach(() => {
  createClientMock.mockReset()
  setup()
})

describe('createInvoiceAction com lançamentos do contrato', () => {
  it('repassa os IDs dos lançamentos e deixa o banco calcular os valores', async () => {
    await createInvoiceAction(BUSINESS_ID, invoiceInput, 'draft', REQUEST_ID, [ENTRY_A, ENTRY_B])

    const payload = rpcPayload('create_invoice_document')
    expect(payload).toMatchObject({
      p_business_id: BUSINESS_ID,
      p_request_id: REQUEST_ID,
      p_engagement_entry_ids: [ENTRY_A, ENTRY_B],
    })
    // O navegador nunca envia o valor de um lançamento.
    expect(JSON.stringify(payload?.p_lines)).not.toContain(ENTRY_A)
  })

  it('envia uma lista vazia quando nenhum lançamento da agenda foi faturado', async () => {
    await createInvoiceAction(BUSINESS_ID, invoiceInput, 'draft', REQUEST_ID)
    expect(rpcPayload('create_invoice_document')).toMatchObject({ p_engagement_entry_ids: [] })
  })

  it('converte a recusa de faturamento duplicado em uma mensagem compreensível', async () => {
    setup({
      'rpc.create_invoice_document': {
        data: null,
        error: { message: 'engagement_entry_already_invoiced' },
      },
    })
    await expect(
      createInvoiceAction(BUSINESS_ID, invoiceInput, 'draft', REQUEST_ID, [ENTRY_A]),
    ).rejects.toThrow(/já está em uma fatura/)
  })

  it('preserva mensagens do banco não relacionadas em vez de ocultá-las', async () => {
    setup({
      'rpc.create_invoice_document': { data: null, error: { message: 'Invoice number already exists' } },
    })
    await expect(
      createInvoiceAction(BUSINESS_ID, invoiceInput, 'draft', REQUEST_ID),
    ).rejects.toThrow('Invoice number already exists')
  })
})

describe('convertEstimateToEngagementAction', () => {
  it('envia o formato da agenda sem incluir o total ou a moeda do orçamento', async () => {
    const result = await convertEstimateToEngagementAction(
      ROW_ID,
      {
        billing_mode: 'percent_split',
        entries: [
          { label: 'Entrada', percent: 50 },
          { label: 'Na entrega', percent: 50 },
        ],
      },
      REQUEST_ID,
    )

    expect(result).toEqual({ ok: true, engagementId: 'eng1' })
    const payload = rpcPayload('convert_estimate_to_engagement')
    expect(payload).toMatchObject({
      p_request_id: REQUEST_ID,
      p_estimate_id: ROW_ID,
      p_billing_mode: 'percent_split',
    })
    expect(payload).not.toHaveProperty('p_total')
    expect(payload).not.toHaveProperty('p_currency')
    expect(payload).not.toHaveProperty('p_client_id')
  })

  it('explica que o orçamento já foi convertido em fatura', async () => {
    setup({
      'rpc.convert_estimate_to_engagement': {
        data: null,
        error: { message: 'estimate_already_converted' },
      },
    })
    const result = await convertEstimateToEngagementAction(
      ROW_ID,
      { billing_mode: 'equal_installments', installments: 2 },
      REQUEST_ID,
    )
    expect(result).toEqual({
      error:
        'Esse orçamento já foi convertido em fatura, então não pode também ser convertido em contrato.',
    })
  })

  it('explica que o orçamento já foi convertido em contrato', async () => {
    setup({
      'rpc.convert_estimate_to_engagement': {
        data: null,
        error: { message: 'estimate_already_an_engagement' },
      },
    })
    const result = await convertEstimateToEngagementAction(
      ROW_ID,
      { billing_mode: 'equal_installments', installments: 2 },
      REQUEST_ID,
    )
    expect('error' in result && result.error).toMatch(/já foi convertido em contrato/)
  })

  it('recusa um modo de faturamento desconhecido sem chamar o banco', async () => {
    const result = await convertEstimateToEngagementAction(
      ROW_ID,
      { billing_mode: 'retainer' as never },
      REQUEST_ID,
    )
    expect('error' in result).toBe(true)
    expect(db.calls.some((call) => call.op === 'rpc')).toBe(false)
  })
})
