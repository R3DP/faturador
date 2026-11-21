import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import type { McpCtx } from '@/lib/mcp/context'
import { ScopeError } from '@/lib/mcp/scoped-db'
import { resolveClient } from './invoices-write'
import { appUrl, errorResult, jsonResult, formatCurrency, truncationNote } from '@/lib/mcp/shared'
import { BILLING_MODES, DUE_RULES, ENGAGEMENT_STATUSES, MAX_ENTRIES } from '@/lib/engagements/schedule'
import { engagementErrorMessage } from '@/lib/engagements/errors'
import { todayISO } from '@/lib/dates'

/**
 * Ferramentas de contratos: o valor acordado e o cronograma de cobrança.
 *
 * Toda gravação passa por uma RPC SECURITY DEFINER, responsável pelas regras
 * que não devem ficar a cargo da camada de ferramentas: ela verifica novamente
 * a permissão da chave no SQL, expande o cronograma no servidor para que os itens
 * somem exatamente o valor total, é idempotente por request_id e impede alterações
 * em valores que já foram faturados.
 *
 * NADA AQUI ENVIA QUALQUER COISA. Um contrato é um plano, não uma mensagem: nenhuma
 * ferramenta deste arquivo envia e-mail pelo Faturador, e um item do cronograma ficar
 * faturável significa que seu status mudou, não que o cliente foi contatado.
 */

const LIST_LIMIT_DEFAULT = 20
const READY_LIMIT_DEFAULT = 50

const DATE_FIELD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD')

interface SummaryRow {
  engagement_id: string
  business_id: string
  client_id: string
  name: string
  status: string
  billing_mode: string
  currency: string
  total: number
  starts_on: string | null
  target_end: string | null
  entry_count: number
  amount_billed: number
  amount_waived: number
  amount_remaining: number
  ready_count: number
  ready_amount: number
  next_ready_entries: unknown
}

interface EntryRow {
  id: string
  engagement_id: string
  position: number
  label: string
  amount: number
  percent: number | null
  due_rule: string
  due_on: string | null
  status: string
  invoice_id: string | null
  completed_at: string | null
  waived_reason: string | null
}

interface EngagementPayload {
  engagement: {
    id: string
    business_id: string
    client_id: string
    name: string
    total: number
    currency: string
    status: string
    billing_mode: string
    starts_on: string | null
    target_end: string | null
    notes: string | null
  }
  summary: Partial<SummaryRow>
  entries: EntryRow[]
  replayed?: boolean
  warning?: string | null
  amount_remaining?: number
  became_ready_to_bill?: boolean
  entry?: EntryRow
}

/**
 * Converte os códigos de erro da RPC em mensagens que o agente chamador
 * pode seguir. O vocabulário é compartilhado com as ações do servidor do app por
 * src/lib/engagements/errors.ts, para que pessoas e agentes recebam a mesma
 * explicação para cada regra. Códigos desconhecidos usam a mensagem genérica
 * fornecida pelo chamador, em vez de repassar um erro do Postgres.
 */
function engagementError(error: { message?: string } | null, fallback: string): string {
  const code = error?.message ?? ''
  const localizedMessages: Record<string, string> = {
    estimate_already_converted: 'Esta estimativa já foi convertida em uma fatura.',
    estimate_already_an_engagement: 'Esta estimativa já foi convertida em um contrato.',
    entry_already_invoiced: 'Este item do cronograma já foi faturado.',
    engagement_closed: 'Este contrato já foi concluído ou cancelado.',
  }
  if (localizedMessages[code]) return localizedMessages[code]

  const message = engagementErrorMessage(code)
  if (message) return message
  console.error('engagements (rpc):', error)
  return fallback
}

function entryView(entry: EntryRow, currency: string) {
  return {
    entry_id: entry.id,
    position: entry.position,
    label: entry.label,
    amount: entry.amount,
    amount_label: formatCurrency(entry.amount, currency),
    percent: entry.percent,
    due_rule: entry.due_rule,
    due_on: entry.due_on,
    status: entry.status,
    invoice_id: entry.invoice_id,
    invoice_url: entry.invoice_id ? `${appUrl()}/invoices/${entry.invoice_id}` : null,
    completed_at: entry.completed_at,
    waived_reason: entry.waived_reason,
  }
}

/** Usa o mesmo formato de resposta em todas as gravações, facilitando a leitura pelo agente. */
function payloadResult(data: unknown, summary: string) {
  const payload = data as unknown as EngagementPayload
  const currency = payload.engagement.currency
  return {
    summary,
    engagement: {
      id: payload.engagement.id,
      business_id: payload.engagement.business_id,
      client_id: payload.engagement.client_id,
      name: payload.engagement.name,
      status: payload.engagement.status,
      billing_mode: payload.engagement.billing_mode,
      currency,
      total: payload.engagement.total,
      starts_on: payload.engagement.starts_on,
      target_end: payload.engagement.target_end,
      notes: payload.engagement.notes,
      amount_billed: payload.summary.amount_billed ?? 0,
      amount_remaining: payload.summary.amount_remaining ?? payload.engagement.total,
      ready_count: payload.summary.ready_count ?? 0,
      app_url: `${appUrl()}/engagements/${payload.engagement.id}`,
    },
    schedule: (payload.entries ?? []).map((entry) => entryView(entry, currency)),
    replayed: payload.replayed === true,
  }
}

/**
 * Atualização dos itens com data programada, executada antes de responder a uma
 * consulta. Não há cron: um item com vencimento por data fica faturável na
 * primeira consulta. Falhas são registradas e ignoradas, pois não são motivo
 * para deixar de mostrar os contratos.
 */
async function sweep(ctx: McpCtx, businessIds: string[]): Promise<void> {
  await Promise.all(
    businessIds.map(async (businessId) => {
      const { error } = await ctx.db.svc.rpc('promote_due_entries', {
        p_business_id: businessId,
        p_actor_key_id: ctx.keyId,
      })
      if (error) console.error('promote_due_entries:', error)
    })
  )
}

/** Busca nomes de clientes por ID, limitando a consulta às empresas já resolvidas. */
async function clientNames(ctx: McpCtx, businessIds: string[], clientIds: string[]) {
  const names = new Map<string, string>()
  if (clientIds.length === 0) return names
  const { data } = await ctx.db.svc
    .from('clients')
    .select('id, name')
    .in('business_id', businessIds)
    .in('id', [...new Set(clientIds)])
  for (const row of (data ?? []) as { id: string; name: string }[]) names.set(row.id, row.name)
  return names
}

const scheduleEntryInput = z.object({
  label: z.string().max(200).optional().describe('Identificação desta cobrança, por exemplo "Sinal" ou "Na entrega".'),
  amount: z
    .number()
    .positive()
    .optional()
    .describe('Valor deste item. Obrigatório para billing_mode "milestones" e "manual"; a soma dos valores dos itens deve ser exatamente igual ao total do contrato.'),
  percent: z
    .number()
    .positive()
    .max(100)
    .optional()
    .describe('Percentual do valor total deste item, de 0 a 100. Obrigatório para billing_mode "percent_split"; a soma dos percentuais deve ser exatamente 100.'),
  due_rule: z
    .enum(DUE_RULES)
    .optional()
    .describe(
      'Quando este item fica faturável: "on_start" quando o contrato é iniciado, "on_complete" quando é concluído, "on_milestone" quando você chama mark_milestone_complete, "on_date" quando chega a data definida ou "manual" quando uma pessoa decide. Por padrão, usa on_start no primeiro item, on_complete no último e on_milestone nos itens intermediários.'
    ),
  due_on: DATE_FIELD.optional().describe('Data em que um item "on_date" fica faturável, no formato YYYY-MM-DD.'),
})

export function registerEngagementTools(server: McpServer, ctx: McpCtx) {
  // -------------------------------------------------------------------------
  // Consultas
  // -------------------------------------------------------------------------
  server.registerTool(
    'list_engagements',
    {
      title: 'Listar contratos',
      description:
        'Lista contratos: trabalhos acordados com valor total e cronograma de cobrança, por exemplo, "12.000 para reformar o site, 50% de entrada e 50% na entrega". Use para responder "o que combinamos com este cliente?" ou "quanto ainda falta faturar neste projeto?". Cada contrato informa quanto já foi faturado, quanto falta e quantos itens do cronograma estão prontos para faturar. A consulta não altera dados; nenhuma ferramenta de contratos envia qualquer coisa ao cliente.',
      inputSchema: z.object({
        offset: z
          .number()
          .int()
          .min(0)
          .max(1000000)
          .optional()
          .describe('Deslocamento da página. Comece em 0 e use next_offset até que seja null. Mantenha os demais filtros inalterados.'),
        business_id: z
          .string()
          .uuid()
          .optional()
          .describe('ID da empresa cujos contratos serão listados. Omita para listar todas as empresas dentro do escopo.'),
        client_id: z.string().uuid().optional().describe('Filtra os contratos para mostrar apenas os deste cliente.'),
        status: z
          .enum(ENGAGEMENT_STATUSES)
          .optional()
          .describe('Filtra pelo status: draft, active, paused, completed ou cancelled.'),
        has_ready_to_bill: z
          .boolean()
          .optional()
          .describe('Use true para listar apenas contratos com pelo menos um item do cronograma pronto para faturar agora.'),
        limit: z.number().int().min(1).max(100).optional().describe('Número máximo de contratos a retornar (padrão: 20; máximo: 100).'),
      }),
    },
    async ({ offset, business_id, client_id, status, has_ready_to_bill, limit }) => {
      let businessIds = ctx.db.scope.businessIds
      if (business_id !== undefined) {
        try {
          businessIds = [ctx.db.resolveBusinessId(business_id)]
        } catch (err) {
          return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar a empresa.')
        }
      }

      await sweep(ctx, businessIds)

      const resolvedLimit = limit ?? LIST_LIMIT_DEFAULT
      const resolvedOffset = offset ?? 0

      let query = ctx.db.svc
        .from('engagement_summary')
        .select('*')
        .in('business_id', ctx.db.scope.businessIds)
        .in('business_id', businessIds)
        .order('status', { ascending: true })
        .order('engagement_id', { ascending: true })
        .range(resolvedOffset, resolvedOffset + resolvedLimit - 1)

      if (client_id) query = query.eq('client_id', client_id)
      if (status) query = query.eq('status', status)
      if (has_ready_to_bill) query = query.gt('ready_count', 0)

      const { data, error } = await query
      if (error) {
        console.error('list_engagements:', error)
        return errorResult('Não foi possível listar os contratos.')
      }

      const rows = (data ?? []) as SummaryRow[]
      const names = await clientNames(ctx, businessIds, rows.map((row) => row.client_id))

      const engagements = rows.map((row) => ({
        id: row.engagement_id,
        business_id: row.business_id,
        client_id: row.client_id,
        client_name: names.get(row.client_id) ?? null,
        name: row.name,
        status: row.status,
        billing_mode: row.billing_mode,
        currency: row.currency,
        total: row.total,
        amount_billed: row.amount_billed,
        amount_remaining: row.amount_remaining,
        amount_waived: row.amount_waived,
        ready_count: row.ready_count,
        ready_amount: row.ready_amount,
        starts_on: row.starts_on,
        target_end: row.target_end,
        app_url: `${appUrl()}/engagements/${row.engagement_id}`,
      }))

      const truncated = engagements.length === resolvedLimit
      const readyTotal = engagements.reduce((sum, row) => sum + row.ready_count, 0)

      return jsonResult({
        offset: resolvedOffset,
        next_offset: truncated ? resolvedOffset + resolvedLimit : null,
        summary: `${engagements.length} ${engagements.length === 1 ? 'contrato' : 'contratos'}${status ? ` com status "${status}"` : ''}, ${readyTotal} ${readyTotal === 1 ? 'item do cronograma pronto' : 'itens do cronograma prontos'} para faturar${truncated ? truncationNote(resolvedLimit) : ''}`,
        engagements,
      })
    }
  )

  server.registerTool(
    'get_engagement',
    {
      title: 'Consultar contrato',
      description:
        'Consulta todos os dados de um contrato: valor acordado, quanto já foi faturado, quanto falta e cada item do cronograma, com status, regra de vencimento e fatura associada. Consulte antes de faturar para selecionar os itens prontos, e não os que já foram faturados. A consulta não altera dados nem envia qualquer coisa.',
      inputSchema: z.object({
        engagement_id: z
          .string()
          .uuid()
          .describe('ID do contrato, obtido em list_engagements ou create_engagement.'),
      }),
    },
    async ({ engagement_id }) => {
      const businessIds = ctx.db.scope.businessIds
      await sweep(ctx, businessIds)

      const { data, error } = await ctx.db.svc
        .from('engagement_summary')
        .select('*')
        .eq('engagement_id', engagement_id)
        .in('business_id', businessIds)
        .maybeSingle()

      if (error) console.error('get_engagement (summary):', error)
      // IDs inexistentes e fora do escopo recebem a mesma resposta: não se revela se o registro existe.
      if (error || !data) return errorResult('Contrato não encontrado')

      const summary = data as SummaryRow

      const [{ data: entries, error: entriesError }, names] = await Promise.all([
        ctx.db.svc
          .from('engagement_entries')
          .select(
            'id, engagement_id, position, label, amount, percent, due_rule, due_on, status, invoice_id, completed_at, waived_reason'
          )
          .eq('engagement_id', engagement_id)
          .eq('business_id', summary.business_id)
          .order('position', { ascending: true })
          .limit(MAX_ENTRIES),
        clientNames(ctx, businessIds, [summary.client_id]),
      ])

      if (entriesError) {
        console.error('get_engagement (entries):', entriesError)
        return errorResult('Não foi possível carregar o cronograma deste contrato.')
      }

      const rows = (entries ?? []) as EntryRow[]
      const billed = formatCurrency(summary.amount_billed, summary.currency)
      const remaining = formatCurrency(summary.amount_remaining, summary.currency)

      return jsonResult({
        summary: `${summary.name} para ${names.get(summary.client_id) ?? 'cliente desconhecido'}: total acordado: ${formatCurrency(summary.total, summary.currency)}, ${billed} faturados, ${remaining} restantes (${summary.status}). ${summary.ready_count} ${summary.ready_count === 1 ? 'item do cronograma está' : 'itens do cronograma estão'} prontos para faturar.`,
        engagement: {
          id: summary.engagement_id,
          business_id: summary.business_id,
          client_id: summary.client_id,
          client_name: names.get(summary.client_id) ?? null,
          name: summary.name,
          status: summary.status,
          billing_mode: summary.billing_mode,
          currency: summary.currency,
          total: summary.total,
          amount_billed: summary.amount_billed,
          amount_waived: summary.amount_waived,
          amount_remaining: summary.amount_remaining,
          ready_count: summary.ready_count,
          ready_amount: summary.ready_amount,
          starts_on: summary.starts_on,
          target_end: summary.target_end,
          app_url: `${appUrl()}/engagements/${summary.engagement_id}`,
        },
        schedule: rows.map((entry) => entryView(entry, summary.currency)),
      })
    }
  )

  server.registerTool(
    'list_ready_to_bill',
    {
      title: 'Listar itens prontos para faturar',
      description:
        'Lista todos os itens de cronogramas de contratos que estão prontos para faturar agora, para todos os clientes. É a lista de "o que devo faturar hoje": entradas de contratos iniciados, etapas marcadas como concluídas, cobranças com data já vencida e parcelas finais de contratos concluídos. Cada item informa a data due_on e indica overdue_on_date quando ela já passou. Nada desta lista foi faturado, e a consulta não envia qualquer coisa. Para faturar, passe os entry_ids desejados a create_invoice como engagement_entry_ids. A consulta não altera dados.',
      inputSchema: z.object({
        offset: z
          .number()
          .int()
          .min(0)
          .max(1000000)
          .optional()
          .describe('Deslocamento da página. Comece em 0 e use next_offset até que seja null. Mantenha os demais filtros inalterados.'),
        business_id: z
          .string()
          .uuid()
          .optional()
          .describe('ID da empresa a consultar. Omita para incluir todas as empresas dentro do escopo.'),
        client_id: z.string().uuid().optional().describe('Filtra para mostrar somente um cliente.'),
        limit: z.number().int().min(1).max(200).optional().describe('Número máximo de itens a retornar (padrão: 50; máximo: 200).'),
      }),
    },
    async ({ offset, business_id, client_id, limit }) => {
      let businessIds = ctx.db.scope.businessIds
      if (business_id !== undefined) {
        try {
          businessIds = [ctx.db.resolveBusinessId(business_id)]
        } catch (err) {
          return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar a empresa.')
        }
      }

      await sweep(ctx, businessIds)

      const resolvedLimit = limit ?? READY_LIMIT_DEFAULT
      const resolvedOffset = offset ?? 0

      const query = ctx.db.svc
        .from('engagement_entries')
        .select(
          'id, engagement_id, business_id, position, label, amount, due_rule, due_on, status, engagement:engagements(name, currency, client_id, status)'
        )
        .in('business_id', ctx.db.scope.businessIds)
        .in('business_id', businessIds)
        .eq('status', 'ready_to_bill')
        .order('due_on', { ascending: true })
        .order('id', { ascending: true })
        .range(resolvedOffset, resolvedOffset + resolvedLimit - 1)

      const { data, error } = await query
      if (error) {
        console.error('list_ready_to_bill:', error)
        return errorResult('Não foi possível listar os trabalhos prontos para faturar.')
      }

      type Joined = EntryRow & {
        business_id: string
        engagement: { name: string; currency: string; client_id: string; status: string } | null
      }
      let rows = (data ?? []) as Joined[]
      if (client_id) rows = rows.filter((row) => row.engagement?.client_id === client_id)

      const names = await clientNames(
        ctx,
        businessIds,
        rows.map((row) => row.engagement?.client_id).filter((id): id is string => !!id)
      )

      // Quando a consulta encontra um item cuja data já passou, ele já está pronto
      // para faturar (a atualização acima mudou seu status). Portanto, "overdue"
      // significa que o valor está faturável desde aquela data e ainda não consta
      // em uma fatura. É um indicador, não uma lista separada, para que o agente
      // possa ordenar por urgência sem precisar calcular as datas.
      const today = todayISO()
      const entries = rows.map((row) => ({
        entry_id: row.id,
        engagement_id: row.engagement_id,
        engagement_name: row.engagement?.name ?? null,
        engagement_status: row.engagement?.status ?? null,
        business_id: row.business_id,
        client_id: row.engagement?.client_id ?? null,
        client_name: row.engagement?.client_id ? (names.get(row.engagement.client_id) ?? null) : null,
        label: row.label,
        amount: row.amount,
        currency: row.engagement?.currency ?? null,
        due_rule: row.due_rule,
        due_on: row.due_on,
        overdue_on_date: row.due_rule === 'on_date' && !!row.due_on && row.due_on <= today,
        new_invoice_url: `${appUrl()}/invoices/new?engagement_entries=${row.id}`,
        app_url: `${appUrl()}/engagements/${row.engagement_id}`,
      }))

      const truncated = (data ?? []).length === resolvedLimit
      const byCurrency = new Map<string, number>()
      for (const entry of entries) {
        const currency = entry.currency ?? 'USD'
        byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + entry.amount)
      }
      const totals = [...byCurrency.entries()].map(([currency, amount]) => formatCurrency(amount, currency))
      const overdue = entries.filter((entry) => entry.overdue_on_date).length

      return jsonResult({
        offset: resolvedOffset,
        next_offset: truncated ? resolvedOffset + resolvedLimit : null,
        summary: `${entries.length} ${entries.length === 1 ? 'item do cronograma pronto' : 'itens do cronograma prontos'} para faturar${totals.length ? `, no valor de ${totals.join(' mais ')}` : ''}${overdue > 0 ? `, ${overdue} com data de vencimento já passada` : ''}${truncated ? truncationNote(resolvedLimit) : ''}. Para faturá-los, passe seus entry_ids a create_invoice como engagement_entry_ids.`,
        overdue_count: overdue,
        entries,
      })
    }
  )

  // -------------------------------------------------------------------------
  // Gravações
  // -------------------------------------------------------------------------
  server.registerTool(
    'create_engagement',
    {
      title: 'Criar contrato',
      description:
        'Registra um trabalho acordado com valor total e cronograma de cobrança, por exemplo, "12.000 pela reforma, 50% de entrada e 50% na entrega" ou "9.000 em 3 parcelas iguais". O cronograma é calculado no servidor para que a soma dos itens seja sempre exatamente igual ao total; o último item absorve eventuais diferenças de arredondamento. Criar o contrato não fatura nem envia nada: os itens ficam prontos para faturar conforme suas regras de vencimento, e então você emite uma fatura. Use create_estimate se o preço ainda não foi acordado e create_invoice se o trabalho já foi entregue e deve ser faturado agora.',
      inputSchema: z.object({
        request_id: z.uuid().describe('ID estável da solicitação. Em novas tentativas, reutilize-o com os mesmos dados.'),
        business_id: z
          .string()
          .uuid()
          .optional()
          .describe('ID da empresa. Opcional quando a chave de API está limitada a uma única empresa; obrigatório quando está limitada a várias.'),
        client_id: z.string().uuid().optional().describe('ID do cliente. Informe este campo ou client_name.'),
        client_name: z
          .string()
          .max(200)
          .optional()
          .describe('Nome exato do cliente, sem distinção entre maiúsculas e minúsculas. Informe este campo ou client_id.'),
        name: z.string().min(1).max(200).describe('Descrição do que foi acordado, por exemplo, "Reforma do site".'),
        total: z.number().positive().describe('Valor total acordado para o contrato, na moeda definida para ele.'),
        currency: z
          .string()
          .length(3)
          .optional()
          .describe('Código de moeda com três letras. Usa a moeda do cliente por padrão ou, se não houver, a moeda padrão da empresa.'),
        billing_mode: z
          .enum(BILLING_MODES)
          .describe(
            'Como dividir o valor total: "percent_split" (cada item tem um percentual), "equal_installments" (n parcelas iguais; defina installments), "milestones" (cada item tem seu próprio valor) ou "manual" (valores informados por você, cada um aguardando decisão de uma pessoa).'
          ),
        entries: z
          .array(scheduleEntryInput)
          .max(MAX_ENTRIES)
          .optional()
          .describe('Cronograma. Obrigatório para percent_split, milestones e manual. Opcional para equal_installments, caso em que apenas dá nome às parcelas.'),
        installments: z
          .number()
          .int()
          .min(1)
          .max(MAX_ENTRIES)
          .optional()
          .describe('Número de parcelas iguais em que o valor será dividido. Usado somente com billing_mode "equal_installments".'),
        start_now: z
          .boolean()
          .optional()
          .describe('Use true para iniciar o contrato imediatamente, deixando pronto para faturar qualquer item "on_start". Por padrão, é false e o contrato permanece como rascunho.'),
        starts_on: DATE_FIELD.optional().describe('Data de início do trabalho, no formato YYYY-MM-DD.'),
        target_end: DATE_FIELD.optional().describe('Data prevista para a conclusão do trabalho, no formato YYYY-MM-DD.'),
        notes: z.string().max(2000).optional().describe('Observações internas sobre o contrato. Nunca são exibidas ao cliente.'),
        source_estimate_id: z
          .string()
          .uuid()
          .optional()
          .describe('ID da estimativa de origem deste contrato, caso ele tenha começado como uma proposta.'),
      }),
    },
    async ({
      request_id,
      business_id,
      client_id,
      client_name,
      name,
      total,
      currency,
      billing_mode,
      entries,
      installments,
      start_now,
      starts_on,
      target_end,
      notes,
      source_estimate_id,
    }) => {
      let resolvedBusinessId: string
      try {
        resolvedBusinessId = ctx.db.resolveBusinessId(business_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar a empresa.')
      }

      let client
      try {
        client = await resolveClient(ctx, resolvedBusinessId, client_id, client_name)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar o cliente.')
      }

      const { data, error } = await ctx.db.svc.rpc('create_engagement_with_schedule', {
        p_request_id: request_id,
        p_business_id: resolvedBusinessId,
        p_client_id: client.id,
        p_name: name,
        p_total: total,
        p_currency: currency ?? '',
        p_billing_mode: billing_mode,
        p_entries: (entries ?? []) as never,
        p_installments: installments,
        p_status: start_now ? 'active' : 'draft',
        p_starts_on: starts_on,
        p_target_end: target_end,
        p_notes: notes,
        p_source_estimate_id: source_estimate_id,
        p_actor_key_id: ctx.keyId,
      })

      if (error || !data) return errorResult(engagementError(error, 'Não foi possível criar esse contrato.'))

      const result = payloadResult(data, '')
      const ready = result.schedule.filter((entry) => entry.status === 'ready_to_bill').length
      result.summary = `Contrato ${result.engagement.name} registrado para ${client.name}: ${formatCurrency(result.engagement.total, result.engagement.currency)} em ${result.schedule.length} ${result.schedule.length === 1 ? 'item' : 'itens'} do cronograma (${result.engagement.status}). ${ready} ${ready === 1 ? 'item pronto' : 'itens prontos'} para faturar agora. Nada foi enviado ao cliente.`
      return jsonResult(result)
    }
  )

  server.registerTool(
    'update_engagement',
    {
      title: 'Atualizar contrato',
      description:
        'Corrige os dados de um contrato: nome, datas de vigência ou observações internas. Os campos omitidos permanecem como estão. O valor total acordado, a moeda, a forma de cobrança e o cronograma não podem ser alterados aqui: mudar um valor acordado depois de já faturar parte do trabalho é uma renegociação, não uma edição. Nada é enviado a ninguém.',
      inputSchema: z.object({
        request_id: z.uuid().describe('ID estável da solicitação. Em novas tentativas, reutilize-o com os mesmos dados.'),
        engagement_id: z.string().uuid().describe('ID do contrato a atualizar.'),
        name: z.string().min(1).max(200).optional().describe('Nome corrigido do contrato.'),
        starts_on: DATE_FIELD.optional().describe('Data de início corrigida, no formato YYYY-MM-DD.'),
        target_end: DATE_FIELD.optional().describe('Data prevista de conclusão corrigida, no formato YYYY-MM-DD.'),
        notes: z.string().max(2000).optional().describe('Observações internas corrigidas. Nunca são exibidas ao cliente.'),
      }),
    },
    async ({ request_id, engagement_id, name, starts_on, target_end, notes }) => {
      if (
        name === undefined &&
        starts_on === undefined &&
        target_end === undefined &&
        notes === undefined
      ) {
        return errorResult('Informe pelo menos um campo para alterar.')
      }

      const { data, error } = await ctx.db.svc.rpc('update_engagement', {
        p_request_id: request_id,
        p_engagement_id: engagement_id,
        p_name: name,
        p_starts_on: starts_on,
        p_target_end: target_end,
        p_notes: notes,
        p_actor_key_id: ctx.keyId,
      })

      if (error || !data) return errorResult(engagementError(error, 'Não foi possível atualizar esse contrato.'))

      const result = payloadResult(data, '')
      result.summary = `${result.engagement.name} atualizado. Ainda faltam faturar ${formatCurrency(result.engagement.amount_remaining, result.engagement.currency)} de ${formatCurrency(result.engagement.total, result.engagement.currency)}.`
      return jsonResult(result)
    }
  )

  server.registerTool(
    'mark_milestone_complete',
    {
      title: 'Marcar etapa como concluída',
      description:
        'Registra a entrega de um item do cronograma. Um item que aguardava uma etapa fica pronto para faturar; um item que aguardava o início ou a conclusão do contrato, ou uma data, mantém sua própria regra e apenas recebe a marca de concluído. Nada é faturado nem enviado: use list_ready_to_bill para consultar o que ficou liberado e então emita uma fatura.',
      inputSchema: z.object({
        request_id: z.uuid().describe('ID estável da solicitação. Em novas tentativas, reutilize-o com os mesmos dados.'),
        entry_id: z
          .string()
          .uuid()
          .describe('ID do item do cronograma, obtido em get_engagement ou list_ready_to_bill.'),
      }),
    },
    async ({ request_id, entry_id }) => {
      const { data, error } = await ctx.db.svc.rpc('mark_entry_complete', {
        p_request_id: request_id,
        p_entry_id: entry_id,
        p_actor_key_id: ctx.keyId,
      })

      if (error || !data) return errorResult(engagementError(error, 'Não foi possível marcar esse item como concluído.'))

      const payload = data as unknown as EngagementPayload
      const result = payloadResult(data, '')
      const entry = payload.entry
      const readyNote = payload.became_ready_to_bill
        ? `${formatCurrency(entry?.amount ?? 0, result.engagement.currency)} está pronto para faturar.`
        : 'O item ainda aguarda sua própria regra de vencimento para poder ser faturado.'
      result.summary = `Item "${entry?.label ?? 'o item'}" marcado como concluído em ${result.engagement.name}. ${readyNote} Nada foi enviado ao cliente.`
      return jsonResult(result)
    }
  )

  server.registerTool(
    'complete_engagement',
    {
      title: 'Concluir contrato',
      description:
        'Encerra um contrato quando o trabalho estiver concluído. Cada item do cronograma que aguardava a conclusão fica pronto para faturar; se ainda houver algum valor não faturado, a resposta informa quanto, para que nada seja esquecido. A conclusão não emite fatura nem envia nada. Um contrato concluído não pode ser reaberto, então faça isso somente quando o trabalho realmente terminar.',
      inputSchema: z.object({
        request_id: z.uuid().describe('ID estável da solicitação. Em novas tentativas, reutilize-o com os mesmos dados.'),
        engagement_id: z.string().uuid().describe('ID do contrato a concluir.'),
      }),
    },
    async ({ request_id, engagement_id }) => {
      const { data, error } = await ctx.db.svc.rpc('set_engagement_status', {
        p_request_id: request_id,
        p_engagement_id: engagement_id,
        p_status: 'completed',
        p_actor_key_id: ctx.keyId,
      })

      if (error || !data) return errorResult(engagementError(error, 'Não foi possível concluir esse contrato.'))

      const payload = data as unknown as EngagementPayload
      const result = payloadResult(data, '')
      const ready = result.schedule.filter((entry) => entry.status === 'ready_to_bill').length
      const warning = payload.warning
        ? ` Ainda faltam faturar ${formatCurrency(result.engagement.amount_remaining, result.engagement.currency)} do valor acordado de ${formatCurrency(result.engagement.total, result.engagement.currency)}. Fature ou abone os itens restantes.`
        : ''
      result.summary = `${result.engagement.name} concluído. ${ready} ${ready === 1 ? 'item do cronograma está' : 'itens do cronograma estão'} prontos para faturar.${warning} Nada foi enviado ao cliente.`
      return jsonResult({ ...result, warning: payload.warning ?? null })
    }
  )

  server.registerTool(
    'convert_estimate_to_engagement',
    {
      title: 'Converter estimativa em contrato',
      description:
        'Converte uma estimativa aceita em contrato, mantendo cliente, valor total e moeda, mas substituindo a cobrança única por um cronograma de pagamentos. Use quando a proposta tiver sido aceita, mas o trabalho for faturado em parcelas; use convert_estimate_to_invoice quando o valor total vencer de uma só vez. Uma estimativa pode ser convertida em fatura ou contrato, nunca nos dois: esta ferramenta recusa propostas já convertidas. O contrato é criado como rascunho; nada é faturado ou enviado. Inicie-o quando o trabalho começar para deixar qualquer entrada pronta para faturar.',
      inputSchema: z.object({
        request_id: z.uuid().describe('ID estável da solicitação. Em novas tentativas, reutilize-o com os mesmos dados.'),
        estimate_id: z
          .string()
          .uuid()
          .describe('ID da estimativa aceita a converter, obtido em list_estimates ou get_estimate.'),
        billing_mode: z
          .enum(BILLING_MODES)
          .describe(
            'Como dividir o valor total da proposta: "percent_split" (cada item tem um percentual), "equal_installments" (n parcelas iguais; defina installments), "milestones" (cada item tem seu próprio valor) ou "manual" (valores informados por você, cada um aguardando decisão de uma pessoa).'
          ),
        entries: z
          .array(scheduleEntryInput)
          .max(MAX_ENTRIES)
          .optional()
          .describe('Cronograma. Obrigatório para percent_split, milestones e manual. Opcional para equal_installments, caso em que apenas dá nome às parcelas.'),
        installments: z
          .number()
          .int()
          .min(1)
          .max(MAX_ENTRIES)
          .optional()
          .describe('Número de parcelas iguais em que o valor da proposta será dividido. Usado somente com billing_mode "equal_installments".'),
      }),
    },
    async ({ request_id, estimate_id, billing_mode, entries, installments }) => {
      // A RPC limita a estimativa ao escopo e identifica o usuário
      // com base na empresa da própria estimativa e recusa registros inacessíveis
      // à chave. Assim, um ID fora do escopo recebe a mesma resposta "não encontrado"
      // que um ID inexistente. O valor total e a moeda também são lidos na RPC, nunca enviados por esta ferramenta.
      const { data, error } = await ctx.db.svc.rpc('convert_estimate_to_engagement', {
        p_request_id: request_id,
        p_estimate_id: estimate_id,
        p_billing_mode: billing_mode,
        p_entries: (entries ?? []) as never,
        p_installments: installments,
        p_actor_key_id: ctx.keyId,
      })

      if (error || !data) {
        return errorResult(engagementError(error, 'Não foi possível converter essa estimativa em contrato.'))
      }

      const result = payloadResult(data, '')
      result.summary = `Estimativa convertida em ${result.engagement.name}: ${formatCurrency(result.engagement.total, result.engagement.currency)} em ${result.schedule.length} ${result.schedule.length === 1 ? 'item' : 'itens'} do cronograma. O contrato está como rascunho, então nada pode ser faturado ainda. Inicie-o pelo app ou quando o trabalho começar. Nada foi enviado ao cliente.`
      return jsonResult(result)
    }
  )

  server.registerTool(
    'waive_engagement_entry',
    {
      title: 'Abonar item do contrato',
      description:
        'Abona, com justificativa, um item do cronograma que não será cobrado. O item permanece no cronograma para preservar o que foi acordado, mas deixa de contar no valor a faturar. Use quando parte do trabalho for cancelada ou absorvida. Um item já faturado não pode ser abonado: nesse caso, emita uma nota de crédito na fatura. Nada é enviado a ninguém.',
      inputSchema: z.object({
        request_id: z.uuid().describe('ID estável da solicitação. Em novas tentativas, reutilize-o com os mesmos dados.'),
        entry_id: z.string().uuid().describe('ID do item do cronograma a abonar, obtido em get_engagement.'),
        reason: z
          .string()
          .min(1)
          .max(2000)
          .describe('Motivo pelo qual este valor não será cobrado. Fica registrado no item e é exibido no app.'),
      }),
    },
    async ({ request_id, entry_id, reason }) => {
      const { data, error } = await ctx.db.svc.rpc('waive_entry', {
        p_request_id: request_id,
        p_entry_id: entry_id,
        p_reason: reason,
        p_actor_key_id: ctx.keyId,
      })

      if (error || !data) return errorResult(engagementError(error, 'Não foi possível abonar esse item.'))

      const payload = data as unknown as EngagementPayload
      const result = payloadResult(data, '')
      result.summary = `${formatCurrency(payload.entry?.amount ?? 0, result.engagement.currency)} abonados em ${result.engagement.name}. Ainda faltam faturar ${formatCurrency(result.engagement.amount_remaining, result.engagement.currency)}.`
      return jsonResult(result)
    }
  )
}
