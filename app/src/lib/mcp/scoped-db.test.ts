import { describe, it, expect, vi, afterEach } from 'vitest'
import { createScopedDb, ScopeError } from '@/lib/mcp/scoped-db'

const scope1 = { userId: 'u1', businessIds: ['b1'] }
const scope2 = { userId: 'u1', businessIds: ['b1', 'b2'] }
const stub = {} as never // svc unused by resolveBusinessId

describe('resolveBusinessId', () => {
  it('retorna a única empresa quando nenhuma é especificada', () => {
    expect(createScopedDb(scope1, stub).resolveBusinessId()).toBe('b1')
  })
  it('aceita o ID de uma empresa dentro do escopo', () => {
    expect(createScopedDb(scope2, stub).resolveBusinessId('b2')).toBe('b2')
  })
  it('rejeita o ID de uma empresa fora do escopo', () => {
    expect(() => createScopedDb(scope1, stub).resolveBusinessId('bX')).toThrow(ScopeError)
  })
  it('exige um ID explícito quando há várias empresas no escopo', () => {
    expect(() => createScopedDb(scope2, stub).resolveBusinessId()).toThrow(/business_id/)
  })
})

// Cria um SupabaseClient simulado que expõe apenas .from().select().eq().maybeSingle()
// cadeia usada por assertClientAccess / assertInvoiceAccess.
function mockSvc(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ select })
  return { from } as never
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('assertClientAccess', () => {
  it('lança ScopeError com a mensagem genérica quando o registro está ausente', async () => {
    const svc = mockSvc({ data: null, error: null })
    const db = createScopedDb(scope1, svc)
    await expect(db.assertClientAccess('c1')).rejects.toThrow(ScopeError)
    await expect(db.assertClientAccess('c1')).rejects.toThrow('Cliente não encontrado')
  })

  it('lança ScopeError com a mesma mensagem quando o registro está fora do escopo', async () => {
    const svc = mockSvc({ data: { id: 'c1', business_id: 'bX' }, error: null })
    const db = createScopedDb(scope1, svc)

    let missingMessage = ''
    const missingSvc = mockSvc({ data: null, error: null })
    try {
      await createScopedDb(scope1, missingSvc).assertClientAccess('c1')
    } catch (e) {
      missingMessage = (e as Error).message
    }

    let outOfScopeMessage = ''
    try {
      await db.assertClientAccess('c1')
    } catch (e) {
      outOfScopeMessage = (e as Error).message
    }

    expect(outOfScopeMessage).toBe(missingMessage)
  })

  it('retorna o registro quando existe e está no escopo', async () => {
    const row = { id: 'c1', business_id: 'b1' }
    const svc = mockSvc({ data: row, error: null })
    const db = createScopedDb(scope1, svc)
    await expect(db.assertClientAccess('c1')).resolves.toEqual(row)
  })

  it('registra o erro do banco e ainda lança o ScopeError genérico', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const svc = mockSvc({ data: null, error: { message: 'boom' } })
    const db = createScopedDb(scope1, svc)
    await expect(db.assertClientAccess('c1')).rejects.toThrow('Cliente não encontrado')
    expect(spy).toHaveBeenCalled()
  })
})

describe('assertInvoiceAccess', () => {
  it('lança ScopeError com a mensagem genérica quando o registro está ausente', async () => {
    const svc = mockSvc({ data: null, error: null })
    const db = createScopedDb(scope1, svc)
    await expect(db.assertInvoiceAccess('i1')).rejects.toThrow('Fatura não encontrada')
  })

  it('lança ScopeError com a mesma mensagem quando o registro está fora do escopo', async () => {
    const missingSvc = mockSvc({ data: null, error: null })
    let missingMessage = ''
    try {
      await createScopedDb(scope1, missingSvc).assertInvoiceAccess('i1')
    } catch (e) {
      missingMessage = (e as Error).message
    }

    const outOfScopeSvc = mockSvc({ data: { id: 'i1', business_id: 'bX' }, error: null })
    let outOfScopeMessage = ''
    try {
      await createScopedDb(scope1, outOfScopeSvc).assertInvoiceAccess('i1')
    } catch (e) {
      outOfScopeMessage = (e as Error).message
    }

    expect(outOfScopeMessage).toBe(missingMessage)
  })

  it('retorna o registro quando existe e está no escopo', async () => {
    const row = { id: 'i1', business_id: 'b1' }
    const svc = mockSvc({ data: row, error: null })
    const db = createScopedDb(scope1, svc)
    await expect(db.assertInvoiceAccess('i1')).resolves.toEqual(row)
  })

  it('registra o erro do banco e ainda lança o ScopeError genérico', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const svc = mockSvc({ data: null, error: { message: 'boom' } })
    const db = createScopedDb(scope1, svc)
    await expect(db.assertInvoiceAccess('i1')).rejects.toThrow('Fatura não encontrada')
    expect(spy).toHaveBeenCalled()
  })
})

describe('assertExpenseAccess', () => {
  it('usa concordância feminina para despesa ausente ou fora do escopo', async () => {
    const missingSvc = mockSvc({ data: null, error: null })
    let missingMessage = ''
    try {
      await createScopedDb(scope1, missingSvc).assertExpenseAccess('e1')
    } catch (e) {
      missingMessage = (e as Error).message
    }

    const outOfScopeSvc = mockSvc({ data: { id: 'e1', business_id: 'bX' }, error: null })
    let outOfScopeMessage = ''
    try {
      await createScopedDb(scope1, outOfScopeSvc).assertExpenseAccess('e1')
    } catch (e) {
      outOfScopeMessage = (e as Error).message
    }

    expect(missingMessage).toBe('Despesa não encontrada')
    expect(outOfScopeMessage).toBe(missingMessage)
  })
})
