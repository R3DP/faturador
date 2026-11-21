import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '@/lib/mcp/fake-supabase'
import { BUSINESS_ID, ROW_ID } from './action-fixture'

/**
 * A exclusão de faturas e orçamentos remove apenas rascunhos; clientes são
 * arquivados, em vez de removidos.
 */

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { deleteInvoiceAction } from './invoices'
import { deleteEstimateAction } from './estimates'
import { deleteClientAction } from './clients'

let db: FakeSupabase

function setup() {
  db = createFakeSupabase({
    'invoices.select': { data: { business_id: BUSINESS_ID, status: 'draft' }, error: null },
    'estimates.select': { data: { business_id: BUSINESS_ID, status: 'draft' }, error: null },
    'clients.select': { data: { business_id: BUSINESS_ID }, error: null },
    'invoices.delete': { data: null, error: null },
    'estimates.delete': { data: null, error: null },
    'clients.update': { data: null, error: null },
  })
  createClientMock.mockResolvedValue(db)
}

beforeEach(() => {
  createClientMock.mockReset()
  setup()
})

describe('exclusões', () => {
  it('continuam funcionando e apenas para rascunhos', async () => {
    await deleteInvoiceAction(ROW_ID)
    await deleteEstimateAction(ROW_ID)
    await deleteClientAction(ROW_ID)

    expect(db.calls.filter((call) => call.op === 'delete')).toHaveLength(2)
    // Clientes são arquivados em vez de removidos.
    expect(db.calls.find((call) => call.op === 'update')?.payload).toEqual({ is_active: false })
  })

  it('recusa uma fatura enviada pelo motivo anterior', async () => {
    db = createFakeSupabase({
      'invoices.select': { data: { business_id: BUSINESS_ID, status: 'sent' }, error: null },
    })
    createClientMock.mockResolvedValue(db)

    await expect(deleteInvoiceAction(ROW_ID)).rejects.toThrow(/Só é possível excluir faturas em rascunho/)
  })
})
