import { z } from 'zod'
import { addDays } from 'date-fns'
import type { McpServer } from '@modelcontextprotocol/server'
import type { McpCtx } from '@/lib/mcp/context'
import { ScopeError } from '@/lib/mcp/scoped-db'
import { computeInvoiceTotals } from '@/lib/invoices/build'
import type { Database } from '@/types/database'
import { appUrl, errorResult, jsonResult, formatCurrency, publicUrl, pdfUrl, escapeLike } from '@/lib/mcp/shared'
import { lineItemInput, resolveLineItems } from '@/lib/mcp/line-items'
import { parseDay, toISODate, todayISO } from '@/lib/dates'
import { engagementErrorMessage } from '@/lib/engagements/errors'

type ClientRow = Database['public']['Tables']['clients']['Row']
type InvoiceRow = Database['public']['Tables']['invoices']['Row']

const DATE_FIELD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use uma data no formato YYYY-MM-DD')

const discountFields = {
  discount_type: z
    .enum(['percentage', 'fixed'])
    .optional()
    .describe('Tipo de desconto. Por padrão, usa "percentage".'),
  discount_value: z
    .number()
    .min(0)
    .optional()
    .describe(
      'Valor do desconto: percentual de 0 a 100 se discount_type for "percentage"; caso contrário, valor fixo. Por padrão, usa 0.'
    ),
  tax_rate: z.number().min(0).max(100).optional().describe('Alíquota percentual de imposto, aplicada após o desconto. Por padrão, usa 0.'),
  shipping_amount: z.number().min(0).optional().describe('Valor fixo do frete, acrescentado após o imposto. Por padrão, usa 0.'),
}

/**
 * Localiza um cliente por client_id ou client_name, limitado a resolvedBusinessId.
 * client_name é comparado sem diferenciar maiúsculas de minúsculas, mas precisa
 * corresponder exatamente (sem correspondência parcial) para evitar selecionar
 * o cliente errado; se não houver correspondência, sugere nomes semelhantes via ilike.
 */
export async function resolveClient(
  ctx: McpCtx,
  resolvedBusinessId: string,
  client_id: string | undefined,
  client_name: string | undefined
): Promise<ClientRow> {
  if (client_id) {
    const client = await ctx.db.assertClientAccess(client_id)
    if (client.business_id !== resolvedBusinessId) {
      throw new ScopeError(`O cliente ${client_id} não pertence à empresa ${resolvedBusinessId}.`)
    }
    return client
  }

  if (!client_name) {
    throw new ScopeError('Informe client_id ou client_name para identificar o cliente.')
  }

  // Escapa os curingas de ilike (% e _) para que um nome de cliente que contenha
  // qualquer um desses caracteres (por exemplo, "50% Off Co") seja localizado
  // literalmente, em vez de ser interpretado como um padrão.
  const escaped = escapeLike(client_name)

  const { data: exact, error } = await ctx.db.svc
    .from('clients')
    .select('*')
    .eq('business_id', resolvedBusinessId)
    .ilike('name', escaped)

  if (error) {
    console.error('resolveClient (exact):', error)
    throw new Error('Não foi possível localizar o cliente.')
  }

  if (exact && exact.length === 1) {
    return exact[0]
  }

  if (exact && exact.length > 1) {
    throw new ScopeError(
      `Há vários clientes chamados "${client_name}" nesta empresa; informe client_id para identificar o correto: ${exact
        .map((c) => `"${c.name}" (${c.id})`)
        .join(', ')}.`
    )
  }

  const { data: close } = await ctx.db.svc
    .from('clients')
    .select('id, name')
    .eq('business_id', resolvedBusinessId)
    .ilike('name', `%${escaped}%`)
    .limit(5)

  if (close && close.length > 0) {
    throw new ScopeError(
      `Nenhum cliente chamado "${client_name}" foi encontrado nesta empresa. Você quis dizer: ${close
        .map((c) => `"${c.name}" (${c.id})`)
        .join(', ')}?`
    )
  }

  throw new ScopeError(`Nenhum cliente chamado "${client_name}" foi encontrado nesta empresa.`)
}

/**
 * Registra as ferramentas de gravação de faturas (create_invoice, update_draft_invoice)
 * no servidor MCP informado, limitadas às empresas em ctx.db.scope.
 *
 * Ambas as ferramentas seguem os mesmos cálculos e o mesmo fluxo de persistência
 * de faturas do aplicativo (consulte createInvoiceAction/updateInvoiceAction em
 * src/lib/actions/invoices.ts e os cálculos compartilhados em src/lib/invoices/build.ts),
 * para que faturas criadas via MCP sejam iguais às criadas no aplicativo.
 */
export function registerInvoiceWriteTools(server: McpServer, ctx: McpCtx) {
  server.registerTool(
    'create_invoice',
    {
      title: 'Criar fatura',
      description:
        'Cria uma nova fatura em rascunho para um cliente, identificado por client_id ou client_name (correspondência exata, sem diferenciar maiúsculas de minúsculas). Use send_invoice separadamente para enviá-la. Informe engagement_entry_ids para faturar o trabalho acordado no cronograma do contrato; esses itens são marcados como faturados na mesma operação e não podem ser faturados novamente.',
      inputSchema: z.object({
        currency: z.string().regex(/^[A-Z]{3}$/).optional().describe('Moeda da fatura. Por padrão, usa a moeda do cliente. O trabalho de origem deve usar essa moeda; não há conversão implícita.'),
        request_id: z.string().uuid().describe('ID único da solicitação. Após um timeout, reutilize o mesmo ID e os mesmos dados para recuperar o rascunho original.'),
        business_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'ID da empresa em que a fatura será criada. Opcional quando a chave de API está limitada a uma única empresa; obrigatório quando está limitada a várias.'
          ),
        client_id: z.string().uuid().optional().describe('ID do cliente. Informe este campo ou client_name.'),
        client_name: z
          .string()
          .max(200)
          .optional()
          .describe('Nome exato do cliente (sem diferenciar maiúsculas de minúsculas). Informe este campo ou client_id.'),
        line_items: z
          .array(lineItemInput)
          .min(1).optional()
          .describe(
            'Itens da fatura. Omita ao faturar time_entry_ids ou expense_ids; o trabalho de origem determina esses itens. Cada item pode ser informado diretamente (description + quantity + rate) ou referenciar um item salvo por item_id / item_name, que fornece a descrição e o valor.'
          ),
        issue_date: DATE_FIELD.optional().describe('Data de emissão, no formato YYYY-MM-DD. Por padrão, usa a data de hoje.'),
        due_date: DATE_FIELD.optional().describe(
          "Data de vencimento, no formato YYYY-MM-DD. Por padrão, usa issue_date + o prazo de pagamento padrão da empresa."
        ),
        notes: z.string().max(2000).optional().describe('Observações exibidas na fatura. Por padrão, usa o modelo de observações da empresa.'),
        status: z
          .literal('draft')
          .optional()
          .describe('Status da fatura. Aqui, somente "draft" é aceito. Use send_invoice para enviá-la.'),
        time_entry_ids: z
          .array(z.string().uuid())
          .max(100)
          .optional()
          .describe(
            'IDs de apontamentos de tempo ainda não faturados (obtidos com list_unbilled) que serão marcados como faturados ao serem vinculados a esta fatura. Cada um deve pertencer à mesma empresa e ainda não estar em outra fatura.'
          ),
        expense_ids: z
          .array(z.string().uuid())
          .max(100)
          .optional()
          .describe(
            'IDs de despesas ainda não faturadas (obtidas com list_unbilled) que serão marcadas como faturadas ao serem vinculadas a esta fatura. Cada uma deve pertencer à mesma empresa e ainda não estar em outra fatura.'
          ),
        engagement_entry_ids: z
          .array(z.string().uuid())
          .max(100)
          .optional()
          .describe(
            'IDs dos itens do cronograma do contrato a faturar (obtidos com list_ready_to_bill ou get_engagement). Cada item se torna uma linha pelo valor acordado e é marcado como faturado na mesma operação, para não ser faturado novamente. Todos os itens devem estar prontos para faturamento, pertencer a este cliente e usar a moeda da fatura; se algum já estiver faturado, toda a chamada será recusada.'
          ),
        ...discountFields,
      }),
    },
    async ({ currency,
      request_id,
      business_id,
      client_id,
      client_name,
      line_items = [],
      issue_date,
      due_date,
      notes,
      time_entry_ids,
      expense_ids,
      engagement_entry_ids,
      discount_type,
      discount_value,
      tax_rate,
      shipping_amount,
    }) => {
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
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível localizar o cliente.')
      }

      const { data: business, error: businessError } = await ctx.db.svc
        .from('businesses')
        .select('*')
        .eq('id', resolvedBusinessId)
        .maybeSingle()

      if (businessError || !business) {
        console.error('create_invoice (business):', businessError)
        return errorResult('Não foi possível carregar a empresa.')
      }

      let resolvedLineItems
      try {
        resolvedLineItems = (await resolveLineItems(ctx, resolvedBusinessId, line_items)).resolved
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível resolver os itens da fatura.')
      }

      const resolvedIssueDate = issue_date || todayISO()
      const resolvedDueDate =
        due_date ||
        toISODate(addDays(parseDay(resolvedIssueDate), business.default_payment_terms))

      // A moeda segue a do cliente ou, se não houver, a moeda padrão da empresa:
      // exatamente como o formulário de fatura do aplicativo faz ao selecionar
      // um cliente (setValue('currency', client.currency) em invoice-form.tsx).
      const invoiceCurrency = currency || client.currency || business.default_currency

      const requestedTimeIds = time_entry_ids ?? []
      const requestedExpenseIds = expense_ids ?? []
      const requestedEntryIds = engagement_entry_ids ?? []
      const { data: created, error: createError } = await ctx.db.svc.rpc('create_invoice_document', {
        p_business_id: resolvedBusinessId, p_client_id: client.id,
        p_request_id: request_id, p_key_id: ctx.keyId,
        p_time_ids: requestedTimeIds, p_expense_ids: requestedExpenseIds,
        // A validação, a definição dos valores e a reserva ocorrem dentro da
        // transação da RPC. Nada é marcado como faturado se a fatura inteira
        // não for gravada.
        p_engagement_entry_ids: requestedEntryIds,
        p_patch: { issue_date: resolvedIssueDate, due_date: resolvedDueDate, currency: invoiceCurrency,
          notes: notes ?? business.invoice_notes, discount_type: discount_type ?? 'percentage',
          discount_value: discount_value ?? 0, tax_rate: tax_rate ?? 0, shipping_amount: shipping_amount ?? 0 },
        p_lines: resolvedLineItems.map((line) => ({ ...line })),
      })
      if (createError || !created) {
        return errorResult(
          engagementErrorMessage(createError?.message) ||
            createError?.message ||
            'Não foi possível criar a fatura.'
        )
      }
      const invoice = created as unknown as Database['public']['Tables']['invoices']['Row']
      const invoiceNumber = invoice.invoice_number
      const linkageNote = requestedTimeIds.length + requestedExpenseIds.length > 0 ? ' O trabalho de origem teve o valor calculado e foi vinculado atomicamente.' : ''
      const engagementNote =
        requestedEntryIds.length > 0
          ? ` ${requestedEntryIds.length} ${requestedEntryIds.length === 1 ? 'item do cronograma do contrato foi marcado' : 'itens do cronograma do contrato foram marcados'} como faturado${requestedEntryIds.length === 1 ? '' : 's'} e não poder${requestedEntryIds.length === 1 ? 'á' : 'ão'} ser faturado${requestedEntryIds.length === 1 ? '' : 's'} novamente.`
          : ''
      const { data: savedLines } = await ctx.db.svc.from('invoice_line_items').select('description,quantity,rate,amount').eq('invoice_id', invoice.id)

      const result = {
        summary: `Rascunho da fatura ${invoiceNumber} criado para ${client.name}: ${formatCurrency(invoice.total, invoice.currency)}${linkageNote}${engagementNote}`,
        invoice: {
          id: invoice.id,
          business_id: invoice.business_id,
          client_id: invoice.client_id,
          invoice_number: invoice.invoice_number,
          status: invoice.status,
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
          balance_due: invoice.balance_due,
          notes: invoice.notes,
          line_items: savedLines ?? [],
        },
        linked_time_entry_ids: requestedTimeIds,
        linked_expense_ids: requestedExpenseIds,
        billed_engagement_entry_ids: requestedEntryIds,
        public_url: publicUrl(invoice.public_id),
        pdf_url: pdfUrl(invoice.public_id),
        app_url: `${appUrl()}/invoices/${invoice.id}`,
      }

      return jsonResult(result)
    }
  )

  server.registerTool(
    'update_draft_invoice',
    {
      title: 'Atualizar fatura em rascunho',
      description:
        'Atualiza uma fatura em rascunho: substitui seus itens e/ou altera datas, observações, desconto, imposto ou frete. Recusa alterações em faturas que não estejam mais em rascunho. Nesse caso, cancele-a e crie outra.',
      inputSchema: z.object({
        invoice_id: z.string().uuid().describe('ID da fatura em rascunho a atualizar.'),
        line_items: z
          .array(lineItemInput)
          .min(1)
          .optional()
          .describe(
            'Quando informado, substitui TODOS os itens existentes e recalcula os totais. Os itens podem referenciar itens salvos por item_id / item_name.'
          ),
        notes: z.string().max(2000).optional().describe('Substitui o campo de observações.'),
        issue_date: DATE_FIELD.optional().describe('Substitui a data de emissão, no formato YYYY-MM-DD.'),
        due_date: DATE_FIELD.optional().describe('Substitui a data de vencimento, no formato YYYY-MM-DD.'),
        ...discountFields,
        discount_type: discountFields.discount_type.describe(
          'Tipo de desconto. Por padrão, usa "percentage". Se informado sozinho, discount_value existente será reinterpretado conforme o novo tipo (por exemplo, um desconto fixo de US$ 50 armazenado passa a ser um desconto de 50%). Informe discount_value junto com discount_type para definir ambos explicitamente.'
        ),
      }),
    },
    async ({ invoice_id, line_items, notes, issue_date, due_date, discount_type, discount_value, tax_rate, shipping_amount }) => {
      let invoice
      try {
        invoice = await ctx.db.assertInvoiceAccess(invoice_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível acessar a fatura.')
      }

      if (invoice.status !== 'draft') {
        return errorResult(
          `A fatura ${invoice.invoice_number} está com status "${invoice.status}", não "draft". Somente faturas em rascunho podem ser editadas. Cancele-a e crie outra se precisar fazer alterações.`
        )
      }

      // Só lê os itens quando a chamada NÃO os estiver substituindo, pois nesse
      // caso os itens armazenados são usados para recalcular os totais. Quando
      // line_items É informado, a substituição ocorre dentro de
      // replace_invoice_line_items e não há linhas para restaurar; a leitura seria inútil.
      let storedLineItems: { description: string; quantity: number; rate: number }[] = []
      if (!line_items) {
        const { data, error: existingError } = await ctx.db.svc
          .from('invoice_line_items')
          .select('description, quantity, rate, sort_order')
          .eq('invoice_id', invoice_id)
          .order('sort_order', { ascending: true })
          .limit(500)

        if (existingError) {
          console.error('update_draft_invoice (load line items):', existingError)
          return errorResult('Não foi possível carregar os itens atuais da fatura.')
        }
        storedLineItems = data ?? []
      }

      let currentLineItems: { description: string; quantity: number; rate: number }[]
      if (line_items) {
        try {
          currentLineItems = (await resolveLineItems(ctx, invoice.business_id, line_items)).resolved
        } catch (err) {
          return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível resolver os itens da fatura.')
        }
      } else {
        currentLineItems = storedLineItems.map((li) => ({
          description: li.description,
          quantity: li.quantity,
          rate: li.rate,
        }))
      }

      const totals = computeInvoiceTotals(currentLineItems, {
        discount_type: discount_type ?? (invoice.discount_type as 'percentage' | 'fixed'),
        discount_value: discount_value ?? invoice.discount_value,
        tax_rate: tax_rate ?? invoice.tax_rate,
        shipping_amount: shipping_amount ?? invoice.shipping_amount,
      })

      // balance_due foi omitido intencionalmente. replace_invoice_line_items o
      // calcula como total - amount_paid, que resulta no mesmo valor para um
      // rascunho (cujo amount_paid é 0) e continuará correto se isso mudar.
      const patch = {
        issue_date: issue_date ?? invoice.issue_date,
        due_date: due_date ?? invoice.due_date,
        notes: notes ?? invoice.notes,
        subtotal: totals.subtotal,
        discount_type: discount_type ?? invoice.discount_type,
        discount_value: discount_value ?? invoice.discount_value,
        discount_amount: totals.discount_amount,
        tax_rate: tax_rate ?? invoice.tax_rate,
        tax_amount: totals.tax_amount,
        shipping_amount: shipping_amount ?? invoice.shipping_amount,
        total: totals.total,
      }

      let updated: InvoiceRow | null = null

      if (line_items) {
        // UMA ÚNICA TRANSAÇÃO. replace_invoice_line_items executa
        // a exclusão, a reinserção e a atualização dos totais em conjunto. Antes,
        // o código excluía as linhas antigas, inseria as novas e, em caso de falha,
        // tentava reinserir as linhas excluídas; se essa restauração também falhasse,
        // a ferramenta precisava avisar que a fatura ficara sem itens e pedir o
        // reparo manual do documento. Esse fluxo não pode mais deixar uma fatura
        // com total, mas sem itens.
        const { data, error: replaceError } = await ctx.db.svc.rpc('replace_invoice_line_items', {
          p_invoice_id: invoice_id,
          p_line_items: totals.line_items.map((item) => ({
            description: item.description ?? '',
            quantity: item.quantity,
            rate: item.rate,
            amount: item.amount,
          })),
          p_invoice_patch: patch,
        })

        if (replaceError || !data) {
          console.error('update_draft_invoice (replace line items):', replaceError)
          if (replaceError?.message === 'invalid_line_items') {
            return errorResult(
              'Esses itens foram rejeitados; a fatura não foi alterada. Envie de 1 a 500 itens e tente novamente.'
            )
          }
          return errorResult('Não foi possível atualizar a fatura; ela não foi alterada.')
        }

        updated = data as unknown as InvoiceRow
      } else {
        const { data, error: updateError } = await ctx.db.svc
          .from('invoices')
          .update(patch)
          .eq('id', invoice_id)
          .select('*')
          .single()

        if (updateError || !data) {
          console.error('update_draft_invoice (update):', updateError)
          return errorResult('Não foi possível atualizar a fatura.')
        }

        updated = data
      }

      const result = {
        summary: `Fatura ${updated.invoice_number} em rascunho atualizada: ${formatCurrency(totals.total, updated.currency)}`,
        invoice: {
          id: updated.id,
          invoice_number: updated.invoice_number,
          status: updated.status,
          issue_date: updated.issue_date,
          due_date: updated.due_date,
          currency: updated.currency,
          subtotal: updated.subtotal,
          discount_type: updated.discount_type,
          discount_value: updated.discount_value,
          discount_amount: updated.discount_amount,
          tax_rate: updated.tax_rate,
          tax_amount: updated.tax_amount,
          shipping_amount: updated.shipping_amount,
          total: updated.total,
          balance_due: updated.balance_due,
          notes: updated.notes,
          line_items: totals.line_items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            rate: item.rate,
            amount: item.amount,
          })),
        },
        public_url: publicUrl(updated.public_id),
        pdf_url: pdfUrl(updated.public_id),
        app_url: `${appUrl()}/invoices/${updated.id}`,
      }

      return jsonResult(result)
    }
  )
}
