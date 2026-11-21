import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import type { McpCtx } from '@/lib/mcp/context'
import { appUrl, errorResult, jsonResult } from '@/lib/mcp/shared'

const common = {
  business_id: z.uuid().optional(),
  request_id: z
    .uuid()
    .describe(
      'Identificador estável desta operação. Reutilize em novas tentativas com a mesma entrada.'
    ),
}
const task = { ...common, task_id: z.uuid() }

const taskTitles = {
  create_task: 'Criar tarefa',
  start_task: 'Iniciar tarefa',
  heartbeat_task: 'Registrar atividade da tarefa',
  pause_task: 'Pausar tarefa',
  complete_task: 'Concluir tarefa',
  record_task_usage: 'Registrar uso da tarefa',
} as const

export function registerTaskTools(server: McpServer, ctx: McpCtx) {
  server.registerTool(
    'list_billing_policies',
    {
      title: 'Listar preços aprovados',
      description:
        'Consulta tarifas de tarefas, multiplicadores de uso, moedas e orçamentos aprovados por uma pessoa. Agentes não podem aprovar preços.',
      inputSchema: z.object({ business_id: z.uuid().optional() }),
    },
    async ({ business_id }) => {
      try {
        const id = ctx.db.resolveBusinessId(business_id)
        const { data, error } = await ctx.db.svc
          .from('billing_policies')
          .select('*')
          .eq('business_id', id)
          .order('created_at', { ascending: false })
          .limit(100)
        if (error) throw error
        return jsonResult({
          policies: data,
          limit: 100,
          review_url: `${appUrl()}/tasks`,
        })
      } catch (e) {
        return errorResult(
          e instanceof Error ? e.message : 'Não foi possível carregar os preços'
        )
      }
    }
  )
  const definitions = [
    {
      name: 'create_task',
      action: 'create',
      description:
        'Cria uma tarefa pausada usando uma política de preços aprovada por uma pessoa. Cada tarefa tem seu próprio orçamento. Em seguida, use start_task quando o trabalho ativo começar.',
      schema: z.object({
        ...common,
        policy_id: z.uuid(),
        title: z.string().trim().min(1).max(500),
      }),
    },
    {
      name: 'start_task',
      action: 'start',
      description:
        'Inicia ou retoma o trabalho ativo. Envie heartbeat_task a cada 30 a 60 segundos. Apenas os primeiros 120 segundos após um heartbeat são contabilizados; pause enquanto aguarda uma resposta do usuário.',
      schema: z.object(task),
    },
    {
      name: 'heartbeat_task',
      action: 'heartbeat',
      description:
        'Registra o tempo ativo decorrido usando os horários do servidor, limitado a 120 segundos desde o heartbeat anterior. Repita com o mesmo request_id para evitar contabilizar duas vezes.',
      schema: z.object(task),
    },
    {
      name: 'pause_task',
      action: 'pause',
      description:
        'Interrompe a cobrança de tempo enquanto estiver aguardando ou inativa. Registra até 120 segundos desde o último heartbeat.',
      schema: z.object(task),
    },
    {
      name: 'complete_task',
      action: 'complete',
      description:
        'Conclui uma tarefa após registrar todo o uso. Interrompe a contagem de tempo e congela o trabalho para revisão humana da cobrança. Esta ação não pode ser desfeita.',
      schema: z.object(task),
    },
    {
      name: 'record_task_usage',
      action: 'usage',
      description:
        'Registra um custo conhecido do provedor na moeda da política, com uma referência exclusiva de solicitação do provedor e uma fonte de evidência. Esse custo é informado, mas não verificado de forma independente pelo Faturador. Não invente preços nem envie estimativas. Registre antes de concluir a tarefa.',
      schema: z.object({
        ...task,
        provider: z.string().min(1).max(200),
        model: z.string().max(200).optional(),
        provider_request_id: z.string().min(1).max(200),
        cost: z.number().finite().min(0).max(99999999),
        currency: z.string().regex(/^[A-Z]{3}$/),
        input_tokens: z.number().int().nonnegative().optional(),
        output_tokens: z.number().int().nonnegative().optional(),
        source: z.string().min(1).max(1000),
      }),
    },
  ] as const
  for (const def of definitions) {
    server.registerTool(
      def.name,
      {
        title: taskTitles[def.name],
        description: def.description,
        inputSchema: def.schema,
      },
      async (input: z.infer<typeof def.schema>) => {
        try {
          const { business_id, request_id, ...payload } = input
          const business = ctx.db.resolveBusinessId(business_id)
          const { data, error } = await ctx.db.svc.rpc('task_operation', {
            p_business_id: business,
            p_request_id: request_id,
            p_action: def.action,
            p_input: payload,
            p_key_id: ctx.keyId,
          })
          if (error) return errorResult(error.message)
          return jsonResult({ result: data, review_url: `${appUrl()}/tasks` })
        } catch (e) {
          return errorResult(
            e instanceof Error ? e.message : 'Não foi possível registrar a operação da tarefa'
          )
        }
      }
    )
  }
  server.registerTool(
    'get_task_billing_preview',
    {
      title: 'Prévia de cobrança da tarefa',
      description:
        'Consulta os segundos de atividade registrados e o uso informado. O tempo não inclui intervalos em execução ainda não registrados. É necessário concluir a tarefa e obter aprovação humana antes de faturar. Os valores são arredondados por componente.',
      inputSchema: z.object({
        business_id: z.uuid().optional(),
        task_id: z.uuid(),
      }),
    },
    async ({ business_id, task_id }) => {
      try {
        const business = ctx.db.resolveBusinessId(business_id)
        const { data: t, error } = await ctx.db.svc
          .from('work_tasks')
          .select('*, pricing:billing_policies(*)')
          .eq('business_id', business)
          .eq('id', task_id)
          .single()
        if (error || !t) return errorResult('Tarefa não encontrada')
        const p = t.pricing
        const time =
          Math.round(((t.active_seconds * p.hourly_rate) / 3600) * 100) / 100
        const usage = Math.round(t.usage_cost * p.usage_multiplier * 100) / 100
        return jsonResult({
          task: t,
          time_amount: time,
          usage_amount: usage,
          total: Math.round((time + usage) * 100) / 100,
          currency: p.currency,
          requires_human_review: t.status !== 'invoiced',
          review_url: `${appUrl()}/tasks`,
        })
      } catch (e) {
        return errorResult(
          e instanceof Error ? e.message : 'Não foi possível carregar a tarefa'
        )
      }
    }
  )
}
