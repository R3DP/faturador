import 'server-only'
import { resolveApiKey } from '@/lib/api-keys/resolver'
import { protectedResourceMetadataUrl } from '@/lib/oauth/metadata'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { createScopedDb, type ScopedDb } from './scoped-db'

// Quem chama MCP tem 120 requisições / 60s por chave. Este limite é aplicado
// no próprio limite por chave do resolver, em vez de adicionar outro limite
// sobre ele; assim, cada requisição MCP consome exatamente uma ocorrência do limite. O contador é
// persistente e compartilhado entre instâncias, e em caso de falha bloqueia a requisição.
const MCP_RATE_LIMIT = RATE_LIMITS.mcp

export interface McpCtx {
  userId: string
  keyId: string
  businessIds: string[]
  permissions?: string[]
  db: ScopedDb
}

function jsonError(status: number, body: Record<string, unknown>, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/**
 * Autentica e limita o escopo de uma requisição MCP recebida.
 *
 * Em caso de sucesso, retorna o contexto da requisição ({ userId, businessIds, db }); caso contrário, uma
 * Response para devolver sem alterações (401 chave inválida, 429 limite excedido) em caso de
 * falha. Todo handler de ferramenta MCP deve ser criado a partir do ctx retornado;
 * nunca acesse diretamente um cliente de serviço sem escopo.
 */
export async function getMcpContext(req: Request): Promise<McpCtx | Response> {
  const auth = req.headers.get('authorization') ?? ''
  const secret = auth.startsWith('Bearer ') ? auth.slice(7) : ''

  const resolved = await resolveApiKey(secret, { rateLimit: MCP_RATE_LIMIT })
  if ('error' in resolved) {
    if (resolved.error === 'rate_limited') {
      return jsonError(429, { error: 'Limite de requisições excedido' }, { 'Retry-After': '60' })
    }
    // WWW-Authenticate direciona os clientes MCP ao endpoint de metadados do recurso
    // (RFC 9728 / especificação de autenticação MCP) para que descubram como se autenticar
    // em vez de receberem apenas um 401 sem explicação. É este cabeçalho que transforma
    // "colar a URL do MCP falha" em "colar a URL inicia o acesso":
    // o cliente lê o documento de metadados, encontra esta instalação como
    // servidor de autorização, registra-se e inicia o fluxo de consentimento.
    return jsonError(
      401,
      {
        error: 'Token de acesso ausente ou inválido',
        error_description:
          'Envie uma chave de API Faturador ou um token de acesso OAuth no formato "Authorization: Bearer ...", ou conecte-se via OAuth usando os metadados do recurso no cabeçalho WWW-Authenticate.',
      },
      {
        'WWW-Authenticate': `Bearer realm="billr", resource_metadata="${protectedResourceMetadataUrl()}"`,
      }
    )
  }

  const scope = { userId: resolved.userId, businessIds: resolved.businessIds }
  return {
    userId: resolved.userId,
    keyId: resolved.keyId,
    businessIds: resolved.businessIds,
    permissions: resolved.permissions,
    db: createScopedDb(scope),
  }
}
