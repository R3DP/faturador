import { secondsFromHours, timeAmount, entrySeconds } from '@/lib/work/time'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import type { McpCtx } from '@/lib/mcp/context'
import { ScopeError } from '@/lib/mcp/scoped-db'
import { resolveClient } from './invoices-write'
import type { Database } from '@/types/database'
import { appUrl, errorResult, jsonResult, formatCurrency, truncationNote } from '@/lib/mcp/shared'
import { todayISO } from '@/lib/dates'

const UNBILLED_LIMIT = 500

type ClientRow = Database['public']['Tables']['clients']['Row']

function today(): string {
  return todayISO()
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

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

/**
 * Resolve um cliente opcional para log_expense: diferentemente de resolveClient (usado por
 * create_invoice / log_time, que exigem cliente), uma despesa pode
 * legitimamente não ter cliente. Retorna null quando nem client_id nem
 * client_name é informado; caso contrário, delega a resolveClient.
 */
async function resolveOptionalClient(
  ctx: McpCtx,
  resolvedBusinessId: string,
  client_id: string | undefined,
  client_name: string | undefined
): Promise<ClientRow | null> {
  if (!client_id && !client_name) {
    return null
  }
  return resolveClient(ctx, resolvedBusinessId, client_id, client_name)
}

/**
 * Registra as ferramentas de lançamento de trabalho (log_time, log_expense, list_unbilled) no
 * servidor MCP fornecido, limitadas às empresas em ctx.db.scope.
 *
 * Mapeamento do esquema (consulte supabase/migrations/00001_baseline.sql e os
 * caminhos de inserção do próprio app em src/app/(app)/time/new/page.tsx e
 * src/app/(app)/expenses/new/page.tsx, espelhados por estas ferramentas):
 *   time_entries: hours -> duration_minutes (hours * 60, arredondadas); rate ->
 *     hourly_rate (aceita null: permanece null, não 0, quando omitida pelo usuário, para que
 *     list_unbilled diferencie "sem tarifa" de "tarifa explicitamente igual a $0");
 *     amount = hours * rate quando uma tarifa é informada; caso contrário, null; billable ->
 *     is_billable (padrão true); "unbilled" = invoice_id IS NULL.
 *   expenses: amount é um DECIMAL simples (sem conversão de unidades); billable ->
 *     is_billable (padrão true apenas quando há um cliente associado, pois uma
 *     despesa sem cliente não pode ser incluída na fatura de um cliente); currency
 *     vem de default_currency da empresa, conforme o formulário de despesas do app;
 *     "unbilled" = invoice_id IS NULL.
 */
export function registerWorkTools(server: McpServer, ctx: McpCtx) {
  server.registerTool(
    'log_time',
    {
      title: 'Registrar tempo',
      description:
        'Registra um lançamento de tempo para um cliente, identificado por client_id ou client_name (correspondência exata, sem diferenciar maiúsculas de minúsculas). Faturável por padrão.',
      inputSchema: z.object({
        request_id: z.uuid().describe('Identificador estável do lançamento. Reutilize a mesma entrada em novas tentativas.'),
        business_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'Id da empresa em que o tempo será registrado. Opcional quando a chave de API está limitada a uma única empresa; obrigatório quando está limitada a várias.'
          ),
        client_id: z.string().uuid().optional().describe('Id do cliente. Informe este campo ou client_name.'),
        client_name: z
          .string()
          .max(200)
          .optional()
          .describe('Nome exato do cliente (sem diferenciar maiúsculas de minúsculas). Informe este campo ou client_id.'),
        description: z.string().min(1).max(500).describe('Atividade realizada nesse período.'),
        hours: z.number().gt(0).lte(24).describe('Horas trabalhadas, > 0 e <= 24.'),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD')
          .optional()
          .describe('Data do trabalho, YYYY-MM-DD. O padrão é hoje.'),
        rate: z
          .number()
          .min(0)
          .optional()
          .describe(
            'Tarifa por hora deste lançamento. Se omitida, o lançamento é registrado sem tarifa e sinalizado por list_unbilled para confirmação antes do faturamento.'
          ),
        billable: z.boolean().optional().describe('Indica se este tempo pode ser faturado. O padrão é true.'),
      }),
    },
    async ({ request_id, business_id, client_id, client_name, description, hours, date, rate, billable }) => {
      let resolvedBusinessId: string
      try {
        resolvedBusinessId = ctx.db.resolveBusinessId(business_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar a empresa.')
      }

      let client: ClientRow
      try {
        client = await resolveClient(ctx, resolvedBusinessId, client_id, client_name)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar o cliente.')
      }

      const resolvedDate = date || today()
      const isBillable = billable ?? true
      const durationSeconds = secondsFromHours(hours)
      const hourlyRate = rate ?? null
      const amount = timeAmount(durationSeconds, hourlyRate)

      const {data:created,error}=await ctx.db.svc.rpc('create_work_entry_once',{p_business_id:resolvedBusinessId,p_kind:'time',p_request_id:request_id,p_key_id:ctx.keyId,p_record:{
          business_id: resolvedBusinessId,
          client_id: client.id,
          description,
          date: resolvedDate,
          currency: client.currency,
          duration_seconds: durationSeconds,
          hourly_rate: hourlyRate,
          amount,
          is_billable: isBillable,
          is_billed: false,
          created_via: 'agent',
          created_by_key_id: ctx.keyId,
        }})
      const entry=created as Database['public']['Tables']['time_entries']['Row'] | null

      if (error || !entry) {
        console.error('log_time (insert):', error)
        return errorResult('Não foi possível registrar o lançamento de tempo.')
      }

      const noRateNote = rate === undefined ? ' (sem tarifa definida; confirme antes de faturar)' : ''
      const result = {
        summary: `Tempo registrado: ${hours}h para ${client.name}${noRateNote}`,
        time_entry: {
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
        app_url: `${appUrl()}/time`,
      }

      return jsonResult(result)
    }
  )

  server.registerTool(
    'log_expense',
    {
      title: 'Registrar despesa',
      description:
        "Registra uma despesa da empresa. O cliente é opcional; identifique-o por client_id ou client_name (correspondência exata, sem diferenciar maiúsculas de minúsculas) para associar a despesa a um faturamento futuro.",
      inputSchema: z.object({
        request_id: z.uuid().describe('Identificador estável do lançamento. Reutilize a mesma entrada em novas tentativas.'),
        business_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'Id da empresa em que a despesa será registrada. Opcional quando a chave de API está limitada a uma única empresa; obrigatório quando está limitada a várias.'
          ),
        client_id: z.string().uuid().optional().describe('Id do cliente relacionado a esta despesa, se houver.'),
        client_name: z
          .string()
          .max(200)
          .optional()
          .describe('Nome exato do cliente relacionado a esta despesa (sem diferenciar maiúsculas de minúsculas), se houver.'),
        description: z.string().min(1).max(500).describe('Finalidade da despesa.'),
        amount: z.number().gt(0).describe('Valor da despesa; deve ser > 0.'),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD')
          .optional()
          .describe('Data da despesa, YYYY-MM-DD. O padrão é hoje.'),
        category: z
          .enum(EXPENSE_CATEGORIES)
          .optional()
          .describe('Categoria da despesa. O padrão é "other".'),
        billable: z
          .boolean()
          .optional()
          .describe(
            'Indica se esta despesa pode ser faturada ao cliente. O padrão é true quando há um cliente associado e false nos demais casos.'
          ),
      }),
    },
    async ({ request_id, business_id, client_id, client_name, description, amount, date, category, billable }) => {
      let resolvedBusinessId: string
      try {
        resolvedBusinessId = ctx.db.resolveBusinessId(business_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar a empresa.')
      }

      let client: ClientRow | null
      try {
        client = await resolveOptionalClient(ctx, resolvedBusinessId, client_id, client_name)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar o cliente.')
      }

      const { data: business, error: businessError } = await ctx.db.svc
        .from('businesses')
        .select('default_currency')
        .eq('id', resolvedBusinessId)
        .maybeSingle()

      if (businessError || !business) {
        console.error('log_expense (business):', businessError)
        return errorResult('Não foi possível carregar os dados da empresa.')
      }

      const resolvedDate = date || today()
      const isBillable = billable ?? !!client

      const {data:created,error}=await ctx.db.svc.rpc('create_work_entry_once',{p_business_id:resolvedBusinessId,p_kind:'expense',p_request_id:request_id,p_key_id:ctx.keyId,p_record:{
          business_id: resolvedBusinessId,
          client_id: client?.id ?? null,
          category: category ?? 'other',
          description,
          amount,
          currency: client?.currency || business.default_currency,
          date: resolvedDate,
          is_billable: isBillable,
          is_billed: false,
          created_via: 'agent',
          created_by_key_id: ctx.keyId,
        }})
      const expense=created as Database['public']['Tables']['expenses']['Row'] | null

      if (error || !expense) {
        console.error('log_expense (insert):', error)
        return errorResult('Não foi possível registrar a despesa.')
      }

      const forClient = client ? ` para ${client.name}` : ''
      const result = {
        summary: `Despesa registrada: ${formatCurrency(amount, expense.currency)}${forClient}`,
        expense: {
          id: expense.id,
          business_id: expense.business_id,
          client_id: expense.client_id,
          description: expense.description,
          amount: expense.amount,
          currency: expense.currency,
          date: expense.date,
          category: expense.category,
          is_billable: expense.is_billable,
        },
        app_url: `${appUrl()}/expenses`,
      }

      return jsonResult(result)
    }
  )

  server.registerTool(
    'list_unbilled',
    {
      title: 'Listar trabalho não faturado',
      description:
        'Lista lançamentos de tempo e despesas faturáveis ainda não associados a uma fatura, agrupados por cliente e com seus totais. Use para preparar uma fatura com o trabalho não faturado de um cliente; lançamentos sem tarifa por hora são sinalizados. Lançamentos faturáveis sem cliente não podem ser agrupados em uma fatura de cliente; por isso, são excluídos de `clients`, mas aparecem no resumo e no campo `unassigned`.',
      inputSchema: z.object({
        offset: z.number().int().min(0).max(1000000).optional().describe('Deslocamento da página de lançamentos de tempo e despesas. Os totais se aplicam somente a esta página; use next_offset para consultar o restante.'),
        business_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'Id da empresa cujos trabalhos não faturados serão listados. Opcional quando a chave de API está limitada a uma única empresa; obrigatório quando está limitada a várias.'
          ),
        client_id: z.string().uuid().optional().describe('Restringe a um único cliente.'),
      }),
    },
    async ({ offset, business_id, client_id }) => {
      let resolvedBusinessId: string
      try {
        resolvedBusinessId = ctx.db.resolveBusinessId(business_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar a empresa.')
      }

      if (client_id) {
        try {
          const client = await ctx.db.assertClientAccess(client_id)
          if (client.business_id !== resolvedBusinessId) {
            return errorResult(`O cliente ${client_id} não pertence à empresa ${resolvedBusinessId}.`)
          }
        } catch (err) {
          return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível acessar o cliente.')
        }
      }

      const { data: business, error: businessError } = await ctx.db.svc
        .from('businesses')
        .select('default_currency')
        .eq('id', resolvedBusinessId)
        .maybeSingle()

      if (businessError || !business) {
        console.error('list_unbilled (business):', businessError)
        return errorResult('Não foi possível carregar os dados da empresa.')
      }

      let timeQuery = ctx.db.svc
        .from('time_entries')
        .select('id, client_id, currency, description, date, duration_seconds, duration_minutes, hourly_rate, amount, clients(name)')
        .eq('business_id', resolvedBusinessId)
        .eq('is_billable', true)
        .is('invoice_id', null)
        .order('date', { ascending: true })
        .order('id',{ascending:true}).range(offset ?? 0, (offset ?? 0)+UNBILLED_LIMIT-1)

      let expenseQuery = ctx.db.svc
        .from('expenses')
        .select('id, client_id, currency, description, date, amount, category, clients(name)')
        .eq('business_id', resolvedBusinessId)
        .eq('is_billable', true)
        .is('invoice_id', null)
        .order('date', { ascending: true })
        .order('id',{ascending:true}).range(offset ?? 0, (offset ?? 0)+UNBILLED_LIMIT-1)

      if (client_id) {
        timeQuery = timeQuery.eq('client_id', client_id)
        expenseQuery = expenseQuery.eq('client_id', client_id)
      }

      const [{ data: timeRows, error: timeError }, { data: expenseRows, error: expenseError }] =
        await Promise.all([timeQuery, expenseQuery])

      if (timeError) {
        console.error('list_unbilled (time_entries):', timeError)
        return errorResult('Não foi possível carregar os lançamentos de tempo não faturados.')
      }

      if (expenseError) {
        console.error('list_unbilled (expenses):', expenseError)
        return errorResult('Não foi possível carregar as despesas não faturadas.')
      }

      interface ClientBucket {
        client_id: string
        client_name: string
        currency: string
        time: {
          id: string
          date: string
          description: string | null
          hours: number
          rate: number | null
          amount: number
          missing_rate: boolean
        }[]
        expenses: {
          id: string
          date: string
          description: string | null
          category: string | null
          amount: number
        }[]
        total_unbilled: number
      }

      const buckets = new Map<string, ClientBucket>()
      let missingRateCount = 0
      let unassignedTimeCount = 0
      let unassignedExpenseCount = 0
      let unassignedTotal = 0
      const unassignedByCurrency: Record<string,number> = {}

      function bucketFor(clientId: string, clientName: string | null, currency: string): ClientBucket {
        const key = `${clientId}:${currency}`
        let bucket = buckets.get(key)
        if (!bucket) {
          bucket = {
            client_id: clientId,
            client_name: clientName ?? 'Cliente desconhecido',
            currency,
            time: [],
            expenses: [],
            total_unbilled: 0,
          }
          buckets.set(key, bucket)
        }
        return bucket
      }

      for (const row of timeRows ?? []) {
        const hours = entrySeconds(row) / 3600
        const missingRate = row.hourly_rate === null
        const amount = round2(hours * (row.hourly_rate ?? 0))

        if (!row.client_id) {
          // Faturável e não faturado, mas sem cliente associado; portanto, não pode ser
          // agrupado em uma fatura por cliente. É contabilizado separadamente (em
          // `unassigned` abaixo), em vez de ser descartado, para continuar visível.
          unassignedTimeCount += 1
          unassignedTotal = round2(unassignedTotal + amount)
          unassignedByCurrency[row.currency]=round2((unassignedByCurrency[row.currency]||0)+amount)
          continue
        }

        if (missingRate) missingRateCount += 1
        const clientName = (row.clients as { name: string } | null)?.name ?? null
        const bucket = bucketFor(row.client_id, clientName, row.currency)
        bucket.time.push({
          id: row.id,
          date: row.date,
          description: row.description,
          hours,
          rate: row.hourly_rate,
          amount,
          missing_rate: missingRate,
        })
        bucket.total_unbilled = round2(bucket.total_unbilled + amount)
      }

      for (const row of expenseRows ?? []) {
        if (!row.client_id) {
          unassignedExpenseCount += 1
          unassignedTotal = round2(unassignedTotal + row.amount)
          unassignedByCurrency[row.currency]=round2((unassignedByCurrency[row.currency]||0)+row.amount)
          continue
        }
        const clientName = (row.clients as { name: string } | null)?.name ?? null
        const bucket = bucketFor(row.client_id, clientName, row.currency)
        bucket.expenses.push({
          id: row.id,
          date: row.date,
          description: row.description,
          category: row.category,
          amount: row.amount,
        })
        bucket.total_unbilled = round2(bucket.total_unbilled + row.amount)
      }

      const clients = Array.from(buckets.values()).sort((a, b) => a.client_name.localeCompare(b.client_name))
      const totalsByCurrency: Record<string, number> = {}
      for(const c of clients) totalsByCurrency[c.currency]=round2((totalsByCurrency[c.currency]||0)+c.total_unbilled)
      const totalsLabel=Object.entries(totalsByCurrency).map(([currency,amount])=>formatCurrency(amount,currency)).join(', ')

      const countLabel = `${clients.length} grupo${clients.length === 1 ? '' : 's'} de faturamento`
      const totalVerb = clients.length === 1 ? 'totaliza' : 'totalizam'
      const rateNote = missingRateCount > 0
        ? ` (${missingRateCount} lançamento${missingRateCount === 1 ? '' : 's'} de tempo sem tarifa; confirme antes de faturar)`
        : ''

      const unassignedCount = unassignedTimeCount + unassignedExpenseCount
      const unassignedNote =
        unassignedCount > 0
          ? ` (${unassignedTimeCount > 0 ? `${unassignedTimeCount} lançamento${unassignedTimeCount === 1 ? '' : 's'} de tempo` : ''}${unassignedTimeCount > 0 && unassignedExpenseCount > 0 ? ' e ' : ''}${unassignedExpenseCount > 0 ? `${unassignedExpenseCount} despesa${unassignedExpenseCount === 1 ? '' : 's'}` : ''} sem cliente e fora dos grupos por cliente; informe um cliente para faturar esses itens)`
          : ''

      const summary =
        clients.length === 0 && unassignedCount === 0
          ? 'Nenhum trabalho não faturado encontrado.'
          : clients.length === 0
            ? `Nenhum trabalho não faturado atribuído a cliente foi encontrado${unassignedNote}.`
            : `${countLabel} ${totalVerb} ${totalsLabel} em trabalho não faturado${rateNote}${unassignedNote}`

      // Se qualquer um dos conjuntos atingir seu próprio limite, os totais agrupados abaixo serão
      // parciais; informe isso para evitar que o usuário emita uma fatura com base em dados
      // incompletos.
      const truncated =
        (timeRows ?? []).length === UNBILLED_LIMIT || (expenseRows ?? []).length === UNBILLED_LIMIT

      const result: {
        offset: number
        next_offset: number | null
        page_totals: true
        summary: string
        clients: ClientBucket[]
        truncated?: true
        unassigned?: { time_count: number; expense_count: number; totals_by_currency: Record<string,number> }
      } = {
        offset: offset ?? 0,
        next_offset: truncated ? (offset ?? 0)+UNBILLED_LIMIT : null,
        page_totals: true,
        summary: `${summary}${truncated ? truncationNote(UNBILLED_LIMIT) : ''}`,
        clients,
      }

      if (truncated) {
        result.truncated = true
      }

      if (unassignedCount > 0) {
        result.unassigned = {
          time_count: unassignedTimeCount,
          expense_count: unassignedExpenseCount,
          totals_by_currency: unassignedByCurrency,
        }
      }

      return jsonResult(result)
    }
  )
}
