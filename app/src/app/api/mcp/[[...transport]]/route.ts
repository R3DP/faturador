import { guardedServer } from '@/lib/mcp/guarded-server'
import { metadataResponse, protectedResourceMetadata } from '@/lib/oauth/metadata'
import { createMcpHandler } from 'mcp-handler'
import { getMcpContext } from '@/lib/mcp/context'
import { serverInfo } from '@/lib/mcp/shared'
import { registerTaskTools } from '@/lib/mcp/tools/tasks'
import { registerClientTools } from '@/lib/mcp/tools/clients'
import { registerInvoiceReadTools } from '@/lib/mcp/tools/invoices-read'
import { registerInvoiceWriteTools } from '@/lib/mcp/tools/invoices-write'
import { registerInvoiceSendTools } from '@/lib/mcp/tools/invoices-send'
import { registerWorkTools } from '@/lib/mcp/tools/work'
import { registerInfoTools } from '@/lib/mcp/tools/info'
import { registerEstimateTools } from '@/lib/mcp/tools/estimates'
import { registerItemTools } from '@/lib/mcp/tools/items'
import { registerTimeTools } from '@/lib/mcp/tools/time'
import { registerExpenseTools } from '@/lib/mcp/tools/expenses'
import { registerPaymentTools } from '@/lib/mcp/tools/payments'
import { registerEngagementTools } from '@/lib/mcp/tools/engagements'
import { registerBillrWidgets } from '@/lib/mcp/widgets'

export const runtime = 'nodejs'

/**
 * Rota do servidor MCP. Sem estado: um novo McpServer é criado a cada requisição e
 * captura o contexto autenticado/com escopo resolvido para aquela requisição, para que
 * cada manipulador de ferramenta execute com { userId, businessIds, db } já limitado
 * à chave de API do chamador. Consulte src/lib/mcp/context.ts.
 *
 * O padrão de registro de ferramentas e o contrato "cada manipulador deve limitar o acesso via
 * ctx.db" estão documentados em src/lib/mcp/shared.ts (ao lado de
 * serverInfo), e não aqui, para acompanhar os auxiliares compartilhados que novos
 * arquivos de ferramentas importam.
 */
/**
 * O documento do recurso protegido precisa ser servido antes de o cliente ter um token,
 * para que uma consulta que acrescente o caminho well-known à URL do recurso (em vez de
 * usar o formato de sufixo de caminho da RFC 9728) seja atendida aqui, em vez de receber 401.
 */
function isProtectedResourceProbe(req: Request): boolean {
  const { pathname } = new URL(req.url)
  return pathname.replace(/\/+$/, '').endsWith('/.well-known/oauth-protected-resource')
}

async function handleRequest(req: Request): Promise<Response> {
  if (isProtectedResourceProbe(req)) return metadataResponse(protectedResourceMetadata())

  const ctx = await getMcpContext(req)
  if (ctx instanceof Response) return ctx

  const handler = createMcpHandler(
    (rawServer) => {
      const server = guardedServer(rawServer, ctx)
      registerTaskTools(server, ctx)
      registerClientTools(server, ctx)
      registerInvoiceReadTools(server, ctx)
      registerInvoiceWriteTools(server, ctx)
      registerInvoiceSendTools(server, ctx)
      registerWorkTools(server, ctx)
      registerInfoTools(server, ctx)
      registerEstimateTools(server, ctx)
      registerItemTools(server, ctx)
      registerTimeTools(server, ctx)
      registerExpenseTools(server, ctx)
      registerPaymentTools(server, ctx)
      registerEngagementTools(server, ctx)
      // Os cartões que algumas ferramentas exibem no ChatGPT e no Codex. HTML estático, sem dados.
      registerBillrWidgets(server)
    },
    // O servidor MCP do Faturador não mantém estado; recusar assinaturas de recursos
    // mantém o estado por requisição zerado.
    { serverInfo, maxSubscriptions: 0 }
  )

  return handler(req)
}

export { handleRequest as GET, handleRequest as POST }
