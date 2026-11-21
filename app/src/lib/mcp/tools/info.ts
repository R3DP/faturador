import { createHash } from 'node:crypto'
import { z } from 'zod'
import { format, startOfMonth, endOfMonth, startOfYear, endOfYear, subMonths } from 'date-fns'
import type { McpServer } from '@modelcontextprotocol/server'
import type { McpCtx } from '@/lib/mcp/context'
import { ScopeError } from '@/lib/mcp/scoped-db'
import { appUrl, errorResult, jsonResult, formatCurrency, isOverdue, truncationNote } from '@/lib/mcp/shared'

const periodEnum = z.enum(['this_month', 'last_month', 'this_year', 'all'])

export type Period = z.infer<typeof periodEnum>

const EXCLUDED_FROM_TOTALS = new Set(['draft', 'cancelled'])

/** Formato das linhas usadas pelas funções puras de resumo abaixo. */
export interface SummaryRow {
  status: string
  total: number | null
  amount_paid: number | null
  balance_due: number | null
  currency: string
  due_date: string
  client_id: string | null
  clients?: { name: string } | null
}

const REVENUE_LIMIT = 5000

/**
 * Limites inclusivos de [start, end] de issue_date para um período de relatório, ou null para
 * "all" (sem filtro de data). `now` pode ser injetado para testar os limites
 * sem congelar o relógio do sistema.
 */
export function periodRange(period: Period, now: Date = new Date()): { start: string; end: string } | null {
  switch (period) {
    case 'this_month':
      return { start: format(startOfMonth(now), 'yyyy-MM-dd'), end: format(endOfMonth(now), 'yyyy-MM-dd') }
    case 'last_month': {
      const lastMonth = subMonths(now, 1)
      return { start: format(startOfMonth(lastMonth), 'yyyy-MM-dd'), end: format(endOfMonth(lastMonth), 'yyyy-MM-dd') }
    }
    case 'this_year':
      return { start: format(startOfYear(now), 'yyyy-MM-dd'), end: format(endOfYear(now), 'yyyy-MM-dd') }
    case 'all':
      return null
  }
}

/** Soma um campo monetário entre as linhas, arredondando para centavos. */
export function sumBy(rows: SummaryRow[], field: 'total' | 'amount_paid' | 'balance_due'): number {
  return Math.round(rows.reduce((sum, inv) => sum + (inv[field] ?? 0), 0) * 100) / 100
}

/**
 * Os 5 clientes com maior valor faturado, em ordem decrescente. Linhas sem client_id são
 * ignoradas (não podem ser atribuídas). Empates mantêm a ordem em que os clientes foram
 * vistos primeiro em `rows`, pois Array.prototype.sort é estável; para valores faturados iguais,
 * vence o cliente cuja primeira fatura aparece antes.
 */
export function topClients(rows: SummaryRow[]): { name: string; invoiced: number }[] {
  const byClient = new Map<string, { name: string; invoiced: number }>()
  for (const inv of rows) {
    if (!inv.client_id) continue
    const name = inv.clients?.name ?? 'Cliente desconhecido'
    const entry = byClient.get(inv.client_id) ?? { name, invoiced: 0 }
    entry.invoiced = Math.round((entry.invoiced + (inv.total ?? 0)) * 100) / 100
    byClient.set(inv.client_id, entry)
  }
  return Array.from(byClient.values())
    .sort((a, b) => b.invoiced - a.invoiced)
    .slice(0, 5)
}

export interface CurrencyTotals {
  currency: string
  invoiced_total: number
  paid_total: number
  outstanding_total: number
  overdue_total: number
  top_clients: { name: string; invoiced: number }[]
}

/**
 * Totais por moeda para as linhas fornecidas, na ordem em que cada moeda aparece primeiro.
 * Os totais nunca são somados entre moedas; o valor combinado não teria
 * significado.
 */
export function summarizeByCurrency(rows: SummaryRow[]): CurrencyTotals[] {
  const currencies = Array.from(new Set(rows.map((inv) => inv.currency)))
  return currencies.map((currency) => {
    const group = rows.filter((inv) => inv.currency === currency)
    const overdueRows = group.filter((inv) => isOverdue(inv.status, inv.due_date))
    return {
      currency,
      invoiced_total: sumBy(group, 'total'),
      paid_total: sumBy(group, 'amount_paid'),
      outstanding_total: sumBy(group, 'balance_due'),
      overdue_total: sumBy(overdueRows, 'balance_due'),
      top_clients: topClients(group),
    }
  })
}

/**
 * Registra as ferramentas informativas/de relatórios (list_businesses, get_business,
 * revenue_summary) no servidor MCP fornecido, limitadas às empresas em
 * ctx.db.scope.
 */
export function registerInfoTools(server: McpServer, ctx: McpCtx) {
  // ChatGPT e Codex usam esta ferramenta para distinguir as contas conectadas, permitindo que alguém
  // com dois logins do Faturador veja qual deles a conversa está usando. O id é
  // um hash do id do usuário: estável entre reconexões e diferente do id interno.
  server.registerTool(
    'get_profile',
    {
      title: 'Obter perfil',
      description:
        'Retorna a conta Faturador autenticada nesta conexão: um id opaco e estável, o nome e o endereço de e-mail. Use para confirmar qual login do Faturador está conectado; use list_businesses para consultar as empresas nas quais pode atuar.',
      inputSchema: z.object({}),
      outputSchema: z.object({
        id: z.string().min(1),
        name: z.string().optional(),
        email: z.string().optional(),
      }),
      _meta: { 'openai/profile': true },
    },
    async () => {
      const { data, error } = await ctx.db.svc.auth.admin.getUserById(ctx.userId)
      if (error || !data?.user) {
        console.error('get_profile:', error)
        return errorResult('Não foi possível carregar o perfil autenticado.')
      }
      const user = data.user
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>
      const name =
        (typeof meta.full_name === 'string' && meta.full_name) ||
        (typeof meta.name === 'string' && meta.name) ||
        undefined
      const profile = {
        id: createHash('sha256').update(`billr-profile:${ctx.userId}`).digest('hex').slice(0, 32),
        ...(name ? { name } : {}),
        ...(user.email ? { email: user.email } : {}),
      }
      return { ...jsonResult(profile), structuredContent: profile }
    }
  )

  server.registerTool(
    'list_businesses',
    {
      title: 'Listar empresas',
      description:
        "Lista todas as empresas nas quais esta chave de API pode atuar, em ordem alfabética. Chame primeiro quando não souber qual business_id informar às outras ferramentas. Se houver apenas uma, business_id pode ser omitido em todas elas.",
      inputSchema: z.object({}),
    },
    async () => {
      const { data, error } = await ctx.db.svc
        .from('businesses')
        .select('id, name, default_currency, invoice_prefix')
        .in('id', ctx.db.scope.businessIds)
        .order('name', { ascending: true })

      if (error) {
        console.error('list_businesses:', error)
        return errorResult('Não foi possível listar as empresas.')
      }

      const businesses = (data ?? []).map((b) => ({
        id: b.id,
        name: b.name,
        currency: b.default_currency,
        invoice_prefix: b.invoice_prefix,
        app_url: `${appUrl()}/settings/business`,
      }))

      const result = {
        summary: `${businesses.length} ${businesses.length === 1 ? 'empresa' : 'empresas'} no escopo: ${
          businesses.map((b) => b.name).join(', ') || 'nenhuma'
        }.`,
        businesses,
      }

      return jsonResult(result)
    }
  )

  server.registerTool(
    'get_business',
    {
      title: 'Obter empresa',
      description:
        "Consulta os detalhes de uma das empresas do usuário: nome, e-mail de contato, moeda e numeração de faturas. Se a chave de API estiver limitada a uma única empresa, business_id pode ser omitido.",
      inputSchema: z.object({
        business_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'Id da empresa a consultar. Opcional quando a chave de API está limitada a uma única empresa; obrigatório quando está limitada a várias.'
          ),
      }),
    },
    async ({ business_id }) => {
      let resolvedId: string
      try {
        resolvedId = ctx.db.resolveBusinessId(business_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar a empresa.')
      }

      const { data, error } = await ctx.db.svc
        .from('businesses')
        .select('id, name, email, default_currency, invoice_prefix, next_invoice_number')
        .eq('id', resolvedId)
        .maybeSingle()

      if (error || !data) {
        return errorResult(`Empresa ${resolvedId} não encontrada.`)
      }

      const result = {
        summary: `${data.name}: faturas com o prefixo "${data.invoice_prefix}", próximo número ${data.next_invoice_number}.`,
        business: {
          id: data.id,
          name: data.name,
          email: data.email,
          currency: data.default_currency,
          invoice_prefix: data.invoice_prefix,
          next_invoice_number: data.next_invoice_number,
        },
        app_url: appUrl(),
      }

      return jsonResult(result)
    }
  )

  server.registerTool(
    'revenue_summary',
    {
      title: 'Resumo de receita',
      description:
        'Resume os valores faturados, pagos, em aberto e vencidos de uma das empresas do usuário em um período (padrão: this_year), além das quantidades por status e dos 5 clientes com maior valor faturado. Faturas em rascunho e canceladas são excluídas de todos os totais monetários (mas continuam contabilizadas em by_status); "overdue" significa que ainda há saldo a pagar, o vencimento passou e o status é sent/viewed/partial; overdue_total faz parte de outstanding_total e não deve ser somado a ele.',
      inputSchema: z.object({
        business_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'Id da empresa a resumir. Opcional quando a chave de API está limitada a uma única empresa; obrigatório quando está limitada a várias.'
          ),
        period: periodEnum
          .optional()
          .describe(
            'Período do relatório, aplicado ao issue_date de cada fatura: "this_month", "last_month", "this_year" (padrão) ou "all" (sem filtro de data).'
          ),
      }),
    },
    async ({ business_id, period }) => {
      let resolvedId: string
      try {
        resolvedId = ctx.db.resolveBusinessId(business_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar a empresa.')
      }

      const resolvedPeriod = period ?? 'this_year'
      const range = periodRange(resolvedPeriod)

      let query = ctx.db.svc
        .from('invoices')
        .select('id, status, total, amount_paid, balance_due, currency, due_date, issue_date, client_id, clients(name)')
        .eq('business_id', resolvedId)
        .limit(REVENUE_LIMIT)

      if (range) {
        query = query.gte('issue_date', range.start).lte('issue_date', range.end)
      }

      const { data, error } = await query

      if (error) {
        console.error('revenue_summary:', error)
        return errorResult('Não foi possível calcular o resumo de receita.')
      }

      const invoices = (data ?? []) as unknown as SummaryRow[]
      const truncated = invoices.length === REVENUE_LIMIT
      const truncNote = truncated ? truncationNote(REVENUE_LIMIT) : ''

      const byStatus: Record<string, number> = {}
      for (const inv of invoices) {
        byStatus[inv.status] = (byStatus[inv.status] ?? 0) + 1
      }

      const counted = invoices.filter((inv) => !EXCLUDED_FROM_TOTALS.has(inv.status))
      const currencies = Array.from(new Set(counted.map((inv) => inv.currency)))

      const periodLabel = ({ this_month: 'este mês', last_month: 'mês passado', this_year: 'este ano', all: 'todo o período' } as const)[resolvedPeriod]

      if (currencies.length <= 1) {
        const currency = currencies[0] ?? null
        const invoicedTotal = sumBy(counted, 'total')
        const paidTotal = sumBy(counted, 'amount_paid')
        const outstandingTotal = sumBy(counted, 'balance_due')
        const overdueRows = counted.filter((inv) => isOverdue(inv.status, inv.due_date))
        const overdueTotal = sumBy(overdueRows, 'balance_due')

        const summary = currency
          ? `${periodLabel}: ${formatCurrency(invoicedTotal, currency)} faturados, ${formatCurrency(paidTotal, currency)} pagos, ${formatCurrency(outstandingTotal, currency)} em aberto (${formatCurrency(overdueTotal, currency)} vencidos).`
          : `${periodLabel}: nenhuma fatura encontrada.`

        const result = {
          summary: `${summary}${truncNote}`,
          period: resolvedPeriod,
          currency,
          invoiced_total: invoicedTotal,
          paid_total: paidTotal,
          outstanding_total: outstandingTotal,
          overdue_total: overdueTotal,
          by_status: byStatus,
          top_clients: topClients(counted),
          ...(truncated ? { truncated: true } : {}),
        }

        return jsonResult(result)
      }

      // Moedas diferentes na mesma empresa (algo incomum, mas possível se
      // a moeda de uma fatura foi alterada após sua criação): os totais não podem
      // ser somados entre moedas; portanto, são separados por moeda em vez de
      // retornar um total combinado sem significado.
      const byCurrency = summarizeByCurrency(counted)

      const summary = `${periodLabel} (moedas diferentes): ${byCurrency
        .map((c) => `${formatCurrency(c.invoiced_total, c.currency)} faturados`)
        .join('; ')}.`

      const result = {
        summary: `${summary}${truncNote}`,
        period: resolvedPeriod,
        currency: null,
        invoiced_total: null,
        paid_total: null,
        outstanding_total: null,
        overdue_total: null,
        by_currency: byCurrency,
        by_status: byStatus,
        top_clients: [],
        ...(truncated ? { truncated: true } : {}),
      }

      return jsonResult(result)
    }
  )
}
