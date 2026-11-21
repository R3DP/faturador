import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '@/lib/mcp/fake-supabase'
import { BUSINESS_ID, ROW_ID } from './action-fixture'

/**
 * Auditoria da aplicação, Medium-3. As duas gravações de clientes antes
 * espalhavam o argumento de quem chama no insert e no update, depois de
 * `business_id`; assim, uma chamada POST da server action podia escolher
 * `business_id`, `id`, `created_at`, `created_via` e `created_by_key_id`, além
 * de armazenar texto sem limite em `notes`.
 *
 * Estes testes verificam o que é ENVIADO ao banco, não o que o banco recusaria
 * depois. O RLS rejeitar um `business_id` forjado é uma segunda barreira, mas
 * não é o controle que está sendo testado aqui.
 */

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClientAction, deleteClientAction, updateClientAction } from './clients'

const OTHER_BUSINESS = '20000000-0000-4000-8000-0000000000ff'

const valid = {
  name: 'Harbor & Lane',
  email: 'ap@harborlane.example',
  phone: '555-0100',
  website: 'https://harborlane.example',
  address_line1: '',
  address_line2: '',
  city: '',
  state: '',
  postal_code: '',
  country: '',
  tax_id: '',
  currency: 'usd',
  payment_terms: 14,
  notes: '',
}

let db: FakeSupabase

beforeEach(() => {
  createClientMock.mockReset()
  db = createFakeSupabase({
    clients: { data: { id: ROW_ID }, error: null },
  })
  createClientMock.mockResolvedValue(db)
})

function writes() {
  return db.calls.filter((call) => call.op === 'insert' || call.op === 'update')
}

describe('createClientAction', () => {
  it('grava apenas as colunas indicadas e usa o business_id do próprio argumento', async () => {
    await createClientAction(BUSINESS_ID, valid)

    expect(writes()).toHaveLength(1)
    expect(writes()[0].payload).toEqual({
      business_id: BUSINESS_ID,
      name: 'Harbor & Lane',
      email: 'ap@harborlane.example',
      phone: '555-0100',
      website: 'https://harborlane.example',
      address_line1: null,
      address_line2: null,
      city: null,
      state: null,
      postal_code: null,
      country: null,
      tax_id: null,
      currency: 'USD',
      payment_terms: 14,
      notes: null,
    })
  })

  it.each([
    ['business_id', { business_id: OTHER_BUSINESS }],
    ['id', { id: '00000000-0000-4000-8000-00000000dead' }],
    ['created_at', { created_at: '1999-01-01T00:00:00Z' }],
    ['created_via', { created_via: 'agent' }],
    ['created_by_key_id', { created_by_key_id: ROW_ID }],
    ['is_active', { is_active: false }],
  ])('recusa o campo %s e não grava nada', async (_label, extra) => {
    await expect(
      createClientAction(BUSINESS_ID, { ...valid, ...extra } as never),
    ).rejects.toThrow()
    expect(writes()).toHaveLength(0)
  })

  it('recusa notas sem limite de tamanho', async () => {
    await expect(
      createClientAction(BUSINESS_ID, { ...valid, notes: 'x'.repeat(5001) }),
    ).rejects.toThrow()
    expect(writes()).toHaveLength(0)
  })

  it.each([
    ['nome ausente', { name: '' }],
    ['e-mail inválido', { email: 'not an address' }],
    ['site com javascript:', { website: 'javascript:alert(1)' }],
    ['moeda inválida', { currency: 'DOLLARS' }],
    ['prazo de pagamento negativo', { payment_terms: -1 }],
  ])('recusa %s', async (_label, patch) => {
    await expect(createClientAction(BUSINESS_ID, { ...valid, ...patch })).rejects.toThrow()
    expect(writes()).toHaveLength(0)
  })

  it('recusa um business_id que não seja UUID', async () => {
    await expect(createClientAction('not-a-uuid', valid)).rejects.toThrow()
    expect(db.calls).toHaveLength(0)
  })
})

describe('updateClientAction', () => {
  it('nunca grava business_id, impedindo que uma edição transfira o cliente', async () => {
    await updateClientAction(ROW_ID, valid)

    expect(writes()).toHaveLength(1)
    expect(Object.keys(writes()[0].payload as object)).not.toContain('business_id')
  })

  it('recusa um business_id injetado e não grava nada', async () => {
    await expect(
      updateClientAction(ROW_ID, { ...valid, business_id: OTHER_BUSINESS } as never),
    ).rejects.toThrow()
    expect(writes()).toHaveLength(0)
  })

  it('recusa um ID de cliente que não seja UUID', async () => {
    await expect(updateClientAction('../../etc', valid)).rejects.toThrow()
    expect(db.calls).toHaveLength(0)
  })
})

describe('deleteClientAction', () => {
  it('arquiva alterando somente is_active', async () => {
    await deleteClientAction(ROW_ID)

    expect(writes()).toHaveLength(1)
    expect(writes()[0].payload).toEqual({ is_active: false })
  })

  it('recusa um ID de cliente que não seja UUID', async () => {
    await expect(deleteClientAction('nope')).rejects.toThrow()
    expect(db.calls).toHaveLength(0)
  })
})
