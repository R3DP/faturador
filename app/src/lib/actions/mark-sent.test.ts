import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '@/lib/mcp/fake-supabase'
import { ROW_ID } from './action-fixture'

/**
 * Marcar manualmente um documento como enviado permite que a pessoa
 * responsável, mesmo sem e-mail, abra a página pública. A operação altera
 * somente um rascunho; clicar novamente em um documento que já saiu desse
 * estado não faz nada e não gera erro.
 */

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { markInvoiceSentAction } from './invoices'
import { markEstimateSentAction } from './estimates'

let db: FakeSupabase

function useRows(rows: unknown[], current: unknown = null) {
  db = createFakeSupabase({
    'invoices.update': { data: rows, error: null },
    'estimates.update': { data: rows, error: null },
    'invoices.select': { data: current, error: null },
    'estimates.select': { data: current, error: null },
  })
  createClientMock.mockResolvedValue(db)
}

beforeEach(() => {
  createClientMock.mockReset()
  useRows([{ id: ROW_ID }])
})

describe('marcar como enviado', () => {
  it.each([
    ['invoices', markInvoiceSentAction],
    ['estimates', markEstimateSentAction],
  ] as const)('altera para enviado somente um registro %s em rascunho', async (table, action) => {
    await expect(action(ROW_ID)).resolves.toEqual({ changed: true, status: 'sent' })

    const update = db.calls.find((call) => call.op === 'update')
    expect(update?.table).toBe(table)
    expect(update?.payload).toEqual({ status: 'sent' })
    expect(update?.filters).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['id', ROW_ID] },
        { method: 'eq', args: ['status', 'draft'] },
      ]),
    )
  })

  it('não altera um documento que já saiu do rascunho e informa seu status', async () => {
    useRows([], { status: 'viewed' })

    await expect(markInvoiceSentAction(ROW_ID)).resolves.toEqual({ changed: false, status: 'viewed' })
    await expect(markEstimateSentAction(ROW_ID)).resolves.toEqual({ changed: false, status: 'viewed' })
  })

  it('continua falhando para um documento que a pessoa não pode acessar', async () => {
    useRows([])

    await expect(markInvoiceSentAction(ROW_ID)).rejects.toThrow(/Fatura não encontrada/)
    await expect(markEstimateSentAction(ROW_ID)).rejects.toThrow(/Orçamento não encontrado/)
  })
})
