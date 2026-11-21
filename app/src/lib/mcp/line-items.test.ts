import { describe, it, expect } from 'vitest'
import { createFakeSupabase, type FakeQuery } from './fake-supabase'
import { createScopedDb, ScopeError } from './scoped-db'
import { resolveLineItems, lineItemInput } from './line-items'
import { computeInvoiceTotals } from '@/lib/invoices/build'
import type { McpCtx } from './context'

interface CatalogItem {
  id: string
  business_id: string
  name: string
  description: string | null
  type: string
  rate: number
  unit: string | null
  tax_rate: number
  is_active: boolean
}

const CONSULTING: CatalogItem = {
  id: '11111111-1111-4111-8111-111111111111',
  business_id: 'b1',
  name: 'Consulting',
  description: 'Consulting services',
  type: 'service',
  rate: 150,
  unit: 'hour',
  tax_rate: 0,
  is_active: true,
}

const DESIGN: CatalogItem = {
  ...CONSULTING,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Design',
  description: null,
  rate: 90,
}

/** Lê o valor passado a um método da cadeia, por exemplo, o padrão ilike. */
function argOf(query: FakeQuery, method: string, index: number): unknown {
  return query.filters.find((f) => f.method === method)?.args[index]
}

function ctxWithCatalog(catalog: CatalogItem[]): McpCtx {
  const svc = createFakeSupabase({
    'items.select': (query) => {
      const pattern = argOf(query, 'ilike', 1) as string | undefined
      if (pattern === undefined) return { data: catalog, error: null }

      // Buscas exatas usam o nome sem adornos; a busca por nomes semelhantes o envolve com %.
      if (pattern.startsWith('%') && pattern.endsWith('%')) {
        const needle = pattern.slice(1, -1).toLowerCase()
        return { data: catalog.filter((i) => i.name.toLowerCase().includes(needle)), error: null }
      }
      return { data: catalog.filter((i) => i.name.toLowerCase() === pattern.toLowerCase()), error: null }
    },
  })

  return {
    userId: 'u1',
    keyId: 'k1',
    businessIds: ['b1'],
    db: createScopedDb({ userId: 'u1', businessIds: ['b1'] }, svc as never),
  }
}

describe('consulta de itens salvos por resolveLineItems', () => {
  it('define o preço do item de linha a partir de um item salvo citado em linguagem natural', async () => {
    const ctx = ctxWithCatalog([CONSULTING, DESIGN])
    const { resolved } = await resolveLineItems(ctx, 'b1', [{ item_name: 'Consulting', quantity: 3 }])

    expect(resolved).toEqual([{ description: 'Consulting services', quantity: 3, rate: 150 }])
  })

  it('localiza o item sem diferenciar maiúsculas de minúsculas', async () => {
    const ctx = ctxWithCatalog([CONSULTING, DESIGN])
    const { resolved } = await resolveLineItems(ctx, 'b1', [{ item_name: 'consulting', quantity: 1 }])
    expect(resolved[0].rate).toBe(150)
  })

  it('usa o nome do item quando ele não tem descrição', async () => {
    const ctx = ctxWithCatalog([CONSULTING, DESIGN])
    const { resolved } = await resolveLineItems(ctx, 'b1', [{ item_name: 'Design', quantity: 2 }])
    expect(resolved).toEqual([{ description: 'Design', quantity: 2, rate: 90 }])
  })

  it('usa quantidade 1 quando quem chama não informa outra', async () => {
    const ctx = ctxWithCatalog([CONSULTING])
    const { resolved } = await resolveLineItems(ctx, 'b1', [{ item_name: 'Consulting' }])
    expect(resolved[0].quantity).toBe(1)
  })

  it('permite substituir o valor salvo apenas neste item de linha', async () => {
    const ctx = ctxWithCatalog([CONSULTING])
    const { resolved } = await resolveLineItems(ctx, 'b1', [
      { item_name: 'Consulting', quantity: 1, rate: 125 },
      { item_name: 'Consulting', quantity: 1 },
    ])
    expect(resolved.map((line) => line.rate)).toEqual([125, 150])
  })

  it('permite substituir a descrição salva', async () => {
    const ctx = ctxWithCatalog([CONSULTING])
    const { resolved } = await resolveLineItems(ctx, 'b1', [
      { item_name: 'Consulting', description: 'Discovery workshop', quantity: 1 },
    ])
    expect(resolved[0]).toEqual({ description: 'Discovery workshop', quantity: 1, rate: 150 })
  })

  it('sugere nomes semelhantes em vez de adivinhar quando o nome está incorreto', async () => {
    const ctx = ctxWithCatalog([CONSULTING, DESIGN])
    await expect(resolveLineItems(ctx, 'b1', [{ item_name: 'Consult' }])).rejects.toThrow(/Você quis dizer/)
  })

  it('não escolhe entre dois itens com o mesmo nome', async () => {
    const twin = { ...DESIGN, name: 'Consulting' }
    const ctx = ctxWithCatalog([CONSULTING, twin])
    await expect(resolveLineItems(ctx, 'b1', [{ item_name: 'Consulting' }])).rejects.toThrow(
      /informe item_id para desambiguar/
    )
  })

  it('indica qual item de linha está sem valor em vez de faturá-lo como zero', async () => {
    const ctx = ctxWithCatalog([CONSULTING])
    await expect(
      resolveLineItems(ctx, 'b1', [
        { description: 'Fine', quantity: 1, rate: 10 },
        { description: 'Sem tarifa', quantity: 1 },
      ])
    ).rejects.toThrow(/Valor ausente no item de linha 2/)
  })

  it('informa a descrição ausente como ScopeError, sem lançar um erro bruto', async () => {
    const ctx = ctxWithCatalog([CONSULTING])
    await expect(resolveLineItems(ctx, 'b1', [{ quantity: 1, rate: 10 }])).rejects.toBeInstanceOf(ScopeError)
  })

  it('limita a busca do catálogo à empresa resolvida', async () => {
    const ctx = ctxWithCatalog([CONSULTING])
    await resolveLineItems(ctx, 'b1', [{ item_name: 'Consulting' }])
    const svcCalls = (ctx.db.svc as unknown as { calls: FakeQuery[] }).calls
    const itemQuery = svcCalls.find((c) => c.table === 'items')!
    expect(itemQuery.filters).toContainEqual({ method: 'eq', args: ['business_id', 'b1'] })
  })

  it('escapa curingas ilike para que % literal no nome não seja interpretado como padrão', async () => {
    const ctx = ctxWithCatalog([{ ...CONSULTING, name: '50% Off Retainer' }])
    await resolveLineItems(ctx, 'b1', [{ item_name: '50% Off Retainer' }]).catch(() => {})
    const svcCalls = (ctx.db.svc as unknown as { calls: FakeQuery[] }).calls
    expect(argOf(svcCalls[0], 'ilike', 1)).toBe('50\\% Off Retainer')
  })
})

describe('esquema lineItemInput', () => {
  it('aceita uma referência direta a um item salvo', () => {
    expect(lineItemInput.parse({ item_name: 'Consulting', quantity: 3 })).toMatchObject({ quantity: 3 })
  })

  it('rejeita quantidade zero ou negativa', () => {
    expect(() => lineItemInput.parse({ description: 'x', quantity: 0, rate: 1 })).toThrow()
    expect(() => lineItemInput.parse({ description: 'x', quantity: -1, rate: 1 })).toThrow()
  })

  it('rejeita valor negativo', () => {
    expect(() => lineItemInput.parse({ description: 'x', quantity: 1, rate: -1 })).toThrow()
  })

  it('descreve todos os campos, pois é a descrição que o agente lê', () => {
    for (const field of Object.values(lineItemInput.shape)) {
      expect(field.description).toBeTruthy()
    }
  })
})

describe('itens precificados usam o cálculo que arredonda os totais uma única vez', () => {
  it('faz o subtotal corresponder à soma dos valores exibidos nos itens de linha', async () => {
    const halfCentItem = { ...CONSULTING, rate: 0.005, description: 'Half cent' }
    const ctx = ctxWithCatalog([halfCentItem])
    const { resolved } = await resolveLineItems(ctx, 'b1', [
      { item_name: 'Consulting' },
      { item_name: 'Consulting' },
      { item_name: 'Consulting' },
    ])

    const totals = computeInvoiceTotals(resolved)

    // Cada item de linha é arredondado para cima até o centavo, mas o subtotal vem do
    // valor bruto 0.015; portanto, somar os itens arredondados (0.03) produziria um resultado incorreto.
    expect(totals.line_items.map((li) => li.amount)).toEqual([0.01, 0.01, 0.01])
    expect(totals.subtotal).toBe(0.03)
    expect(totals.total).toBe(0.03)
  })
})
