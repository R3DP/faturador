/**
 * Fonte única de verdade para as ferramentas MCP apresentadas às pessoas usuárias.
 *
 * Qualquer página ou documento que apresente a lista ou a quantidade de ferramentas deve consultar este arquivo
 * em vez de manter uma lista manual própria, pois essas listas ficaram
 * desatualizadas e chegaram a anunciar uma ferramenta inexistente.
 *
 * Mantenha este arquivo sincronizado com as chamadas reais de `registerTool` em
 * src/lib/mcp/tools/*. O teste tool-catalog.test.ts verifica se ambos estão de acordo.
 */

export interface ToolGroup {
  name: string
  /** Uma linha que explica para que serve este grupo de ferramentas. */
  blurb: string
  tools: string[]
}

export const TOOL_GROUPS: ToolGroup[] = [
  { name: 'Cobrança por tarefas', blurb: 'Acompanhe o trabalho ativo e o uso informado conforme preços aprovados por uma pessoa.', tools: ['list_billing_policies','create_task','start_task','heartbeat_task','pause_task','complete_task','record_task_usage','get_task_billing_preview'] },
  {
    name: 'Clientes',
    blurb: 'Consulte e mantenha a lista de clientes.',
    tools: ['list_clients', 'get_client', 'create_client', 'update_client'],
  },
  {
    name: 'Faturas',
    blurb: 'Crie, edite e envie faturas e registre seus pagamentos.',
    tools: [
      'list_invoices',
      'get_invoice',
      'create_invoice',
      'update_draft_invoice',
      'send_invoice',
      'record_payment',
    ],
  },
  {
    name: 'Orçamentos',
    blurb: 'Prepare orçamentos e converta os aceitos em faturas.',
    tools: [
      'list_estimates',
      'get_estimate',
      'create_estimate',
      'update_draft_estimate',
      'send_estimate',
      'convert_estimate_to_invoice',
    ],
  },
  {
    name: 'Contratos',
    blurb: 'Fature os valores acordados conforme um cronograma, sem envios automáticos.',
    tools: [
      'list_engagements',
      'get_engagement',
      'list_ready_to_bill',
      'create_engagement',
      'update_engagement',
      'mark_milestone_complete',
      'complete_engagement',
      'waive_engagement_entry',
      'convert_estimate_to_engagement',
    ],
  },
  {
    name: 'Itens salvos',
    blurb: 'Catálogo de preços que pode ser usado pelo nome em faturas e estimativas.',
    tools: ['list_items', 'create_item', 'update_item'],
  },
  {
    name: 'Horas',
    blurb: 'Registre e corrija horas trabalhadas antes de faturá-las.',
    tools: ['log_time', 'list_time_entries', 'update_time_entry', 'delete_time_entry'],
  },
  {
    name: 'Despesas',
    blurb: 'Registre e corrija despesas, faturáveis ou não.',
    tools: ['log_expense', 'list_expenses', 'update_expense', 'delete_expense'],
  },
  {
    name: 'Pagamentos',
    blurb: 'Confira o que foi pago e o que ainda está pendente; corrija ou anule pagamentos registrados incorretamente.',
    tools: ['get_payment_status', 'update_payment', 'void_payment'],
  },
  {
    name: 'Empresa e links',
    blurb: 'Configurações da empresa, resumos de faturamento e links compartilháveis.',
    tools: [
      'get_profile',
      'get_business',
      'list_businesses',
      'revenue_summary',
      'get_invoice_link',
      'list_unbilled',
    ],
  },
]

export const TOOL_NAMES: string[] = TOOL_GROUPS.flatMap((group) => group.tools)

export const TOOL_COUNT = TOOL_NAMES.length
