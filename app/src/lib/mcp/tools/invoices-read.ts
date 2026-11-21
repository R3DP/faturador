import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import type { McpCtx } from '@/lib/mcp/context'
import { ScopeError } from '@/lib/mcp/scoped-db'
import {
  appUrl,
  errorResult,
  jsonResult,
  formatCurrency,
  UNPAID_STATUSES,
  isOverdue,
  publicUrl,
  pdfUrl,
  truncationNote,
} from '@/lib/mcp/shared'

const statusEnum = z.enum([
  'draft',
  'sent',
  'viewed',
  'paid',
  'partial',
  'overdue',
  'cancelled',
  'unpaid',
])

/**
 * Registra as ferramentas de consulta de faturas (listar, consultar e obter link) no
 * servidor MCP informado, limitadas às empresas em ctx.db.scope.
 */
export function registerInvoiceReadTools(server: McpServer, ctx: McpCtx) {
  server.registerTool(
    'list_invoices',
    {
      title: 'Listar faturas',
      description:
        "Lista as faturas das empresas do solicitante, das mais recentes para as mais antigas. Opcionalmente, filtre por empresa, status (incluindo o status sintético 'unpaid', que corresponde a faturas sent/viewed/partial/overdue) e/ou cliente.",
      inputSchema: z.object({
        offset: z.number().int().min(0).max(1000000).optional().describe('Deslocamento da página. Comece em 0 e use next_offset até que seja null. Mantenha os demais filtros sem alterações.'),
        business_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'ID da empresa cujas faturas serão listadas. Opcional. Omita para listar as faturas de todas as empresas no escopo.'
          ),
        status: statusEnum
          .optional()
          .describe(
            "Filtra por status. 'unpaid' é um filtro sintético que corresponde a faturas sent, viewed, partial e overdue."
          ),
        client_id: z.string().uuid().optional().describe('Filtra para exibir somente as faturas deste cliente.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Número máximo de faturas a retornar (padrão: 20; máximo: 100).'),
      }),
    },
    async ({ offset, business_id, status, client_id, limit }) => {
      let businessIds = ctx.db.scope.businessIds
      if (business_id !== undefined) {
        let resolvedId: string
        try {
          resolvedId = ctx.db.resolveBusinessId(business_id)
        } catch (err) {
          return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar a empresa.')
        }
        businessIds = [resolvedId]
      }

      const resolvedLimit = limit ?? 20

      let query = ctx.db.svc
        .from('invoices')
        .select(
          'id, invoice_number, status, issue_date, due_date, total, balance_due, currency, client:clients(name)'
        )
        .in('business_id', ctx.db.scope.businessIds)
        .in('business_id', businessIds)
        .order('issue_date', { ascending: false })
        .order('id', { ascending: true })
        .range(offset ?? 0, (offset ?? 0) + resolvedLimit - 1)

      if (status === 'unpaid') {
        query = query.in('status', UNPAID_STATUSES)
      } else if (status) {
        query = query.eq('status', status)
      }

      if (client_id) {
        query = query.eq('client_id', client_id)
      }

      const { data, error } = await query

      if (error) {
        console.error('list_invoices:', error)
        return errorResult('Não foi possível listar as faturas.')
      }

      const invoices = (data ?? []).map((inv) => ({
        id: inv.id,
        invoice_number: inv.invoice_number,
        client_name: (inv.client as { name: string } | null)?.name ?? null,
        status: inv.status,
        is_overdue: isOverdue(inv.status, inv.due_date),
        issue_date: inv.issue_date,
        due_date: inv.due_date,
        currency: inv.currency,
        total: inv.total,
        balance_due: inv.balance_due,
        app_url: `${appUrl()}/invoices/${inv.id}`,
      }))

      const currencies = Array.from(new Set(invoices.map((inv) => inv.currency)))
      const countLabel = `${invoices.length} fatura${invoices.length === 1 ? '' : 's'}`

      let summary: string
      if (invoices.length === 0) {
        summary = `${countLabel}.`
      } else if (currencies.length === 1) {
        const outstanding = invoices.reduce((sum, inv) => sum + (inv.balance_due ?? 0), 0)
        summary = `${countLabel}, ${formatCurrency(outstanding, currencies[0])} em aberto`
      } else {
        const byCurrency = currencies.map((currency) => {
          const group = invoices.filter((inv) => inv.currency === currency)
          const outstanding = group.reduce((sum, inv) => sum + (inv.balance_due ?? 0), 0)
          return `${group.length} ${currency}: ${formatCurrency(outstanding, currency)} em aberto`
        })
        summary = `${countLabel} (${byCurrency.join('; ')})`
      }

      const truncated = invoices.length === resolvedLimit
      const result = {
        offset: offset ?? 0,
        next_offset: (data ?? []).length === resolvedLimit ? (offset ?? 0) + resolvedLimit : null,
        summary: `${summary}${truncated ? truncationNote(resolvedLimit) : ''}`,
        invoices,
        ...(truncated ? { truncated: true } : {}),
      }

      return jsonResult(result)
    }
  )

  server.registerTool(
    'get_invoice',
    {
      title: 'Consultar fatura',
      description:
        'Busca todos os detalhes de uma fatura, incluindo itens, cliente e links público/PDF. Identifique a fatura por invoice_id ou por invoice_number (opcionalmente limitado a uma empresa específica quando o solicitante tiver mais de uma).',
      inputSchema: z.object({
        invoice_id: z.string().uuid().optional().describe('ID da fatura a consultar.'),
        invoice_number: z
          .string()
          .optional()
          .describe('Número da fatura a localizar (por exemplo, "INV-0004"). Usado somente se invoice_id não for informado.'),
        business_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'Ao buscar por invoice_number, limita a pesquisa a esta empresa. Opcional quando o escopo contém uma única empresa; recomendado quando contém várias.'
          ),
      }),
    },
    async ({ invoice_id, invoice_number, business_id }) => {
      let invoice
      try {
        if (invoice_id) {
          invoice = await ctx.db.assertInvoiceAccess(invoice_id)
        } else if (invoice_number) {
          let businessIds = ctx.db.scope.businessIds
          if (business_id !== undefined) {
            const resolvedId = ctx.db.resolveBusinessId(business_id)
            businessIds = [resolvedId]
          }

          const { data, error } = await ctx.db.svc
            .from('invoices')
            .select('*')
            .eq('invoice_number', invoice_number)
            .in('business_id', businessIds)

          if (error) {
            console.error('get_invoice (by number):', error)
            return errorResult('Não foi possível localizar a fatura.')
          }

          if (!data || data.length === 0) {
            return errorResult(`Nenhuma fatura encontrada com o número "${invoice_number}".`)
          }

          if (data.length > 1) {
            return errorResult(
              `Há várias faturas com o número "${invoice_number}" entre as empresas no escopo; informe business_id para identificar a correta.`
            )
          }

          invoice = data[0]
        } else {
          return errorResult('Informe invoice_id ou invoice_number.')
        }
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível acessar a fatura.')
      }

      const [{ data: lineItems, error: lineItemsError }, { data: client, error: clientError }] =
        await Promise.all([
          ctx.db.svc
            .from('invoice_line_items')
            .select('id, description, quantity, rate, discount_percent, discount_amount, tax_rate, tax_amount, amount, sort_order')
            .eq('invoice_id', invoice.id)
            .order('sort_order', { ascending: true })
            .limit(500),
          ctx.db.svc
            .from('clients')
            .select('id, name, email')
            .eq('id', invoice.client_id)
            .eq('business_id', invoice.business_id)
            .maybeSingle(),
        ])

      if (lineItemsError) {
        console.error('get_invoice (line items):', lineItemsError)
        return errorResult('Não foi possível carregar os itens da fatura.')
      }

      if (clientError) {
        console.error('get_invoice (client):', clientError)
        return errorResult('Não foi possível carregar o cliente.')
      }

      const result = {
        summary: `Fatura ${invoice.invoice_number}: ${invoice.status}, saldo de ${formatCurrency(invoice.balance_due, invoice.currency)} a pagar.`,
        invoice: {
          id: invoice.id,
          business_id: invoice.business_id,
          invoice_number: invoice.invoice_number,
          status: invoice.status,
          is_overdue: isOverdue(invoice.status, invoice.due_date),
          issue_date: invoice.issue_date,
          due_date: invoice.due_date,
          currency: invoice.currency,
          subtotal: invoice.subtotal,
          discount_type: invoice.discount_type,
          discount_value: invoice.discount_value,
          discount_amount: invoice.discount_amount,
          tax_rate: invoice.tax_rate,
          tax_amount: invoice.tax_amount,
          shipping_amount: invoice.shipping_amount,
          total: invoice.total,
          amount_paid: invoice.amount_paid,
          balance_due: invoice.balance_due,
          notes: invoice.notes,
          terms: invoice.terms,
          po_number: invoice.po_number,
          client: client
            ? { id: client.id, name: client.name, email: client.email }
            : null,
          line_items: (lineItems ?? []).map((li) => ({
            id: li.id,
            description: li.description,
            quantity: li.quantity,
            rate: li.rate,
            discount_percent: li.discount_percent,
            discount_amount: li.discount_amount,
            tax_rate: li.tax_rate,
            tax_amount: li.tax_amount,
            amount: li.amount,
          })),
          public_url: publicUrl(invoice.public_id),
          pdf_url: pdfUrl(invoice.public_id),
          app_url: `${appUrl()}/invoices/${invoice.id}`,
        },
      }

      return jsonResult(result)
    }
  )

  server.registerTool(
    'get_invoice_link',
    {
      title: 'Obter link da fatura',
      description:
        "Obtém o link público compartilhável e o link para baixar o PDF de uma fatura. A fatura deve pertencer a uma das empresas do solicitante.",
      inputSchema: z.object({
        invoice_id: z.string().uuid().describe('ID da fatura.'),
      }),
    },
    async ({ invoice_id }) => {
      let invoice
      try {
        invoice = await ctx.db.assertInvoiceAccess(invoice_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível acessar a fatura.')
      }

      const result = {
        summary: `Link da fatura ${invoice.invoice_number}.`,
        public_url: publicUrl(invoice.public_id),
        pdf_url: pdfUrl(invoice.public_id),
      }

      return jsonResult(result)
    }
  )
}
