import { z } from 'zod'
import { addDays } from 'date-fns'
import type { McpServer } from '@modelcontextprotocol/server'
import type { McpCtx } from '@/lib/mcp/context'
import { ScopeError } from '@/lib/mcp/scoped-db'
import { generatePublicId } from '@/lib/utils/invoice'
import { computeInvoiceTotals } from '@/lib/invoices/build'
import { lineItemInput, resolveLineItems } from '@/lib/mcp/line-items'
import { resolveClient } from './invoices-write'
import { sendEstimateEmail, SendEstimateEmailError } from '@/lib/estimates/send-email'
import { appUrl, errorResult, jsonResult, formatCurrency, pdfUrl, truncationNote } from '@/lib/mcp/shared'
import type { Database } from '@/types/database'
import { parseDay, toISODate, todayISO } from '@/lib/dates'

type ClientRow = Database['public']['Tables']['clients']['Row']
type InvoiceRow = Database['public']['Tables']['invoices']['Row']
type EstimateRow = Database['public']['Tables']['estimates']['Row']

/** Formato retornado pela RPC convert_estimate_to_invoice. */
interface ConversionResult {
  /**
   * Falso quando outra chamada já reivindicou este orçamento; nesse caso,
   * esta chamada não gravou nada e `invoice` é a fatura que já existe.
   */
  claimed: boolean
  invoice: InvoiceRow | null
  invoice_number: string | null
}

const DATE_FIELD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD')

/** Dias somados a issue_date quando a chamada não informa uma data de validade. */
const DEFAULT_EXPIRY_DAYS = 30

const ESTIMATE_STATUSES = [
  'draft',
  'sent',
  'viewed',
  'accepted',
  'declined',
  'expired',
  'converted',
] as const

const discountFields = {
  discount_type: z
    .enum(['percentage', 'fixed'])
    .optional()
    .describe('Tipo de desconto. O padrão é "percentage".'),
  discount_value: z
    .number()
    .min(0)
    .optional()
    .describe(
      'Valor do desconto: percentual (0-100) se discount_type for "percentage", ou valor fixo nos demais casos. O padrão é 0.'
    ),
  tax_rate: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe('Percentual de imposto, aplicado após o desconto. O padrão é 0.'),
  shipping_amount: z.number().min(0).optional().describe('Valor fixo do frete, somado após o imposto. O padrão é 0.'),
}

function estimatePublicUrl(publicId: string): string {
  return `${appUrl()}/e/${publicId}`
}

/**
 * O retorno de convert_estimate_to_invoice quando o orçamento JÁ foi
 * convertido: a fatura existente, informada como sucesso.
 *
 * Isso não é um erro de propósito. Quem chega aqui - seja porque o orçamento
 * foi convertido antes do início da chamada, seja porque perdeu uma disputa
 * concorrente - quase sempre é o mesmo agente repetindo uma solicitação que já
 * deu certo. Informar que o trabalho falhou foi o que causou faturas
 * duplicadas. O formato corresponde campo a campo ao resultado de uma
 * conversão recém-concluída; `already_converted` distingue os casos, então a
 * chamada não precisa de ramificação para ler o retorno.
 */
async function alreadyConvertedResult(ctx: McpCtx, estimate: EstimateRow, invoice: InvoiceRow) {
  const { data: lineItems } = await ctx.db.svc
    .from('invoice_line_items')
    .select('description, quantity, rate, amount, sort_order')
    .eq('invoice_id', invoice.id)
    .order('sort_order', { ascending: true })
    .limit(500)

  return jsonResult({
    summary: `O orçamento ${estimate.estimate_number} já havia sido convertido na fatura em rascunho ${invoice.invoice_number}: ${formatCurrency(invoice.total, invoice.currency)}. Nada novo foi criado e não existe uma segunda fatura. Chame send_invoice para enviá-la.`,
    already_converted: true,
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
      total: invoice.total,
      balance_due: invoice.balance_due,
      line_items: (lineItems ?? []).map((item) => ({
        description: item.description,
        quantity: item.quantity,
        rate: item.rate,
        amount: item.amount,
      })),
    },
    estimate: {
      id: estimate.id,
      estimate_number: estimate.estimate_number,
      status: 'converted',
      converted_invoice_id: invoice.id,
    },
    pdf_url: pdfUrl(invoice.public_id),
    app_url: `${appUrl()}/invoices/${invoice.id}`,
  })
}

/**
 * Registra as ferramentas de orçamento (create_estimate, update_draft_estimate,
 * get_estimate, list_estimates, send_estimate, convert_estimate_to_invoice),
 * limitadas às empresas em ctx.db.scope.
 *
 * Elas espelham o fluxo de orçamento do próprio app (src/lib/actions/estimates.ts):
 * ambas gravam por meio das funções de banco create_estimate_document e
 * convert_estimate_to_invoice, então um orçamento criado por um agente e a
 * fatura gerada pela conversão são indistinguíveis dos documentos criados pela
 * interface. Os totais usam o cálculo compartilhado que arredonda uma única
 * vez ao salvar em src/lib/invoices/build.ts, o mesmo módulo usado pelas
 * ferramentas de fatura.
 */
export function registerEstimateTools(server: McpServer, ctx: McpCtx) {
  server.registerTool(
    'list_estimates',
    {
      title: 'Listar orçamentos',
      description:
        'Listar os orçamentos das empresas acessíveis à chamada, dos mais recentes aos mais antigos, com filtros opcionais por empresa, status ou cliente. Use para saber quais orçamentos estão pendentes. Orçamentos NÃO são faturas e nunca têm saldo devedor; use list_invoices para consultar valores devidos.',
      inputSchema: z.object({
        offset: z.number().int().min(0).max(1000000).optional().describe('Deslocamento da página. Comece em 0 e use next_offset até que seja null. Mantenha os demais filtros iguais.'),
        business_id: z
          .string()
          .uuid()
          .optional()
          .describe('ID da empresa cujos orçamentos serão listados. Omita para listar todas as empresas dentro do escopo.'),
        status: z
          .enum(ESTIMATE_STATUSES)
          .optional()
          .describe(
            'Filtre por status: draft, sent, viewed, accepted, declined, expired ou converted (já convertido em fatura).'
          ),
        client_id: z.string().uuid().optional().describe('Filtre para exibir somente os orçamentos deste cliente.'),
        limit: z.number().int().min(1).max(100).optional().describe('Máximo de orçamentos a retornar (padrão 20, máximo 100).'),
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
        .from('estimates')
        .select(
          'id, estimate_number, status, issue_date, expiry_date, total, currency, converted_invoice_id, client:clients(name)'
        )
        .in('business_id', ctx.db.scope.businessIds)
        .in('business_id', businessIds)
        .order('issue_date', { ascending: false })
        .order('id', { ascending: true })
        .range(offset ?? 0, (offset ?? 0) + resolvedLimit - 1)

      if (status) {
        query = query.eq('status', status)
      }
      if (client_id) {
        query = query.eq('client_id', client_id)
      }

      const { data, error } = await query

      if (error) {
        console.error('list_estimates:', error)
        return errorResult('Não foi possível listar os orçamentos.')
      }

      const estimates = (data ?? []).map((est) => ({
        id: est.id,
        estimate_number: est.estimate_number,
        client_name: (est.client as { name: string } | null)?.name ?? null,
        status: est.status,
        issue_date: est.issue_date,
        expiry_date: est.expiry_date,
        currency: est.currency,
        total: est.total,
        converted_invoice_id: est.converted_invoice_id,
        app_url: `${appUrl()}/estimates/${est.id}`,
      }))

      const truncated = estimates.length === resolvedLimit
      const countLabel = `${estimates.length} ${estimates.length === 1 ? 'orçamento' : 'orçamentos'}`

      return jsonResult({
        offset: offset ?? 0,
        next_offset: (data ?? []).length === resolvedLimit ? (offset ?? 0) + resolvedLimit : null,
        summary: `${countLabel}${status ? ` com status "${status}"` : ''}${truncated ? truncationNote(resolvedLimit) : ''}`,
        estimates,
      })
    }
  )

  server.registerTool(
    'get_estimate',
    {
      title: 'Consultar orçamento',
      description:
        'Consultar um orçamento completo: itens, totais, cliente, status e link compartilhável. Use antes de update_draft_estimate ou convert_estimate_to_invoice para trabalhar com os dados atuais, em vez de presumir o conteúdo. Não retorna informações de pagamento ou saldo, pois orçamento não é fatura; use get_payment_status para consultar valores devidos.',
      inputSchema: z.object({
        estimate_id: z.string().uuid().describe('ID do orçamento a consultar (obtido por list_estimates ou create_estimate).'),
      }),
    },
    async ({ estimate_id }) => {
      let estimate
      try {
        estimate = await ctx.db.assertEstimateAccess(estimate_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível acessar o orçamento.')
      }

      const [{ data: lineItems, error: lineItemsError }, { data: client }] = await Promise.all([
        ctx.db.svc
          .from('estimate_line_items')
          .select('description, quantity, rate, amount, sort_order')
          .eq('estimate_id', estimate_id)
          .order('sort_order', { ascending: true })
          .limit(500),
        ctx.db.svc
          .from('clients')
          .select('id, name, email')
          .eq('id', estimate.client_id)
          .eq('business_id', estimate.business_id)
          .maybeSingle(),
      ])

      if (lineItemsError) {
        console.error('get_estimate (line items):', lineItemsError)
        return errorResult('Não foi possível carregar os itens do orçamento.')
      }

      return jsonResult({
        summary: `${estimate.estimate_number} para ${client?.name ?? 'cliente desconhecido'}: ${formatCurrency(estimate.total, estimate.currency)} (${estimate.status})`,
        estimate: {
          id: estimate.id,
          business_id: estimate.business_id,
          client_id: estimate.client_id,
          client_name: client?.name ?? null,
          client_email: client?.email ?? null,
          estimate_number: estimate.estimate_number,
          status: estimate.status,
          issue_date: estimate.issue_date,
          expiry_date: estimate.expiry_date,
          currency: estimate.currency,
          subtotal: estimate.subtotal,
          discount_type: estimate.discount_type,
          discount_value: estimate.discount_value,
          discount_amount: estimate.discount_amount,
          tax_rate: estimate.tax_rate,
          tax_amount: estimate.tax_amount,
          shipping_amount: estimate.shipping_amount,
          total: estimate.total,
          notes: estimate.notes,
          terms: estimate.terms,
          converted_invoice_id: estimate.converted_invoice_id,
          line_items: (lineItems ?? []).map((li) => ({
            description: li.description,
            quantity: li.quantity,
            rate: li.rate,
            amount: li.amount,
          })),
        },
        public_url: estimatePublicUrl(estimate.public_id),
        app_url: `${appUrl()}/estimates/${estimate.id}`,
      })
    }
  )

  server.registerTool(
    'create_estimate',
    {
      title: 'Criar orçamento',
      description:
        'Criar um orçamento para um cliente, identificado por client_id ou client_name. Use quando o trabalho ainda não foi aprovado e o cliente precisa receber um preço antes. Sempre é criado como rascunho: chame send_estimate para enviá-lo e, depois que for aceito, convert_estimate_to_invoice. NÃO use para trabalho já realizado; nesse caso, a ferramenta correta é create_invoice.',
      inputSchema: z.object({
        request_id: z.uuid().describe('ID estável da solicitação. Reutilize com os mesmos dados ao repetir a chamada.'),
        business_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'ID da empresa em que o orçamento será criado. Opcional quando a chave de API está limitada a uma única empresa; obrigatório quando está limitada a várias.'
          ),
        client_id: z.string().uuid().optional().describe('ID do cliente. Informe este campo ou client_name.'),
        client_name: z
          .string()
          .max(200)
          .optional()
          .describe('Nome exato do cliente (sem diferenciar maiúsculas de minúsculas). Informe este campo ou client_id.'),
        line_items: z
          .array(lineItemInput)
          .min(1)
          .describe(
            'Itens do orçamento; é necessário informar pelo menos um. Cada item pode ser descrito diretamente (description + quantity + rate) ou referenciar um item salvo por item_id / item_name, que fornece a descrição e o valor.'
          ),
        issue_date: DATE_FIELD.optional().describe('Data de emissão, YYYY-MM-DD. O padrão é a data de hoje.'),
        expiry_date: DATE_FIELD.optional().describe(
          `Data de validade do orçamento, YYYY-MM-DD. O padrão é issue_date mais ${DEFAULT_EXPIRY_DAYS} dias.`
        ),
        notes: z.string().max(2000).optional().describe('Observações exibidas no orçamento.'),
        terms: z.string().max(2000).optional().describe('Condições exibidas no orçamento, por exemplo, o que ele não inclui.'),
        ...discountFields,
      }),
    },
    async ({ request_id,
      business_id,
      client_id,
      client_name,
      line_items,
      issue_date,
      expiry_date,
      notes,
      terms,
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
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar o cliente.')
      }

      let resolvedLineItems
      try {
        resolvedLineItems = (await resolveLineItems(ctx, resolvedBusinessId, line_items)).resolved
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar os itens.')
      }

      const { data: business, error: businessError } = await ctx.db.svc
        .from('businesses')
        .select('*')
        .eq('id', resolvedBusinessId)
        .maybeSingle()

      if (businessError || !business) {
        console.error('create_estimate (business):', businessError)
        return errorResult('Não foi possível carregar os dados da empresa.')
      }

      const totals = computeInvoiceTotals(resolvedLineItems, {
        discount_type,
        discount_value,
        tax_rate,
        shipping_amount,
      })

      const resolvedIssueDate = issue_date || todayISO()
      const resolvedExpiryDate =
        expiry_date || toISODate(addDays(parseDay(resolvedIssueDate), DEFAULT_EXPIRY_DAYS))

      // A moeda segue a do cliente, usando como alternativa a moeda padrão da
      // empresa, conforme a mesma regra aplicada por createEstimateAction no app.
      const estimateCurrency = client.currency || business.default_currency

      const {data:created,error:estimateError}=await ctx.db.svc.rpc('create_estimate_document',{p_business_id:resolvedBusinessId,p_client_id:client.id,p_request_id:request_id,p_key_id:ctx.keyId,p_patch:{issue_date:resolvedIssueDate,expiry_date:resolvedExpiryDate,discount_type,discount_value,tax_rate,shipping_amount,notes,terms},p_lines:resolvedLineItems.map(line=>({...line}))})
      if(estimateError||!created)return errorResult(estimateError?.message||'Não foi possível criar o orçamento')
      const estimate=created as Database['public']['Tables']['estimates']['Row']
      const estimateNumber=estimate.estimate_number

      return jsonResult({
        summary: `Orçamento ${estimateNumber} criado como rascunho para ${client.name}: ${formatCurrency(totals.total, estimateCurrency)}`,
        estimate: {
          id: estimate.id,
          business_id: estimate.business_id,
          client_id: estimate.client_id,
          estimate_number: estimate.estimate_number,
          status: estimate.status,
          issue_date: estimate.issue_date,
          expiry_date: estimate.expiry_date,
          currency: estimate.currency,
          subtotal: estimate.subtotal,
          discount_amount: estimate.discount_amount,
          tax_amount: estimate.tax_amount,
          shipping_amount: estimate.shipping_amount,
          total: estimate.total,
          notes: estimate.notes,
          terms: estimate.terms,
          line_items: totals.line_items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            rate: item.rate,
            amount: item.amount,
          })),
        },
        public_url: estimatePublicUrl(estimate.public_id),
        app_url: `${appUrl()}/estimates/${estimate.id}`,
      })
    }
  )

  server.registerTool(
    'update_draft_estimate',
    {
      title: 'Atualizar orçamento em rascunho',
      description:
        'Atualizar um orçamento em rascunho: substituir seus itens e/ou alterar datas, observações, condições, desconto, imposto ou frete. Recusa alterações em orçamentos já enviados, aceitos, recusados ou convertidos, pois o cliente já viu esses valores; nesse caso, crie um novo orçamento.',
      inputSchema: z.object({
        estimate_id: z.string().uuid().describe('ID do orçamento em rascunho a atualizar.'),
        line_items: z
          .array(lineItemInput)
          .min(1)
          .optional()
          .describe(
            'Se informado, substitui TODOS os itens existentes e recalcula os totais. Os itens podem referenciar itens salvos por item_id / item_name.'
          ),
        issue_date: DATE_FIELD.optional().describe('Substitui a data de emissão, YYYY-MM-DD.'),
        expiry_date: DATE_FIELD.optional().describe('Substitui a data de validade, YYYY-MM-DD.'),
        notes: z.string().max(2000).optional().describe('Substitui o campo de observações.'),
        terms: z.string().max(2000).optional().describe('Substitui o campo de condições.'),
        ...discountFields,
        discount_type: discountFields.discount_type.describe(
          'Tipo de desconto. Se informado sozinho, o discount_value existente será reinterpretado conforme o novo tipo (um desconto fixo armazenado como 50 passa a ser um desconto de 50%). Informe discount_value junto com discount_type para definir ambos explicitamente.'
        ),
      }),
    },
    async ({
      estimate_id,
      line_items,
      issue_date,
      expiry_date,
      notes,
      terms,
      discount_type,
      discount_value,
      tax_rate,
      shipping_amount,
    }) => {
      let estimate
      try {
        estimate = await ctx.db.assertEstimateAccess(estimate_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível acessar o orçamento.')
      }

      if (estimate.status !== 'draft') {
        return errorResult(
          `O orçamento ${estimate.estimate_number} está com status "${estimate.status}", não "draft". Somente orçamentos em rascunho podem ser editados. Crie um novo orçamento se os valores precisarem mudar.`
        )
      }

      // Só lê quando a chamada NÃO está substituindo os itens, pois nesse caso os
      // itens armazenados são usados para recalcular os totais. Quando line_items
      // É informado, a substituição ocorre dentro de replace_estimate_line_items
      // e não há nada a restaurar; portanto, a leitura seria desnecessária.
      let storedLineItems: { description: string; quantity: number; rate: number }[] = []
      if (!line_items) {
        const { data, error: storedError } = await ctx.db.svc
          .from('estimate_line_items')
          .select('description, quantity, rate, sort_order')
          .eq('estimate_id', estimate_id)
          .order('sort_order', { ascending: true })
          .limit(500)

        if (storedError) {
          console.error('update_draft_estimate (load line items):', storedError)
          return errorResult('Não foi possível carregar os itens existentes.')
        }
        storedLineItems = data ?? []
      }

      let currentLineItems: { description: string; quantity: number; rate: number }[]
      if (line_items) {
        try {
          currentLineItems = (await resolveLineItems(ctx, estimate.business_id, line_items)).resolved
        } catch (err) {
          return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar os itens.')
        }
      } else {
        currentLineItems = storedLineItems.map((li) => ({
          description: li.description,
          quantity: li.quantity,
          rate: li.rate,
        }))
      }

      const totals = computeInvoiceTotals(currentLineItems, {
        discount_type: discount_type ?? (estimate.discount_type as 'percentage' | 'fixed'),
        discount_value: discount_value ?? estimate.discount_value,
        tax_rate: tax_rate ?? estimate.tax_rate,
        shipping_amount: shipping_amount ?? estimate.shipping_amount,
      })

      const patch = {
        issue_date: issue_date ?? estimate.issue_date,
        expiry_date: expiry_date ?? estimate.expiry_date,
        notes: notes ?? estimate.notes,
        terms: terms ?? estimate.terms,
        subtotal: totals.subtotal,
        discount_type: discount_type ?? estimate.discount_type,
        discount_value: discount_value ?? estimate.discount_value,
        discount_amount: totals.discount_amount,
        tax_rate: tax_rate ?? estimate.tax_rate,
        tax_amount: totals.tax_amount,
        shipping_amount: shipping_amount ?? estimate.shipping_amount,
        total: totals.total,
      }

      let updated: EstimateRow | null = null

      if (line_items) {
        // UMA TRANSAÇÃO. replace_estimate_line_items executa a exclusão, a nova
        // inserção e a atualização dos totais em conjunto, impedindo que o
        // orçamento fique com um total sem itens. A implementação manual
        // substituída excluía as linhas antigas, inseria as novas e, em caso de
        // falha, tentava reinserir as linhas excluídas. Se essa restauração
        // também falhasse, a ferramenta precisava avisar que o orçamento ficara
        // vazio e pedir que a pessoa o corrigisse manualmente. Esse estado não
        // pode mais ocorrer.
        const { data, error: replaceError } = await ctx.db.svc.rpc('replace_estimate_line_items', {
          p_estimate_id: estimate_id,
          p_line_items: totals.line_items.map((item) => ({
            description: item.description ?? '',
            quantity: item.quantity,
            rate: item.rate,
            amount: item.amount,
          })),
          p_estimate_patch: patch,
        })

        if (replaceError || !data) {
          console.error('update_draft_estimate (replace line items):', replaceError)
          if (replaceError?.message === 'invalid_line_items') {
            return errorResult(
              'Os itens foram rejeitados; o orçamento não foi alterado. Envie de 1 a 500 itens e tente novamente.'
            )
          }
          return errorResult('Não foi possível atualizar o orçamento; ele não foi alterado.')
        }

        updated = data as unknown as EstimateRow
      } else {
        const { data, error: updateError } = await ctx.db.svc
          .from('estimates')
          .update(patch)
          .eq('id', estimate_id)
          .select('*')
          .single()

        if (updateError || !data) {
          console.error('update_draft_estimate (update):', updateError)
          return errorResult('Não foi possível atualizar o orçamento.')
        }

        updated = data
      }

      return jsonResult({
        summary: `Orçamento ${updated.estimate_number} em rascunho atualizado: ${formatCurrency(totals.total, updated.currency)}`,
        estimate: {
          id: updated.id,
          estimate_number: updated.estimate_number,
          status: updated.status,
          issue_date: updated.issue_date,
          expiry_date: updated.expiry_date,
          currency: updated.currency,
          subtotal: updated.subtotal,
          discount_type: updated.discount_type,
          discount_value: updated.discount_value,
          discount_amount: updated.discount_amount,
          tax_rate: updated.tax_rate,
          tax_amount: updated.tax_amount,
          shipping_amount: updated.shipping_amount,
          total: updated.total,
          notes: updated.notes,
          terms: updated.terms,
          line_items: totals.line_items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            rate: item.rate,
            amount: item.amount,
          })),
        },
        public_url: estimatePublicUrl(updated.public_id),
        app_url: `${appUrl()}/estimates/${updated.id}`,
      })
    }
  )

  server.registerTool(
    'send_estimate',
    {
      title: 'Enviar orçamento',
      description:
        'Enviar um orçamento por e-mail ao cliente e alterar o status de um rascunho para "sent". O destinatário padrão é o e-mail do próprio cliente. Use quando o orçamento estiver finalizado; isso não cria uma fatura nem recebe pagamentos. Recusa orçamentos já convertidos em fatura.',
      inputSchema: z.object({
        request_id: z.uuid().describe('ID estável do envio. Reutilize ao repetir a chamada com os mesmos destinatários e conteúdo.'),
        estimate_id: z.string().uuid().describe('ID do orçamento a enviar.'),
        to: z.string().email().optional().describe("E-mail do destinatário. O padrão é o e-mail do cliente associado ao orçamento."),
        cc: z.array(z.string().email()).max(10).optional().describe('Destinatários em cópia (Cc), no máximo 10.'),
        bcc: z.array(z.string().email()).max(10).optional().describe('Destinatários em cópia oculta (Bcc), no máximo 10.'),
        subject: z
          .string()
          .max(200)
          .optional()
          .describe('Assunto do e-mail. O padrão é "Orçamento <number> de <business>".'),
        message: z.string().max(2000).optional().describe('Mensagem pessoal opcional exibida acima do resumo do orçamento.'),
      }),
    },
    async ({ request_id, estimate_id, to, cc, bcc, subject, message }) => {
      let estimate
      try {
        estimate = await ctx.db.assertEstimateAccess(estimate_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível acessar o orçamento.')
      }

      if (estimate.status === 'converted') {
        return errorResult(
          `O orçamento ${estimate.estimate_number} já foi convertido em fatura. Use send_invoice para enviar essa fatura.`
        )
      }

      let recipient = to
      if (!recipient) {
        const { data: client, error: clientError } = await ctx.db.svc
          .from('clients')
          .select('email')
          .eq('id', estimate.client_id)
          .eq('business_id', estimate.business_id)
          .maybeSingle()

        if (clientError) {
          console.error('send_estimate (client lookup):', clientError)
          return errorResult('Não foi possível consultar o e-mail do cliente.')
        }

        if (!client?.email) {
          return errorResult(
            `O cliente do orçamento ${estimate.estimate_number} não tem e-mail cadastrado. Informe "to" explicitamente.`
          )
        }

        recipient = client.email
      }

      try {
        const result = await sendEstimateEmail(ctx.db.svc, estimate_id, {
          requestId: request_id,
          to: recipient,
          cc,
          bcc,
          subject,
          message,
        })

        return jsonResult({
          summary: `Orçamento ${estimate.estimate_number} enviado para ${result.to}.`,
          to: result.to,
          public_url: estimatePublicUrl(estimate.public_id),
        })
      } catch (err) {
        if (err instanceof SendEstimateEmailError) {
          return errorResult(err.message)
        }
        console.error('send_estimate (send):', err)
        return errorResult('Não foi possível enviar o orçamento.')
      }
    }
  )

  server.registerTool(
    'convert_estimate_to_invoice',
    {
      title: 'Converter orçamento em fatura',
      description:
        'Converter um orçamento em uma fatura em rascunho com os mesmos itens, moeda, observações e condições; depois, marcar o orçamento como "converted" e vincular os dois documentos. Use quando o cliente tiver aceitado. A fatura NÃO é enviada; depois, chame send_invoice. Recusa orçamentos já convertidos, recusados ou vencidos.',
      inputSchema: z.object({
        estimate_id: z.string().uuid().describe('ID do orçamento a converter.'),
        issue_date: DATE_FIELD.optional().describe('Data de emissão da fatura, YYYY-MM-DD. O padrão é a data de hoje.'),
        due_date: DATE_FIELD.optional().describe(
          "Data de vencimento da fatura, YYYY-MM-DD. O padrão é issue_date mais o prazo de pagamento padrão da empresa."
        ),
      }),
    },
    async ({ estimate_id, issue_date, due_date }) => {
      let estimate
      try {
        estimate = await ctx.db.assertEstimateAccess(estimate_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível acessar o orçamento.')
      }

      // Já convertido antes mesmo do início: a chamada está usando informações
      // desatualizadas, geralmente porque uma chamada anterior do mesmo agente
      // foi concluída e ele está repetindo a solicitação. Retorne a fatura que
      // já existe em vez de falhar, para que a repetição converja. Consulte
      // alreadyConvertedResult.
      if (estimate.status === 'converted' || estimate.converted_invoice_id) {
        if (estimate.converted_invoice_id) {
          try {
            const existing = await ctx.db.assertInvoiceAccess(estimate.converted_invoice_id)
            return await alreadyConvertedResult(ctx, estimate, existing)
          } catch {
            // Continue para a recusa abaixo: o vínculo aponta para uma fatura que esta
            // chave não pode consultar ou que não existe mais; portanto, não há
            // nada seguro para retornar nem para criar.
          }
        }
        return errorResult(
          `O orçamento ${estimate.estimate_number} já foi convertido na fatura ${estimate.converted_invoice_id ?? '(desconhecida)'}. Use get_invoice para consultar essa fatura em vez de converter novamente.`
        )
      }
      if (estimate.status === 'declined' || estimate.status === 'expired') {
        return errorResult(
          `O orçamento ${estimate.estimate_number} está com status "${estimate.status}". Crie um novo orçamento e obtenha a aprovação do cliente antes de emitir a fatura.`
        )
      }

      const [{ data: lineItems, error: lineItemsError }, { data: business, error: businessError }] =
        await Promise.all([
          ctx.db.svc
            .from('estimate_line_items')
            .select('description, quantity, rate, sort_order')
            .eq('estimate_id', estimate_id)
            .order('sort_order', { ascending: true })
            .limit(500),
          ctx.db.svc.from('businesses').select('*').eq('id', estimate.business_id).maybeSingle(),
        ])

      if (lineItemsError || businessError || !business) {
        console.error('convert_estimate_to_invoice (load):', lineItemsError ?? businessError)
        return errorResult('Não foi possível carregar o conteúdo do orçamento.')
      }

      if (!lineItems || lineItems.length === 0) {
        return errorResult(
          `O orçamento ${estimate.estimate_number} não tem itens, portanto não há nada a faturar.`
        )
      }

      const totals = { ...computeInvoiceTotals(lineItems), subtotal: estimate.subtotal, total: estimate.total }

      const resolvedIssueDate = issue_date || todayISO()
      const resolvedDueDate =
        due_date || toISODate(addDays(parseDay(resolvedIssueDate), business.default_payment_terms))

      // UMA TRANSAÇÃO, PRIMEIRO A REIVINDICAÇÃO. convert_estimate_to_invoice
      // marca o orçamento como convertido com um UPDATE condicional antes de
      // gravar qualquer dado, aloca o número da fatura por meio de
      // allocate_document_number e insere a fatura e seus itens, tudo na mesma
      // transação.
      //
      // Isso substitui uma verificação de leitura seguida de gravação, que duas
      // chamadas simultâneas com o mesmo estimate_id poderiam ultrapassar,
      // criando cada uma uma fatura real e consumindo um número. Uma repetição
      // após o tempo limite já era suficiente para cobrar o cliente duas vezes.
      const { data: converted, error: convertError } = await ctx.db.svc.rpc(
        'convert_estimate_to_invoice',
        {
          p_estimate_id: estimate_id,
          p_public_id: generatePublicId(),
          p_issue_date: resolvedIssueDate,
          p_due_date: resolvedDueDate,
          p_line_items: totals.line_items.map((item) => ({
            description: item.description ?? '',
            quantity: item.quantity,
            rate: item.rate,
            amount: item.amount,
          })),
          p_subtotal: totals.subtotal,
          p_total: totals.total,
          p_created_via: 'agent',
          p_created_by_key_id: ctx.keyId,
        }
      )

      if (convertError || !converted) {
        console.error('convert_estimate_to_invoice (rpc):', convertError)
        const code = convertError?.message ?? ''
        if (code === 'estimate_not_found') {
          return errorResult('Orçamento não encontrado')
        }
        if (code === 'estimate_not_convertible') {
          return errorResult(
            `O orçamento ${estimate.estimate_number} está com status "${estimate.status}". Crie um novo orçamento e obtenha a aprovação do cliente antes de emitir a fatura.`
          )
        }
        return errorResult('Não foi possível converter o orçamento; nada foi criado.')
      }

      const result = converted as unknown as ConversionResult

      // PERDEDOR DA DISPUTA. Outra chamada reivindicou o orçamento entre a nossa
      // leitura e a nossa reivindicação, então esta chamada não gravou nada:
      // nenhuma fatura ou item e nenhum número de fatura foi consumido. Informe
      // a fatura da chamada vencedora como sucesso. Falhar aqui diria ao agente
      // que repetiu a solicitação que um trabalho já concluído havia falhado,
      // situação que originalmente levou à criação de faturas duplicadas.
      if (!result.claimed) {
        if (result.invoice) {
          return await alreadyConvertedResult(ctx, estimate, result.invoice)
        }
        return errorResult(
          `O orçamento ${estimate.estimate_number} foi convertido por outra solicitação ainda em andamento. Chame get_estimate para localizar a fatura criada e não tente converter novamente.`
        )
      }

      const invoice = result.invoice
      if (!invoice) {
        console.error('convert_estimate_to_invoice (rpc): claimed with no invoice')
        return errorResult('Não foi possível converter o orçamento; nada foi criado.')
      }

      const notAcceptedNote =
        estimate.status === 'accepted' ? '' : ` (o orçamento estava com status "${estimate.status}", sem aprovação formal)`

      return jsonResult({
        summary: `Orçamento ${estimate.estimate_number} convertido na fatura em rascunho ${invoice.invoice_number}: ${formatCurrency(invoice.total, invoice.currency)}${notAcceptedNote}. Chame send_invoice para enviá-la.`,
        already_converted: false,
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
          total: invoice.total,
          balance_due: invoice.balance_due,
          line_items: totals.line_items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            rate: item.rate,
            amount: item.amount,
          })),
        },
        estimate: {
          id: estimate.id,
          estimate_number: estimate.estimate_number,
          status: 'converted',
          converted_invoice_id: invoice.id,
        },
        pdf_url: pdfUrl(invoice.public_id),
        app_url: `${appUrl()}/invoices/${invoice.id}`,
      })
    }
  )
}
