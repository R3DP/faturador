import { secondsFromHours, timeAmount, entrySeconds } from '@/lib/work/time'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import type { McpCtx } from '@/lib/mcp/context'
import { ScopeError } from '@/lib/mcp/scoped-db'
import { resolveClient } from './invoices-write'
import { appUrl, errorResult, jsonResult, truncationNote } from '@/lib/mcp/shared'
import type { Database } from '@/types/database'

const DATE_FIELD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD')

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Registra as ferramentas de gerenciamento de lançamentos de tempo (list_time_entries,
 * update_time_entry, delete_time_entry) que complementam log_time em work.ts,
 * limitadas às empresas em ctx.db.scope.
 *
 * O mapeamento do esquema corresponde a log_time: hours são armazenadas em duration_minutes,
 * hourly_rate aceita null (null significa \"nenhuma tarifa acordada ainda\", o que é diferente
 * de um 0 explícito); amount = hours * rate, e um lançamento é considerado faturado
 * quando invoice_id está preenchido.
 *
 * Regra de segurança comum a update e delete: um lançamento já associado a uma
 * fatura é recusado. Editá-lo causaria uma divergência silenciosa em relação à fatura que o cliente
 * já recebeu.
 */
export function registerTimeTools(server: McpServer, ctx: McpCtx) {
  server.registerTool(
    'list_time_entries',
    {
      title: 'Listar lançamentos de tempo',
      description:
        'Lista o tempo registrado, filtrado por cliente, período e status de faturamento. Use para responder \"quantas horas dediquei a X\" ou encontrar o lançamento que precisa de correção. Para preparar uma fatura com trabalho não faturado, prefira list_unbilled, que agrupa por cliente e calcula os totais.',
      inputSchema: z.object({
        offset: z.number().int().min(0).max(1000000).optional().describe('Deslocamento da página. Comece em 0 e use next_offset até retornar null. Mantenha os outros filtros inalterados.'),
        business_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'Id da empresa cujos lançamentos de tempo serão listados. Opcional quando a chave de API está limitada a uma única empresa; obrigatório quando está limitada a várias.'
          ),
        client_id: z.string().uuid().optional().describe('Restringe a um cliente. Informe este campo ou client_name.'),
        client_name: z
          .string()
          .max(200)
          .optional()
          .describe('Nome exato do cliente (sem diferenciar maiúsculas de minúsculas) para filtrar. Informe este campo ou client_id.'),
        from: DATE_FIELD.optional().describe('Data inicial dos lançamentos a incluir, YYYY-MM-DD (inclusive).'),
        to: DATE_FIELD.optional().describe('Data final dos lançamentos a incluir, YYYY-MM-DD (inclusive).'),
        billed: z
          .enum(['billed', 'unbilled', 'all'])
          .optional()
          .describe(
            '"unbilled" retorna lançamentos ainda não incluídos em uma fatura; "billed" retorna lançamentos já faturados; "all" retorna ambos. O padrão é "all".'
          ),
        billable: z
          .boolean()
          .optional()
          .describe('Filtra pelo indicador de faturável. Omita para incluir tempos faturáveis e não faturáveis.'),
        limit: z.number().int().min(1).max(200).optional().describe('Número máximo de lançamentos retornados (padrão 50, máximo 200).'),
      }),
    },
    async ({ offset, business_id, client_id, client_name, from, to, billed, billable, limit }) => {
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
        .from('time_entries')
        .select(
          'id, client_id, currency, description, date, duration_seconds, duration_minutes, hourly_rate, amount, is_billable, is_billed, invoice_id, clients(name)'
        )
        .eq('business_id', resolvedBusinessId)
        .order('date', { ascending: false })
        .order('id', { ascending: true })
        .range(offset ?? 0, (offset ?? 0) + resolvedLimit - 1)

      if (clientFilterId) query = query.eq('client_id', clientFilterId)
      if (from) query = query.gte('date', from)
      if (to) query = query.lte('date', to)
      if (billable !== undefined) query = query.eq('is_billable', billable)
      if (billed === 'billed') query = query.not('invoice_id', 'is', null)
      if (billed === 'unbilled') query = query.is('invoice_id', null)

      const { data, error } = await query

      if (error) {
        console.error('list_time_entries:', error)
        return errorResult('Não foi possível listar os lançamentos de tempo.')
      }

      const rows = data ?? []
      const entries = rows.map((row) => {
        const hours = entrySeconds(row) / 3600
        return {
          id: row.id,
          date: row.date,
          client_id: row.client_id,
          client_name: (row.clients as { name: string } | null)?.name ?? null,
          description: row.description,
          hours,
          rate: row.hourly_rate,
          amount: row.amount,
          missing_rate: row.hourly_rate === null,
          currency: row.currency,
          is_billable: row.is_billable,
          is_billed: !!row.invoice_id,
          invoice_id: row.invoice_id,
        }
      })

      const totalHours = round2(entries.reduce((sum, e) => sum + e.hours, 0))
      const truncated = entries.length === resolvedLimit

      return jsonResult({
        offset: offset ?? 0,
        next_offset: (data ?? []).length === resolvedLimit ? (offset ?? 0) + resolvedLimit : null,
        summary: `${entries.length} lançamento${entries.length === 1 ? '' : 's'} de tempo, ${totalHours}h no total${truncated ? truncationNote(resolvedLimit) : ''}`,
        total_hours: totalHours,
        entries,
        app_url: `${appUrl()}/time`,
      })
    }
  )

  server.registerTool(
    'update_time_entry',
    {
      title: 'Atualizar lançamento de tempo',
      description:
        'Corrige um único lançamento de tempo: suas horas, tarifa, descrição, data, cliente ou indicador de faturável. Use para corrigir um erro antes de faturar o trabalho. Recusa lançamentos já associados a uma fatura, pois alterá-los não modificaria a fatura recebida pelo cliente.',
      inputSchema: z.object({
        time_entry_id: z
          .string()
          .uuid()
          .describe('Id do lançamento a atualizar, obtido em list_time_entries ou list_unbilled. Apenas um lançamento será afetado.'),
        description: z.string().min(1).max(500).optional().describe('Nova descrição da atividade realizada nesse período.'),
        hours: z.number().gt(0).lte(24).describe('Novas horas trabalhadas, > 0 e <= 24.').optional(),
        date: DATE_FIELD.optional().describe('Nova data do trabalho, YYYY-MM-DD.'),
        rate: z
          .number()
          .min(0)
          .optional()
          .describe('Nova tarifa por hora. Ao defini-la, o valor do lançamento também é recalculado como hours * rate.'),
        client_id: z.string().uuid().optional().describe('Reatribui a este id de cliente. Informe este campo ou client_name.'),
        client_name: z
          .string()
          .max(200)
          .optional()
          .describe('Reatribui ao cliente com este nome exato (sem diferenciar maiúsculas de minúsculas). Informe este campo ou client_id.'),
        billable: z.boolean().optional().describe('Novo indicador de faturável. Tempos não faturáveis nunca aparecem em list_unbilled.'),
      }),
    },
    async ({ time_entry_id, description, hours, date, rate, client_id, client_name, billable }) => {
      let entry
      try {
        entry = await ctx.db.assertTimeEntryAccess(time_entry_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível acessar o lançamento de tempo.')
      }

      if (entry.invoice_id) {
        return errorResult(
          `O lançamento de tempo ${time_entry_id} já foi faturado na fatura ${entry.invoice_id} e não pode ser editado. Ajuste a própria fatura ou registre um lançamento separado para correção.`
        )
      }

      let reassignedClientId: string | undefined
      let reassignedClientName: string | undefined
      if (client_id || client_name) {
        try {
          const client = await resolveClient(ctx, entry.business_id, client_id, client_name)
          reassignedClientId = client.id
          reassignedClientName = client.name
        } catch (err) {
          return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar o cliente.')
        }
      }

      const updates: Database['public']['Tables']['time_entries']['Update'] = {}
      if (description !== undefined) updates.description = description
      if (date !== undefined) updates.date = date
      if (billable !== undefined) updates.is_billable = billable
      if (reassignedClientId !== undefined) updates.client_id = reassignedClientId
      if (hours !== undefined) updates.duration_seconds = secondsFromHours(hours)
      if (rate !== undefined) updates.hourly_rate = rate

      // amount é derivado; portanto, recalcule-o sempre que qualquer uma das entradas for alterada, usando
      // os valores posteriores à atualização, e não uma combinação de valores antigos e novos.
      if (hours !== undefined || rate !== undefined) {
        const effectiveHours = hours ?? entrySeconds(entry) / 3600
        const effectiveRate = rate ?? entry.hourly_rate
        updates.amount = effectiveRate === null ? null : timeAmount(secondsFromHours(effectiveHours), effectiveRate)
      }

      if (Object.keys(updates).length === 0) {
        return errorResult('Nada para atualizar. Informe pelo menos um campo para alterar.')
      }

      const { data: updated, error } = await ctx.db.svc
        .from('time_entries')
        .update(updates)
        .eq('id', time_entry_id)
        .eq('business_id', entry.business_id)
        .select('*')
        .single()

      if (error || !updated) {
        console.error('update_time_entry (update):', error)
        return errorResult('Não foi possível atualizar o lançamento de tempo.')
      }

      const updatedHours = entrySeconds(updated) / 3600
      const forClient = reassignedClientName ? ` (reatribuído a ${reassignedClientName})` : ''

      return jsonResult({
        summary: `Lançamento de tempo atualizado: ${updatedHours}h em ${updated.date}${forClient}`,
        time_entry: {
          id: updated.id,
          business_id: updated.business_id,
          client_id: updated.client_id,
          description: updated.description,
          date: updated.date,
          hours: updatedHours,
          rate: updated.hourly_rate,
          amount: updated.amount,
          currency: updated.currency,
          is_billable: updated.is_billable,
          is_billed: !!updated.invoice_id,
        },
        app_url: `${appUrl()}/time`,
      })
    }
  )

  server.registerTool(
    'delete_time_entry',
    {
      title: 'Excluir lançamento de tempo',
      description:
        'Exclui permanentemente UM lançamento de tempo pelo id e retorna os dados excluídos para que ele possa ser registrado novamente caso tenha sido um engano. Não há exclusão em lote nem por filtros, intencionalmente. Recusa lançamentos já associados a uma fatura. Prefira update_time_entry quando o lançamento contém um erro, em vez de excluí-lo.',
      inputSchema: z.object({
        time_entry_id: z
          .string()
          .uuid()
          .describe(
            'Id do único lançamento a excluir, obtido em list_time_entries. Obrigatório e exato: esta ferramenta nunca exclui por cliente, data ou qualquer outro filtro.'
          ),
      }),
    },
    async ({ time_entry_id }) => {
      let entry
      try {
        entry = await ctx.db.assertTimeEntryAccess(time_entry_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível acessar o lançamento de tempo.')
      }

      if (entry.invoice_id) {
        return errorResult(
          `O lançamento de tempo ${time_entry_id} já foi faturado na fatura ${entry.invoice_id} e não pode ser excluído. Ajuste a fatura.`
        )
      }

      const { error } = await ctx.db.svc
        .from('time_entries')
        .delete()
        .eq('id', time_entry_id)
        .eq('business_id', entry.business_id)

      if (error) {
        console.error('delete_time_entry (delete):', error)
        return errorResult('Não foi possível excluir o lançamento de tempo.')
      }

      const hours = round2(entrySeconds(entry) / 3600)

      return jsonResult({
        summary: `Lançamento de tempo excluído: ${hours}h em ${entry.date}. Esta ação não pode ser desfeita; se foi removido por engano, registre-o novamente com log_time.`,
        deleted_time_entry: {
          id: entry.id,
          business_id: entry.business_id,
          client_id: entry.client_id,
          description: entry.description,
          date: entry.date,
          hours,
          rate: entry.hourly_rate,
          amount: entry.amount,
          is_billable: entry.is_billable,
        },
      })
    }
  )
}
