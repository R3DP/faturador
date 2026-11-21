import { protectedResourceMetadataUrl } from '@/lib/oauth/metadata'
import { toolPermission } from './permissions'

/**
 * O que os hosts de plugins ChatGPT e Codex leem do servidor MCP do Faturador, mantido em
 * um só lugar para que os arquivos das ferramentas não precisem conter metadados específicos de cada host.
 *
 * Fontes consultadas em 2026-10-01:
 *   https://developers.openai.com/plugins/build/auth.md       securitySchemes,
 *     _meta["mcp/www_authenticate"], get_profile
 *   https://developers.openai.com/plugins/build/chatgpt-ui.md  recursos ui://,
 *     _meta.ui.resourceUri e seu alias "openai/outputTemplate",
 *     structuredContent
 *
 * Tudo isso é aditivo. Um cliente que ignora `_meta` (Claude, Cursor e o
 * Codex CLI) continua vendo exatamente as mesmas ferramentas de antes.
 */

/** Ferramentas que exibem um cartão do Faturador e o recurso ui:// usado por cada uma. */
export const WIDGET_TOOLS = {
  get_invoice: 'ui://billr/invoice-v1.html',
  get_estimate: 'ui://billr/estimate-v1.html',
  revenue_summary: 'ui://billr/revenue-v1.html',
  list_ready_to_bill: 'ui://billr/ready-to-bill-v1.html',
} as const satisfies Record<string, string>

export type WidgetTool = keyof typeof WIDGET_TOOLS

const STATUS_TEXT: Record<WidgetTool, { invoking: string; invoked: string }> = {
  get_invoice: { invoking: 'Abrindo fatura', invoked: 'Fatura pronta' },
  get_estimate: { invoking: 'Abrindo estimativa', invoked: 'Estimativa pronta' },
  revenue_summary: { invoking: 'Calculando faturamento', invoked: 'Resumo do faturamento pronto' },
  list_ready_to_bill: { invoking: 'Buscando trabalho para faturar', invoked: 'Lista de itens prontos para faturar' },
}

function isWidgetTool(name: string): name is WidgetTool {
  return Object.prototype.hasOwnProperty.call(WIDGET_TOOLS, name)
}

/**
 * Escopos OAuth necessários para cada ferramenta. Os escopos do Faturador são os nomes de suas permissões (read,
 * write, send, delete, payments); por isso, o mapeamento é a tabela de permissões.
 */
export function securitySchemesFor(name: string) {
  const permission = toolPermission(name)
  return permission ? [{ type: 'oauth2', scopes: [permission] }] : []
}

/** `_meta` adicionado à descrição de uma ferramenta em tools/list. */
export function toolMetaFor(name: string): Record<string, unknown> {
  const meta: Record<string, unknown> = { securitySchemes: securitySchemesFor(name) }
  if (isWidgetTool(name)) {
    const uri = WIDGET_TOOLS[name]
    meta.ui = { resourceUri: uri }
    meta['openai/outputTemplate'] = uri
    meta['openai/toolInvocation/invoking'] = STATUS_TEXT[name].invoking
    meta['openai/toolInvocation/invoked'] = STATUS_TEXT[name].invoked
  }
  return meta
}

/** Mescla os metadados do host à configuração de registerTool sem remover os metadados existentes. */
export function withToolMeta<T>(name: string, config: T): T {
  if (!config || typeof config !== 'object') return config
  const existing = (config as { _meta?: Record<string, unknown> })._meta ?? {}
  return { ...config, _meta: { ...toolMetaFor(name), ...existing } }
}

interface ToolResultLike {
  content?: Array<{ type: string; text?: string }>
  structuredContent?: unknown
  isError?: boolean
}

/**
 * As ferramentas do Faturador retornam dados em um único bloco de texto JSON (jsonResult). Um host de interface
 * ele renderiza `structuredContent`; por isso, para as ferramentas com cartão, o mesmo
 * objeto também é disponibilizado nesse campo. O bloco de texto permanece para clientes sem interface.
 */
export function withStructuredContent<T>(name: string, result: T): T {
  if (!isWidgetTool(name)) return result
  const r = result as ToolResultLike
  if (!r || r.isError || r.structuredContent !== undefined) return result
  const text = r.content?.find((c) => c.type === 'text')?.text
  if (!text) return result
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...result, structuredContent: parsed }
    }
  } catch {
    // Não é JSON: mantém o resultado inalterado.
  }
  return result
}

/**
 * Um erro da ferramenta que faz o ChatGPT exibir o botão "Entrar no Faturador" em vez de
 * deixar a pessoa sem saída. O desafio precisa incluir `error` e `error_description`.
 */
export function authErrorResult(text: string, error: 'invalid_token' | 'insufficient_scope') {
  const resourceMetadata = protectedResourceMetadataUrl()
  const description = text.replace(/["\\]/g, '')
  return {
    content: [{ type: 'text' as const, text }],
    isError: true as const,
    _meta: {
      'mcp/www_authenticate': [
        `Bearer resource_metadata="${resourceMetadata}", error="${error}", error_description="${description}"`,
      ],
    },
  }
}
