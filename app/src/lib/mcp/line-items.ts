import { z } from 'zod'
import type { McpCtx } from '@/lib/mcp/context'
import { ScopeError } from '@/lib/mcp/scoped-db'
import { escapeLike } from '@/lib/mcp/shared'
import type { BuildLineItem } from '@/lib/invoices/build'
import type { Database } from '@/types/database'

export type ItemRow = Database['public']['Tables']['items']['Row']

/** Linha com todos os campos preenchidos, pronta para o cálculo compartilhado dos totais. */
export interface ResolvedLineItem extends BuildLineItem {
  description: string
}

const ITEM_LOOKUP_LIMIT = 5

/**
 * Esquema compartilhado de entrada de itens de linha para create_invoice / update_draft_invoice /
 * create_estimate / update_draft_estimate.
 *
 * Um item pode ser informado por completo (description + quantity + rate) ou pode
 * apontar para um item salvo no catálogo por ID ou nome; nesse caso, o item fornece
 * os campos que não foram informados. Assim, um agente pode transformar "cobrar 3 horas
 * de consultoria" em um item com o preço correto, sem que quem chamou saiba a
 * tarifa armazenada.
 */
export const lineItemInput = z.object({
  description: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe(
      'Descrição do item de linha. Obrigatória, a menos que item_id ou item_name seja informado; nesse caso, usa a descrição do item salvo (ou o nome, se não houver descrição).'
    ),
  quantity: z.number().positive().max(99999999).multipleOf(0.000001).optional().describe('Quantidade (deve ser > 0). O padrão é 1.'),
  rate: z
    .number()
    .min(0).max(99999999).multipleOf(0.000001)
    .optional()
    .describe(
      'Valor por unidade. Obrigatório, a menos que item_id ou item_name seja informado; nesse caso, usa o valor do item salvo. Informe-o para substituir o valor salvo somente neste item de linha.'
    ),
  item_id: z
    .string()
    .uuid()
    .optional()
    .describe('ID de um item salvo (obtido com list_items) usado para definir o preço deste item de linha. Tem prioridade sobre item_name.'),
  item_name: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Nome exato (sem distinção entre maiúsculas e minúsculas) de um item salvo usado para definir o preço deste item de linha, por exemplo, "Consultoria". Use list_items antes se não tiver certeza do nome exato.'
    ),
})

export type LineItemInput = z.infer<typeof lineItemInput>

/**
 * Converte os itens de linha informados em { description, quantity, rate },
 * o formato simples usado pelo cálculo compartilhado dos totais, preenchendo campos vazios com dados do item salvo
 * no catálogo quando houver uma referência.
 *
 * Escopo: a consulta ao catálogo é filtrada por `resolvedBusinessId`, que quem chama
 * já deve ter obtido de `ctx.db.resolveBusinessId`.
 *
 * Lança ScopeError com uma mensagem explicativa quando o item referenciado não
 * existe, é ambíguo ou quando um item de linha fica sem descrição ou valor.
 */
export async function resolveLineItems(
  ctx: McpCtx,
  resolvedBusinessId: string,
  lines: LineItemInput[]
): Promise<{ resolved: ResolvedLineItem[]; usedItems: ItemRow[] }> {
  const needsCatalog = lines.some((line) => line.item_id || line.item_name)
  const usedItems: ItemRow[] = []

  const resolved: ResolvedLineItem[] = []
  for (const [index, line] of lines.entries()) {
    const position = `item de linha ${index + 1}`
    let item: ItemRow | null = null

    if (needsCatalog && (line.item_id || line.item_name)) {
      item = await resolveItem(ctx, resolvedBusinessId, line.item_id, line.item_name, position)
      usedItems.push(item)
    }

    const description = line.description ?? (item ? item.description?.trim() || item.name : undefined)
    const rate = line.rate ?? item?.rate

    if (!description) {
      throw new ScopeError(
        `Descrição ausente no ${position}. Informe description ou faça referência a um item salvo com item_id / item_name.`
      )
    }
    if (rate === undefined) {
      throw new ScopeError(
        `Valor ausente no ${position}. Informe rate ou faça referência a um item salvo com item_id / item_name para usar o valor armazenado.`
      )
    }

    resolved.push({ description, quantity: line.quantity ?? 1, rate })
  }

  return { resolved, usedItems }
}

/**
 * Busca um item salvo por ID ou pelo nome exato (sem distinção entre maiúsculas e minúsculas) em uma
 * empresa. Segue o comportamento de resolveClient: somente correspondência exata; ambiguidades são
 * tratadas como erro, sem tentar adivinhar; se não houver correspondência, sugere nomes parecidos para que quem chamou possa
 * corrigir o nome em vez de tentar novamente às cegas.
 */
export async function resolveItem(
  ctx: McpCtx,
  resolvedBusinessId: string,
  itemId: string | undefined,
  itemName: string | undefined,
  position = 'este item de linha'
): Promise<ItemRow> {
  if (itemId) {
    const { data, error } = await ctx.db.svc
      .from('items')
      .select('*')
      .eq('id', itemId)
      .eq('business_id', resolvedBusinessId)
      .maybeSingle()

    if (error) {
      console.error('resolveItem (by id):', error)
      throw new Error('Não foi possível buscar o item salvo.')
    }
    if (!data) {
      throw new ScopeError(`Não há item salvo ${itemId} nesta empresa (${position}). Chame list_items para consultar os itens existentes.`)
    }
    return data
  }

  if (!itemName) {
    throw new ScopeError(`Informe item_id ou item_name para identificar o item salvo no ${position}.`)
  }

  const escaped = escapeLike(itemName)

  const { data: exact, error } = await ctx.db.svc
    .from('items')
    .select('*')
    .eq('business_id', resolvedBusinessId)
    .ilike('name', escaped)

  if (error) {
    console.error('resolveItem (exact):', error)
    throw new Error('Não foi possível buscar o item salvo.')
  }

  if (exact && exact.length === 1) {
    return exact[0]
  }

  if (exact && exact.length > 1) {
    throw new ScopeError(
      `Há vários itens salvos chamados "${itemName}" nesta empresa; informe item_id para desambiguar: ${exact
        .map((i) => `"${i.name}" (${i.id})`)
        .join(', ')}.`
    )
  }

  const { data: close } = await ctx.db.svc
    .from('items')
    .select('id, name')
    .eq('business_id', resolvedBusinessId)
    .ilike('name', `%${escaped}%`)
    .limit(ITEM_LOOKUP_LIMIT)

  if (close && close.length > 0) {
    throw new ScopeError(
      `Nenhum item salvo chamado "${itemName}" foi encontrado nesta empresa. Você quis dizer: ${close
        .map((i) => `"${i.name}" (${i.id})`)
        .join(', ')}?`
    )
  }

  throw new ScopeError(
    `Nenhum item salvo chamado "${itemName}" foi encontrado nesta empresa. Chame list_items para consultar o catálogo ou create_item para adicioná-lo.`
  )
}
