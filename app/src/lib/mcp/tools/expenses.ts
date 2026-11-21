import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import type { McpCtx } from '@/lib/mcp/context'
import { ScopeError } from '@/lib/mcp/scoped-db'
import { resolveClient } from './invoices-write'
import { appUrl, errorResult, jsonResult, formatCurrency, truncationNote } from '@/lib/mcp/shared'
import type { Database } from '@/types/database'

const DATE_FIELD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD')

const EXPENSE_CATEGORIES = [
  'office',
  'travel',
  'meals',
  'supplies',
  'utilities',
  'software',
  'marketing',
  'professional',
  'insurance',
  'mileage',
  'other',
] as const

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Registra as ferramentas de gestão de despesas (list_expenses, update_expense,
 * delete_expense), complementares a log_expense em work.ts e limitadas às
 * empresas em ctx.db.scope.
 *
 * Uma despesa é considerada faturada quando invoice_id está definido; assim
 * como nas entradas de tempo, despesas faturadas não podem ser atualizadas nem
 * excluídas, evitando contradizer silenciosamente uma fatura já vista pelo cliente.
 *
 * Disciplina de moeda: cada despesa é armazenada em sua própria moeda; por isso,
 * os totais são agrupados por moeda e nunca somados entre moedas diferentes.
 */
export function registerExpenseTools(server: McpServer, ctx: McpCtx) {
  server.registerTool(
    'list_expenses',
    {
      title: 'Listar despesas',
      description:
        'Lista despesas filtradas por categoria, cliente, período e situação de faturamento, com totais agrupados por moeda. Use para "quanto gastei com software no último trimestre" ou para encontrar uma despesa a corrigir. Para refaturar custos ainda não faturados a um cliente, prefira list_unbilled.',
      inputSchema: z.object({
        offset: z.number().int().min(0).max(1000000).optional().describe('Deslocamento da página. Comece em 0 e use next_offset até que seja null. Mantenha os demais filtros inalterados.'),
        business_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'ID da empresa cujas despesas serão listadas. Opcional quando a chave de API tem escopo de uma única empresa; obrigatório quando abrange várias.'
          ),
        category: z
          .enum(EXPENSE_CATEGORIES)
          .optional()
          .describe('Limita a uma categoria de despesa. Omita para incluir todas as categorias.'),
        client_id: z.string().uuid().optional().describe('Limita a um cliente. Informe este campo ou client_name.'),
        client_name: z
          .string()
          .max(200)
          .optional()
          .describe('Nome exato do cliente (sem diferenciar maiúsculas de minúsculas) para filtrar. Informe este campo ou client_id.'),
        from: DATE_FIELD.optional().describe('Data inicial das despesas, no formato YYYY-MM-DD (inclusiva).'),
        to: DATE_FIELD.optional().describe('Data final das despesas, no formato YYYY-MM-DD (inclusiva).'),
        billed: z
          .enum(['billed', 'unbilled', 'all'])
          .optional()
          .describe(
            '"unbilled" retorna despesas ainda não incluídas em uma fatura, "billed" retorna as já faturadas, "all" retorna ambas. O padrão é "all".'
          ),
        billable: z
          .boolean()
          .optional()
          .describe('Filtra pelo indicador de faturável. Omita para incluir despesas faturáveis e não faturáveis.'),
        limit: z.number().int().min(1).max(200).optional().describe('Máximo de despesas a retornar (padrão 50, máximo 200).'),
      }),
    },
    async ({ offset, business_id, category, client_id, client_name, from, to, billed, billable, limit }) => {
      let resolvedBusinessId: string
      try {
        resolvedBusinessId = ctx.db.resolveBusinessId(business_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar a empresa.')
      }

      let clientFilterId: string | undefined
      if (client_id || client_name) {
        try {
          clientFilterId = (await resolveClient(ctx, resolvedBusinessId, client_id, client_name)).id
        } catch (err) {
          return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar o cliente.')
        }
      }

      const resolvedLimit = limit ?? 50

      let query = ctx.db.svc
        .from('expenses')
        .select(
          'id, client_id, description, vendor, category, date, amount, currency, is_billable, is_billed, invoice_id, clients(name)'
        )
        .eq('business_id', resolvedBusinessId)
        .order('date', { ascending: false })
        .order('id', { ascending: true })
        .range(offset ?? 0, (offset ?? 0) + resolvedLimit - 1)

      if (category) query = query.eq('category', category)
      if (clientFilterId) query = query.eq('client_id', clientFilterId)
      if (from) query = query.gte('date', from)
      if (to) query = query.lte('date', to)
      if (billable !== undefined) query = query.eq('is_billable', billable)
      if (billed === 'billed') query = query.not('invoice_id', 'is', null)
      if (billed === 'unbilled') query = query.is('invoice_id', null)

      const { data, error } = await query

      if (error) {
        console.error('list_expenses:', error)
        return errorResult('Não foi possível listar as despesas.')
      }

      const rows = data ?? []
      const expenses = rows.map((row) => ({
        id: row.id,
        date: row.date,
        client_id: row.client_id,
        client_name: (row.clients as { name: string } | null)?.name ?? null,
        description: row.description,
        vendor: row.vendor,
        category: row.category,
        amount: row.amount,
        currency: row.currency,
        is_billable: row.is_billable,
        is_billed: !!row.invoice_id,
        invoice_id: row.invoice_id,
      }))

      // Nunca some moedas diferentes: calcule um total separado e identificado para cada moeda.
      const byCurrency = new Map<string, number>()
      for (const expense of expenses) {
        byCurrency.set(expense.currency, round2((byCurrency.get(expense.currency) ?? 0) + expense.amount))
      }
      const totals = Array.from(byCurrency.entries()).map(([currency, total]) => ({ currency, total }))
      const totalsLabel = totals.map((t) => formatCurrency(t.total, t.currency)).join(', ')
      const truncated = expenses.length === resolvedLimit

      return jsonResult({
        offset: offset ?? 0,
        next_offset: (data ?? []).length === resolvedLimit ? (offset ?? 0) + resolvedLimit : null,
        summary: `${expenses.length} despesa${expenses.length === 1 ? '' : 's'}${totalsLabel ? ` totalizando ${totalsLabel}` : ''}${truncated ? truncationNote(resolvedLimit) : ''}`,
        totals_by_currency: totals,
        expenses,
        app_url: `${appUrl()}/expenses`,
      })
    }
  )

  server.registerTool(
    'update_expense',
    {
      title: 'Atualizar despesa',
      description:
        'Corrige uma despesa registrada: valor, descrição, fornecedor, categoria, data, cliente ou indicador de faturável. Use para corrigir um erro antes de refaturar o custo. Recusa despesas já vinculadas a uma fatura, pois alterá-las não mudaria a fatura recebida pelo cliente.',
      inputSchema: z.object({
        expense_id: z
          .string()
          .uuid()
          .describe('ID da despesa a atualizar, obtido por list_expenses ou list_unbilled. Somente uma despesa será afetada.'),
        description: z.string().min(1).max(500).optional().describe('Nova descrição do motivo da despesa.'),
        amount: z.number().gt(0).optional().describe('Novo valor da despesa, deve ser > 0. Mantém a moeda atual.'),
        date: DATE_FIELD.optional().describe('Nova data da despesa, no formato YYYY-MM-DD.'),
        category: z.enum(EXPENSE_CATEGORIES).optional().describe('Nova categoria da despesa.'),
        vendor: z.string().max(200).optional().describe('Novo nome do fornecedor ou estabelecimento.'),
        notes: z.string().max(2000).optional().describe('Novas observações internas; não são exibidas ao cliente.'),
        client_id: z.string().uuid().optional().describe('Transfere para este ID de cliente. Informe este campo ou client_name.'),
        client_name: z
          .string()
          .max(200)
          .optional()
          .describe('Transfere para o cliente com este nome exato (sem diferenciar maiúsculas de minúsculas). Informe este campo ou client_id.'),
        billable: z
          .boolean()
          .optional()
          .describe('Novo indicador de faturável. Despesas não faturáveis nunca aparecem em list_unbilled.'),
      }),
    },
    async ({ expense_id, description, amount, date, category, vendor, notes, client_id, client_name, billable }) => {
      let expense
      try {
        expense = await ctx.db.assertExpenseAccess(expense_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível acessar a despesa.')
      }

      if (expense.invoice_id) {
        return errorResult(
          `A despesa ${expense_id} já está vinculada à fatura ${expense.invoice_id} e não pode ser editada. Ajuste a própria fatura ou registre uma despesa separada para correção.`
        )
      }

      let reassignedClientId: string | undefined
      let reassignedClientName: string | undefined
      if (client_id || client_name) {
        try {
          const client = await resolveClient(ctx, expense.business_id, client_id, client_name)
          reassignedClientId = client.id
          reassignedClientName = client.name
        } catch (err) {
          return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar o cliente.')
        }
      }

      const updates: Database['public']['Tables']['expenses']['Update'] = {}
      if (description !== undefined) updates.description = description
      if (amount !== undefined) updates.amount = amount
      if (date !== undefined) updates.date = date
      if (category !== undefined) updates.category = category
      if (vendor !== undefined) updates.vendor = vendor
      if (notes !== undefined) updates.notes = notes
      if (billable !== undefined) updates.is_billable = billable
      if (reassignedClientId !== undefined) updates.client_id = reassignedClientId

      if (Object.keys(updates).length === 0) {
        return errorResult('Nada para atualizar. Informe pelo menos um campo para alterar.')
      }

      const { data: updated, error } = await ctx.db.svc
        .from('expenses')
        .update(updates)
        .eq('id', expense_id)
        .eq('business_id', expense.business_id)
        .select('*')
        .single()

      if (error || !updated) {
        console.error('update_expense (update):', error)
        return errorResult('Não foi possível atualizar a despesa.')
      }

      const forClient = reassignedClientName ? ` (atribuída novamente a ${reassignedClientName})` : ''

      return jsonResult({
        summary: `Despesa atualizada: ${formatCurrency(updated.amount, updated.currency)} em ${updated.date}${forClient}`,
        expense: {
          id: updated.id,
          business_id: updated.business_id,
          client_id: updated.client_id,
          description: updated.description,
          vendor: updated.vendor,
          category: updated.category,
          date: updated.date,
          amount: updated.amount,
          currency: updated.currency,
          is_billable: updated.is_billable,
          is_billed: !!updated.invoice_id,
        },
        app_url: `${appUrl()}/expenses`,
      })
    }
  )

  server.registerTool(
    'delete_expense',
    {
      title: 'Excluir despesa',
      description:
        'Exclui permanentemente UMA despesa pelo ID e retorna os dados excluídos para que ela possa ser registrada novamente caso tenha sido um engano. Não há exclusão em lote nem por filtros, intencionalmente. Recusa despesas já vinculadas a uma fatura. Prefira update_expense quando a despesa apenas estiver incorreta, em vez de indesejada.',
      inputSchema: z.object({
        expense_id: z
          .string()
          .uuid()
          .describe(
            'ID exato da única despesa a excluir, obtido por list_expenses. Obrigatório: esta ferramenta nunca exclui por categoria, cliente, data ou qualquer outro filtro.'
          ),
      }),
    },
    async ({ expense_id }) => {
      let expense
      try {
        expense = await ctx.db.assertExpenseAccess(expense_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível acessar a despesa.')
      }

      if (expense.invoice_id) {
        return errorResult(
          `A despesa ${expense_id} já está vinculada à fatura ${expense.invoice_id} e não pode ser excluída. Ajuste a própria fatura.`
        )
      }

      const { error } = await ctx.db.svc
        .from('expenses')
        .delete()
        .eq('id', expense_id)
        .eq('business_id', expense.business_id)

      if (error) {
        console.error('delete_expense (delete):', error)
        return errorResult('Não foi possível excluir a despesa.')
      }

      return jsonResult({
        summary: `Despesa excluída: ${formatCurrency(expense.amount, expense.currency)} em ${expense.date}. Esta ação não pode ser desfeita; registre novamente com log_expense se a exclusão foi um engano.`,
        deleted_expense: {
          id: expense.id,
          business_id: expense.business_id,
          client_id: expense.client_id,
          description: expense.description,
          vendor: expense.vendor,
          category: expense.category,
          date: expense.date,
          amount: expense.amount,
          currency: expense.currency,
          is_billable: expense.is_billable,
        },
      })
    }
  )
}
