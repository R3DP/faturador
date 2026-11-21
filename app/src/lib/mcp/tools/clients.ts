import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import type { McpCtx } from '@/lib/mcp/context'
import { ScopeError } from '@/lib/mcp/scoped-db'
import { appUrl, errorResult, jsonResult, escapeLike, likeAnyFilter, truncationNote } from '@/lib/mcp/shared'

const CLIENTS_LIMIT = 100

export interface ClientFinancials {
  total_invoiced: number
  outstanding_balance: number
  total_paid: number
}

const ZERO_FINANCIALS: ClientFinancials = {
  total_invoiced: 0,
  outstanding_balance: 0,
  total_paid: 0,
}

/**
 * Calcula os totais faturados/em aberto por cliente a partir da tabela de faturas.
 *
 * A tabela clients tem as colunas total_invoiced/outstanding_balance armazenadas,
 * mas nada no app as mantém, então estão permanentemente desatualizadas. Estas
 * ferramentas calculam os valores em vez disso, em uma consulta por chamada,
 * limitadas às empresas de quem chamou. Apenas faturas que não sejam rascunho
 * nem canceladas, conforme a regra EXCLUDED_FROM_TOTALS de revenue_summary.
 */
async function computeClientFinancials(
  ctx: McpCtx,
  businessIds: string[],
  clientIds: string[]
): Promise<Map<string, ClientFinancials>> {
  const totals = new Map<string, ClientFinancials>()
  if (clientIds.length === 0) return totals

  const { data, error } = await ctx.db.svc.from('client_financials').select('*').in('business_id',businessIds).in('client_id',clientIds)
  if(error)throw error
  for(const row of data||[]){if(row.client_id&&row.currency)totals.set(`${row.client_id}:${row.currency}`,{total_invoiced:row.total_invoiced||0,total_paid:row.total_paid||0,outstanding_balance:row.outstanding_balance||0})}

  return totals
}

const clientMutableFields = {
  name: z.string().min(1).max(200).describe('Nome do cliente (pessoa ou empresa).'),
  email: z.string().email().max(320).optional().describe('Endereço de e-mail do cliente.'),
  phone: z.string().max(50).optional().describe('Número de telefone do cliente.'),
  address_line1: z.string().max(200).optional().describe('Endereço, linha 1.'),
  address_line2: z.string().max(200).optional().describe('Endereço, linha 2 (sala, unidade etc.).'),
  city: z.string().max(100).optional().describe('Cidade.'),
  state: z.string().max(100).optional().describe('Estado ou província.'),
  postal_code: z.string().max(20).optional().describe('Código postal.'),
  country: z.string().max(100).optional().describe('País.'),
  currency: z.string().max(10).optional().describe('Código de moeda ISO deste cliente, por exemplo "USD". Se omitido, usa a moeda da empresa.'),
  notes: z.string().max(2000).optional().describe('Observações internas livres sobre este cliente.'),
}

/**
 * Registra as quatro ferramentas de gerenciamento de clientes (listar, consultar,
 * criar e atualizar) no servidor MCP informado, limitadas às empresas em ctx.db.scope.
 */
export function registerClientTools(server: McpServer, ctx: McpCtx) {
  server.registerTool(
    'list_clients',
    {
      title: 'Listar clientes',
      description:
        'Lista os clientes de uma das empresas de quem chamou, em ordem alfabética. Opcionalmente, filtra por trecho sem distinção entre maiúsculas e minúsculas no nome ou e-mail.',
      inputSchema: z.object({
        offset: z.number().int().min(0).max(1000000).optional().describe('Deslocamento da página. Comece em 0 e use next_offset até que seja null. Mantenha os demais filtros inalterados.'),
        business_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'ID da empresa cujos clientes serão listados. Opcional quando a chave de API está limitada a exatamente uma empresa; obrigatório quando está limitada a várias.'
          ),
        search: z
          .string()
          .max(200)
          .optional()
          .describe('Trecho de texto, sem distinção entre maiúsculas e minúsculas, para filtrar clientes por nome ou e-mail.'),
      }),
    },
    async ({ offset, business_id, search }) => {
      let resolvedId: string
      try {
        resolvedId = ctx.db.resolveBusinessId(business_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar a empresa.')
      }

      let query = ctx.db.svc
        .from('clients')
        .select('id, name, email, currency')
        .in('business_id', ctx.db.scope.businessIds)
        .eq('business_id', resolvedId)
        .order('name', { ascending: true })
        .order('id', { ascending: true })
        .range(offset ?? 0, (offset ?? 0) + CLIENTS_LIMIT - 1)

      if (search) {
        // likeAnyFilter delimita o termo entre aspas: `.or()` recebe uma expressão
        // de filtro bruta do PostgREST, então uma busca sem aspas com vírgula
        // ou ponto poderia virar filtros adicionais escolhidos pelo agente.
        query = query.or(likeAnyFilter(['name', 'email'], search))
      }

      const { data, error } = await query

      if (error) {
        console.error('list_clients:', error)
        return errorResult('Não foi possível listar os clientes.')
      }

      const rows = data ?? []

      let financials: Map<string, ClientFinancials>
      try {
        financials = await computeClientFinancials(
          ctx,
          [resolvedId],
          rows.map((c) => c.id)
        )
      } catch {
        return errorResult('Não foi possível calcular os totais do cliente.')
      }

      const clients = rows.map((c) => {
        const f = financials.get(`${c.id}:${c.currency}`)
        return {
          id: c.id,
          name: c.name,
          email: c.email,
          currency: c.currency,
          outstanding_balance: f?.outstanding_balance ?? 0,
          total_invoiced: f?.total_invoiced ?? 0,
          app_url: `${appUrl()}/clients/${c.id}`,
        }
      })

      const truncated = rows.length === CLIENTS_LIMIT
      const result = {
        offset: offset ?? 0,
        next_offset: (data ?? []).length === CLIENTS_LIMIT ? (offset ?? 0) + CLIENTS_LIMIT : null,
        summary: `${clients.length} cliente${clients.length === 1 ? '' : 's'} encontrado${clients.length === 1 ? '' : 's'}.${truncated ? truncationNote(CLIENTS_LIMIT) : ''}`,
        clients,
        ...(truncated ? { truncated: true } : {}),
      }

      return jsonResult(result)
    }
  )

  server.registerTool(
    'get_client',
    {
      title: 'Consultar cliente',
      description:
        'Busca os dados completos de um cliente, incluindo suas cinco faturas mais recentes. O cliente precisa pertencer a uma das empresas de quem chamou.',
      inputSchema: z.object({
        client_id: z.string().uuid().describe('ID do cliente a consultar.'),
      }),
    },
    async ({ client_id }) => {
      let client
      try {
        client = await ctx.db.assertClientAccess(client_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível acessar o cliente.')
      }

      const { data: invoices, error } = await ctx.db.svc
        .from('invoices')
        .select('id, invoice_number, status, total')
        .eq('client_id', client_id)
        .eq('business_id', client.business_id)
        .order('issue_date', { ascending: false })
        .limit(5)

      if (error) {
        console.error('get_client:', error)
        return errorResult('Não foi possível carregar as faturas recentes.')
      }

      let financials: ClientFinancials
      try {
        const map = await computeClientFinancials(ctx, [client.business_id], [client.id])
        financials = map.get(`${client.id}:${client.currency}`) ?? { ...ZERO_FINANCIALS }
      } catch {
        return errorResult('Não foi possível calcular os totais do cliente.')
      }

      const result = {
        summary: `${client.name}: saldo em aberto de ${financials.outstanding_balance} ${client.currency}, total faturado de ${financials.total_invoiced} ${client.currency}.`,
        client: {
          id: client.id,
          business_id: client.business_id,
          name: client.name,
          email: client.email,
          phone: client.phone,
          address_line1: client.address_line1,
          address_line2: client.address_line2,
          city: client.city,
          state: client.state,
          postal_code: client.postal_code,
          country: client.country,
          currency: client.currency,
          notes: client.notes,
          outstanding_balance: financials.outstanding_balance,
          total_invoiced: financials.total_invoiced,
          total_paid: financials.total_paid,
          is_active: client.is_active,
          app_url: `${appUrl()}/clients/${client.id}`,
        },
        recent_invoices: (invoices ?? []).map((inv) => ({
          id: inv.id,
          invoice_number: inv.invoice_number,
          status: inv.status,
          total: inv.total,
        })),
      }

      return jsonResult(result)
    }
  )

  server.registerTool(
    'create_client',
    {
      title: 'Criar cliente',
      description:
        'Cria um cliente em uma das empresas de quem chamou. Se já existir nessa empresa um cliente com o mesmo nome, retorna uma mensagem explicativa. Nesse caso, use update_client.',
      inputSchema: z.object({
        business_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'ID da empresa à qual o cliente será associado. Opcional quando a chave de API está limitada a exatamente uma empresa; obrigatório quando está limitada a várias.'
          ),
        ...clientMutableFields,
      }),
    },
    async ({ business_id, ...fields }) => {
      let resolvedId: string
      try {
        resolvedId = ctx.db.resolveBusinessId(business_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível identificar a empresa.')
      }

      const { data: existing, error: existingError } = await ctx.db.svc
        .from('clients')
        .select('id')
        .eq('business_id', resolvedId)
        .ilike('name', escapeLike(fields.name))
        .maybeSingle()

      if (existingError) {
        console.error('create_client (duplicate check):', existingError)
        return errorResult('Não foi possível verificar se o cliente já existe.')
      }

      if (existing) {
        return errorResult(
          `Já existe um cliente chamado "${fields.name}" nesta empresa (id ${existing.id}). Use update_client com client_id "${existing.id}" em vez de criar um registro duplicado.`
        )
      }

      const { data: created, error } = await ctx.db.svc
        .from('clients')
        .insert({
          business_id: resolvedId,
          ...fields,
          created_via: 'agent',
          created_by_key_id: ctx.keyId,
        })
        .select('*')
        .single()

      if (error || !created) {
        console.error('create_client:', error)
        return errorResult('Não foi possível criar o cliente.')
      }

      const result = {
        summary: `Cliente "${created.name}" criado.`,
        client: {
          id: created.id,
          business_id: created.business_id,
          name: created.name,
          email: created.email,
          phone: created.phone,
          address_line1: created.address_line1,
          address_line2: created.address_line2,
          city: created.city,
          state: created.state,
          postal_code: created.postal_code,
          country: created.country,
          currency: created.currency,
          notes: created.notes,
          app_url: `${appUrl()}/clients/${created.id}`,
        },
      }

      return jsonResult(result)
    }
  )

  server.registerTool(
    'update_client',
    {
      title: 'Atualizar cliente',
      description:
        'Atualiza campos de um cliente existente. Apenas os campos informados são alterados; os omitidos permanecem como estão. O cliente precisa pertencer a uma das empresas de quem chamou.',
      inputSchema: z.object({
        client_id: z.string().uuid().describe('ID do cliente a atualizar.'),
        name: z.string().min(1).max(200).optional().describe('Nome do cliente (pessoa ou empresa).'),
        email: z.string().email().max(320).optional().describe('Endereço de e-mail do cliente.'),
        phone: z.string().max(50).optional().describe('Número de telefone do cliente.'),
        address_line1: z.string().max(200).optional().describe('Endereço, linha 1.'),
        address_line2: z.string().max(200).optional().describe('Endereço, linha 2 (sala, unidade etc.).'),
        city: z.string().max(100).optional().describe('Cidade.'),
        state: z.string().max(100).optional().describe('Estado ou província.'),
        postal_code: z.string().max(20).optional().describe('Código postal.'),
        country: z.string().max(100).optional().describe('País.'),
        currency: z.string().max(10).optional().describe('Código de moeda ISO deste cliente, por exemplo "USD".'),
        notes: z.string().max(2000).optional().describe('Observações internas livres sobre este cliente.'),
      }),
    },
    async ({ client_id, ...fields }) => {
      if (Object.keys(fields).length === 0) {
        return errorResult(
          'Nenhum campo para atualizar. Informe pelo menos um entre name, email, phone, address_line1, address_line2, city, state, postal_code, country, currency ou notes.'
        )
      }

      let existing
      try {
        existing = await ctx.db.assertClientAccess(client_id)
      } catch (err) {
        return errorResult(err instanceof ScopeError ? err.message : 'Não foi possível acessar o cliente.')
      }

      if (fields.name && fields.name.toLowerCase() !== existing.name.toLowerCase()) {
        const { data: dupe, error: dupeError } = await ctx.db.svc
          .from('clients')
          .select('id')
          .eq('business_id', existing.business_id)
          .ilike('name', escapeLike(fields.name))
          .neq('id', client_id)
          .maybeSingle()

        if (dupeError) {
          console.error('update_client (duplicate check):', dupeError)
          return errorResult('Não foi possível verificar se o cliente já existe.')
        }

        if (dupe) {
          return errorResult(
            `Já existe um cliente chamado "${fields.name}" nesta empresa (id ${dupe.id}). Escolha outro nome ou atualize esse cliente.`
          )
        }
      }

      const { data: updated, error } = await ctx.db.svc
        .from('clients')
        .update(fields)
        .eq('id', client_id)
        .select('*')
        .single()

      if (error || !updated) {
        console.error('update_client:', error)
        return errorResult('Não foi possível atualizar o cliente.')
      }

      const result = {
        summary: `Cliente "${updated.name}" atualizado.`,
        client: {
          id: updated.id,
          business_id: updated.business_id,
          name: updated.name,
          email: updated.email,
          phone: updated.phone,
          address_line1: updated.address_line1,
          address_line2: updated.address_line2,
          city: updated.city,
          state: updated.state,
          postal_code: updated.postal_code,
          country: updated.country,
          currency: updated.currency,
          notes: updated.notes,
          app_url: `${appUrl()}/clients/${updated.id}`,
        },
      }

      return jsonResult(result)
    }
  )
}
