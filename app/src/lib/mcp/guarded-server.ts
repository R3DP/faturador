import type { McpServer } from '@modelcontextprotocol/server'
import type { McpCtx } from './context'
import { canUseTool } from './permissions'
import { errorResult } from './shared'
import { authErrorResult, withStructuredContent, withToolMeta } from './openai-apps'

/** A superfície registrada e a barreira de execução usam a mesma lista explícita de permissões. */
export function guardedServer(server: McpServer, ctx: McpCtx): McpServer {
  return new Proxy(server, {
    get(target, property) {
      if (property !== 'registerTool') {
        const value = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      }
      return (
        name: string,
        config: unknown,
        callback: (...args: unknown[]) => Promise<{ isError?: boolean }>
      ) => {
        if (!canUseTool(name, ctx.permissions ?? [])) return
        const wrapped = async (...args: unknown[]) => {
          // Verifica novamente revogação e expiração durante a execução, inclusive após uma negociação lenta.
          const { data: key, error: keyError } = await ctx.db.svc
            .from('api_keys')
            .select('revoked_at,expires_at,permissions')
            .eq('id', ctx.keyId)
            .single()
          // Os hosts ChatGPT e Codex leem o desafio www_authenticate nos erros da ferramenta
          // para oferecer uma nova autenticação em vez de deixar a pessoa sem saída.
          if (
            keyError ||
            !key ||
            key.revoked_at ||
            (key.expires_at && Date.parse(key.expires_at) <= Date.now())
          )
            return authErrorResult(
              'Sua conexão com o Faturador expirou ou foi revogada. Autentique-se no Faturador novamente.',
              'invalid_token'
            )
          if (!canUseTool(name, key.permissions))
            return authErrorResult(
              'Esta conexão com o Faturador não tem permissão para usar esta ferramenta. Reconecte o Faturador e conceda a permissão.',
              'insufficient_scope'
            )
          const { data: call, error } = await ctx.db.svc
            .from('agent_tool_calls')
            .insert({ key_id: ctx.keyId, user_id: ctx.userId, tool_name: name })
            .select('id')
            .single()
          if (error || !call)
            return errorResult(
              'Não foi possível registrar a entrada de auditoria. Nenhuma operação da ferramenta foi iniciada.'
            )
          let result: { isError?: boolean }
          try {
            result = withStructuredContent(name, await callback(...args))
          } catch {
            result = errorResult(
              'A operação da ferramenta falhou. Confira o aplicativo antes de tentar novamente; reutilize o ID original da requisição quando houver suporte.'
            )
          }
          const { error: finishError } = await ctx.db.svc
            .from('agent_tool_calls')
            .update({
              status: result.isError ? 'failed' : 'succeeded',
              finished_at: new Date().toISOString(),
            })
            .eq('id', call.id)
          // Um registro de auditoria iniciado é mantido intencionalmente após uma falha ou indisponibilidade do banco de dados.
          if (finishError)
            console.error('Não foi possível concluir a entrada de auditoria do agente', call.id)
          return result
        }
        return Reflect.apply(target.registerTool, target, [
          name,
          // Adiciona os escopos de autenticação a todas as ferramentas e o cartão às que o utilizam.
          withToolMeta(name, config),
          wrapped,
        ])
      }
    },
  })
}
