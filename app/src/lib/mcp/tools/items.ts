import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import type { McpCtx } from '@/lib/mcp/context'
import { ScopeError } from '@/lib/mcp/scoped-db'
import { resolveItem } from '@/lib/mcp/line-items'
import { appUrl, errorResult, jsonResult, escapeLike, truncationNote } from '@/lib/mcp/shared'
import type { Database } from '@/types/database'

const UNITS = ['hour', 'day', 'week', 'month', 'project', 'item', 'unit'] as const

/**
 * As linhas de items têm as mesmas colunas de procedência (created_via,
 * created_by_key_id) que as demais tabelas graváveis por agentes.
 */
type ItemInsert = Database['public']['Tables']['items']['Insert']

/**
 * Registra as ferramentas do catálogo de itens salvos (create_item, update_item,
 * list_items), limitadas às empresas em ctx.db.scope.
 *
 * O catálogo torna possível, por exemplo, "faturar 3 horas de Consultoria" funcionar: create_invoice
 * e create_estimate aceitam item_id / item_name em cada linha e obtêm o
 * preço e a descrição salvos daqui (consulte src/lib/mcp/line-items.ts).
 */
export function registerItemTools(server: McpServer, ctx: McpCtx) {
  server.registerTool(
    'list_items',
    {
      title: 'Listar itens salvos',
      description:
        'Lista o catálogo de produtos e serviços salvos de uma empresa, com o preço salvo de cada item. Use antes de create_invoice ou create_estimate quando a pessoa mencionar um serviço ("Consultoria", "Retainer de design") para usar o preço salvo em vez de estimar. Não serve para consultar o que foi faturado em uma fatura específica; use get_invoice.',
      inputSchema: z.object({
        offset: z.number().int().min(0).max(1000000).optional().describe('Deslocamento da página. Comece em 0 e use next_offset até que seja null. Mantenha os demais filtros inalterados.'),
        business_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'ID da empresa cujo catálogo será listado. Opcional quando a chave de API tem escopo de uma única empresa; obrigatório quando abrange várias.'
          ),
        search: z
          .string()
          .max(200)
          .optional()
          .describe('Busca por trecho do nome do item, sem diferenciar maiúsculas de minúsculas. Omita para listar todos.'),
        include_inactive: z
          .boolean()
          .optional()
          .describe('Inclui itens desativados. O padrão é false (somente itens ativos).'),
        limit: z.number().int().min(1).max(200).optional().describe('Máximo de itens a retornar (padrão 50, máximo 200).'),
      }),
    },
    async ({ offset, business_id, search, include_inactive, limit }) => {
      let resolvedBusinessId: string
      try {
        resolvedBusinessId = ctx.db.resolveBusinessId(business_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar a empresa.')
      }

      const resolvedLimit = limit ?? 50

      let query = ctx.db.svc
        .from('items')
        .select('id, name, description, type, rate, unit, tax_rate, is_active')
        .eq('business_id', resolvedBusinessId)
        .order('name', { ascending: true })
        .order('id', { ascending: true })
        .range(offset ?? 0, (offset ?? 0) + resolvedLimit - 1)

      if (!include_inactive) {
        query = query.eq('is_active', true)
      }
      if (search) {
        query = query.ilike('name', `%${escapeLike(search)}%`)
      }

      const { data, error } = await query

      if (error) {
        console.error('list_items:', error)
        return errorResult('Não foi possível listar os itens salvos.')
      }

      const items = data ?? []
      const truncated = items.length === resolvedLimit

      return jsonResult({
        offset: offset ?? 0,
        next_offset: (data ?? []).length === resolvedLimit ? (offset ?? 0) + resolvedLimit : null,
        summary: `${items.length} item salvo${items.length === 1 ? '' : 's'}${truncated ? truncationNote(resolvedLimit) : ''}`,
        items,
        app_url: `${appUrl()}/items`,
      })
    }
  )

  server.registerTool(
    'create_item',
    {
      title: 'Criar item salvo',
      description:
        'Adiciona um produto ou serviço ao catálogo para que futuras faturas e estimativas possam cobrá-lo pelo nome e por um preço consistente. Use quando a pessoa disser "minha tarifa para X é Y" ou quiser uma linha reutilizável. NÃO use para adicionar uma linha avulsa a uma fatura existente; passe line_items para create_invoice ou update_draft_invoice.',
      inputSchema: z.object({
        business_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'ID da empresa à qual adicionar o item. Opcional quando a chave de API tem escopo de uma única empresa; obrigatório quando abrange várias.'
          ),
        name: z
          .string()
          .min(1)
          .max(200)
          .describe('Nome curto no catálogo, por exemplo "Consultoria". Este é o nome usado depois em item_name; escolha um nome distinto.'),
        rate: z.number().min(0).describe('Preço padrão por unidade, na moeda da empresa.'),
        description: z
          .string()
          .max(500)
          .optional()
          .describe('Descrição mais longa usada como texto da linha da fatura. Se omitida, o nome será usado.'),
        unit: z
          .enum(UNITS)
          .optional()
          .describe('Unidade usada para expressar o preço, por exemplo "hora". Apenas para exibição; não afeta os cálculos.'),
        type: z.enum(['service', 'product']).optional().describe('Tipo de item. O padrão é "service".'),
        tax_rate: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe('Percentual de imposto padrão salvo com o item. O padrão é 0.'),
      }),
    },
    async ({ business_id, name, rate, description, unit, type, tax_rate }) => {
      let resolvedBusinessId: string
      try {
        resolvedBusinessId = ctx.db.resolveBusinessId(business_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar a empresa.')
      }

      const { data: existing, error: existingError } = await ctx.db.svc
        .from('items')
        .select('id, name, rate')
        .eq('business_id', resolvedBusinessId)
        .ilike('name', escapeLike(name))
        .limit(1)

      if (existingError) {
        console.error('create_item (duplicate check):', existingError)
        return errorResult('Não foi possível verificar se já existe um item com esse nome.')
      }

      if (existing && existing.length > 0) {
        return errorResult(
          `Já existe um item chamado "${existing[0].name}" nesta empresa (${existing[0].id}, preço ${existing[0].rate}). Use update_item para alterar o preço em vez de criar uma duplicata.`
        )
      }

      const payload: ItemInsert = {
        business_id: resolvedBusinessId,
        name,
        rate,
        description: description ?? null,
        unit: unit ?? null,
        type: type ?? 'service',
        tax_rate: tax_rate ?? 0,
        is_active: true,
        created_via: 'agent',
        created_by_key_id: ctx.keyId,
      }

      const { data: item, error } = await ctx.db.svc.from('items').insert(payload).select('*').single()

      if (error || !item) {
        console.error('create_item (insert):', error)
        return errorResult('Não foi possível criar o item salvo.')
      }

      return jsonResult({
        summary: `Item "${item.name}" salvo por ${item.rate}${item.unit ? ` por ${item.unit}` : ''}`,
        item: {
          id: item.id,
          business_id: item.business_id,
          name: item.name,
          description: item.description,
          type: item.type,
          rate: item.rate,
          unit: item.unit,
          tax_rate: item.tax_rate,
          is_active: item.is_active,
        },
        app_url: `${appUrl()}/items/${item.id}`,
      })
    }
  )

  server.registerTool(
    'update_item',
    {
      title: 'Atualizar item salvo',
      description:
        'Altera preço, nome, descrição, unidade ou indicador de ativo de um item salvo. Identifique-o por item_id ou pelo item_name exato. As alterações valem somente para FUTURAS faturas e estimativas; documentos já emitidos mantêm o preço cobrado. Não use para corrigir uma fatura (use update_draft_invoice).',
      inputSchema: z.object({
        business_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'ID da empresa à qual o item pertence. Opcional quando a chave de API tem escopo de uma única empresa; obrigatório quando abrange várias.'
          ),
        item_id: z.string().uuid().optional().describe('ID do item a atualizar. Informe este campo ou item_name.'),
        item_name: z
          .string()
          .max(200)
          .optional()
          .describe('Nome atual exato do item (sem diferenciar maiúsculas de minúsculas). Informe este campo ou item_id.'),
        name: z.string().min(1).max(200).optional().describe('Novo nome no catálogo.'),
        rate: z.number().min(0).optional().describe('Novo preço padrão por unidade.'),
        description: z.string().max(500).optional().describe('Nova descrição usada como texto da linha da fatura.'),
        unit: z.enum(UNITS).optional().describe('Nova unidade usada para expressar o preço.'),
        type: z.enum(['service', 'product']).optional().describe('Novo tipo de item.'),
        tax_rate: z.number().min(0).max(100).optional().describe('Novo percentual de imposto padrão.'),
        is_active: z
          .boolean()
          .optional()
          .describe('Defina como false para desativar o item sem excluí-lo. Por padrão, itens desativados ficam ocultos em list_items.'),
      }),
    },
    async ({ business_id, item_id, item_name, name, rate, description, unit, type, tax_rate, is_active }) => {
      let resolvedBusinessId: string
      try {
        resolvedBusinessId = ctx.db.resolveBusinessId(business_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar a empresa.')
      }

      let item
      try {
        item = await resolveItem(ctx, resolvedBusinessId, item_id, item_name)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível localizar o item salvo.')
      }

      const updates: Database['public']['Tables']['items']['Update'] = {}
      if (name !== undefined) updates.name = name
      if (rate !== undefined) updates.rate = rate
      if (description !== undefined) updates.description = description
      if (unit !== undefined) updates.unit = unit
      if (type !== undefined) updates.type = type
      if (tax_rate !== undefined) updates.tax_rate = tax_rate
      if (is_active !== undefined) updates.is_active = is_active

      if (Object.keys(updates).length === 0) {
        return errorResult('Nada para atualizar. Informe pelo menos um campo para alterar.')
      }

      const { data: updated, error } = await ctx.db.svc
        .from('items')
        .update(updates)
        .eq('id', item.id)
        .eq('business_id', resolvedBusinessId)
        .select('*')
        .single()

      if (error || !updated) {
        console.error('update_item (update):', error)
        return errorResult('Não foi possível atualizar o item salvo.')
      }

      return jsonResult({
        summary: `Atualizado "${updated.name}" (${Object.keys(updates).join(', ')})`,
        item: {
          id: updated.id,
          business_id: updated.business_id,
          name: updated.name,
          description: updated.description,
          type: updated.type,
          rate: updated.rate,
          unit: updated.unit,
          tax_rate: updated.tax_rate,
          is_active: updated.is_active,
        },
        app_url: `${appUrl()}/items/${updated.id}`,
      })
    }
  )
}
