import { describe, it, expect } from 'vitest'
import { activityHref, toActivityRow, type ActivityRow } from '@/lib/agents/activity'

const base = { entity_id: 'abc', business_id: 'b1', label: 'x', amount: null,
  created_at: '2026-08-27T00:00:00Z', created_via: 'agent', created_by_key_id: null }

describe('activityHref', () => {
  it('mapeia cada tipo de entidade para a rota correspondente do app', () => {
    expect(activityHref({ ...base, entity_type: 'invoice' } as ActivityRow)).toBe('/invoices/abc')
    expect(activityHref({ ...base, entity_type: 'client' } as ActivityRow)).toBe('/clients/abc')
    expect(activityHref({ ...base, entity_type: 'estimate' } as ActivityRow)).toBe('/estimates/abc')
    expect(activityHref({ ...base, entity_type: 'time_entry' } as ActivityRow)).toBe('/time')
    expect(activityHref({ ...base, entity_type: 'expense' } as ActivityRow)).toBe('/expenses')
    expect(activityHref({ ...base, entity_type: 'payment' } as ActivityRow)).toBe('/payments')
  })
})

describe('toActivityRow', () => {
  it('preserva um amount nulo (por exemplo, em linhas de client/time_entry) em vez de convertê-lo', () => {
    const raw = {
      entity_type: 'client',
      entity_id: 'c1',
      business_id: 'b1',
      label: 'Acme Co',
      amount: null,
      created_at: '2026-08-27T00:00:00Z',
      created_via: 'agent',
      created_by_key_id: null,
    }
    expect(toActivityRow(raw)).toEqual({
      entity_type: 'client',
      entity_id: 'c1',
      business_id: 'b1',
      label: 'Acme Co',
      amount: null,
      created_at: '2026-08-27T00:00:00Z',
      created_via: 'agent',
      created_by_key_id: null,
    })
  })

  it('repassa uma linha válida totalmente preenchida', () => {
    const raw = {
      entity_type: 'invoice',
      entity_id: 'i1',
      business_id: 'b1',
      label: 'Fatura INV-001',
      amount: 250.5,
      created_at: '2026-08-27T00:00:00Z',
      created_via: 'agent',
      created_by_key_id: 'key-1',
    }
    expect(toActivityRow(raw)).toEqual(raw)
  })

  it('filtra (retorna null para) um entity_type não reconhecido', () => {
    const raw = { ...base, entity_type: 'refund' }
    expect(toActivityRow(raw)).toBeNull()
  })
})
