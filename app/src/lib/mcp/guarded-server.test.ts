import { describe, expect, it, vi } from 'vitest'

/**
 * Wrapper da ferramenta MCP: depois de validar a chave e registrar a auditoria,
 * executa ferramentas de leitura e gravação.
 */

vi.mock('@/lib/deployment', () => ({
  appOrigin: () => 'https://invoices.example.org',
  mcpUrl: () => 'https://invoices.example.org/api/mcp',
}))

import { guardedServer } from './guarded-server'
import type { McpCtx } from './context'

const KEY = { revoked_at: null, expires_at: null, permissions: ['read', 'write'] }

/** As duas tabelas acessadas pelo wrapper, na ordem em que são usadas. */
function fakeDb({ auditFails = false } = {}) {
  return {
    svc: {
      from(table: string) {
        if (table === 'api_keys') {
          return {
            select: () => ({
              eq: () => ({ single: async () => ({ data: KEY, error: null }) }),
            }),
          }
        }
        // agent_tool_calls
        return {
          insert: () => ({
            select: () => ({
              single: async () =>
                auditFails
                  ? { data: null, error: { message: 'insert failed' } }
                  : { data: { id: 'call-1' }, error: null },
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      },
    },
  }
}

function setup({ auditFails = false, onCall = () => {} } = {}) {
  const registered = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  const server = {
    registerTool(
      name: string,
      _config: unknown,
      callback: (...args: unknown[]) => Promise<unknown>,
    ) {
      registered.set(name, callback)
    },
  }
  const ctx = {
    userId: 'user-1',
    keyId: 'key-1',
    businessIds: ['b1'],
    permissions: ['read', 'write'],
    db: fakeDb({ auditFails }),
  } as unknown as McpCtx

  const guarded = guardedServer(server as never, ctx)
  guarded.registerTool(
    'list_invoices',
    {},
    async () => {
      onCall()
      return { content: [{ type: 'text', text: 'read ok' }] }
    },
  )
  guarded.registerTool(
    'create_invoice',
    {},
    async () => ({ content: [{ type: 'text', text: 'write ok' }] }),
  )
  return registered
}

describe('guardedServer', () => {
  it('executa ferramentas de leitura', async () => {
    const result = (await setup().get('list_invoices')!({})) as {
      isError?: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toBe('read ok')
  })

  it('executa ferramentas de gravação', async () => {
    const result = (await setup().get('create_invoice')!({ business_id: 'b1' })) as {
      content: { text: string }[]
    }

    expect(result.content[0].text).toBe('write ok')
  })

  it('impede a execução da ferramenta quando não é possível registrar a auditoria', async () => {
    const onCall = vi.fn()
    const result = (await setup({ auditFails: true, onCall }).get('list_invoices')!({})) as {
      isError?: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Não foi possível registrar a entrada de auditoria')
    expect(onCall).not.toHaveBeenCalled()
  })
})
