import { describe, expect, it, vi } from 'vitest'

/**
 * A rota MCP como é vista por um host de plugins do ChatGPT ou Codex: tools/list inclui
 * os metadados do cartão e de autenticação, e os cartões ui:// podem ser listados e lidos.
 * O teste usa o manipulador real do SDK com um contexto de requisição simulado; assim, uma alteração
 * na serialização de `_meta` ou dos recursos pelo SDK aparece aqui.
 */

vi.mock('@/lib/deployment', () => ({
  appOrigin: () => 'https://invoices.example.org',
  mcpUrl: () => 'https://invoices.example.org/api/mcp',
}))

vi.mock('@/lib/mcp/context', () => ({
  getMcpContext: async () => ({
    keyId: 'k1',
    userId: 'u1',
    businessIds: ['b1'],
    permissions: ['read'],
    db: { scope: { userId: 'u1', businessIds: ['b1'] }, svc: {} },
  }),
}))

import { POST } from './route'

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const response = await POST(
    new Request('https://invoices.example.org/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  )
  const text = await response.text()
  // O HTTP com fluxo pode responder em um quadro SSE; extraia dele o JSON.
  const json = text.startsWith('{') ? text : text.split('\n').find((l) => l.startsWith('data:'))!.slice(5)
  return JSON.parse(json) as { result?: Record<string, unknown>; error?: unknown }
}

describe('rota MCP, visualização do host de plug-ins', () => {
  it('lista os metadados do cartão e da autenticação nas ferramentas', async () => {
    const { result, error } = await rpc('tools/list')
    expect(error).toBeUndefined()
    const tools = result!.tools as { name: string; _meta?: Record<string, unknown> }[]
    const invoice = tools.find((t) => t.name === 'get_invoice')!
    expect(invoice._meta).toMatchObject({
      ui: { resourceUri: 'ui://billr/invoice-v1.html' },
      'openai/outputTemplate': 'ui://billr/invoice-v1.html',
      securitySchemes: [{ type: 'oauth2', scopes: ['read'] }],
    })
    const profile = tools.find((t) => t.name === 'get_profile')!
    expect(profile._meta).toMatchObject({ 'openai/profile': true })
    // Uma conexão somente leitura continua sem acesso às ferramentas de escrita.
    expect(tools.some((t) => t.name === 'create_invoice')).toBe(false)
  })

  it('lista e disponibiliza os cartões como recursos de MCP Apps', async () => {
    const listed = await rpc('resources/list')
    const uris = (listed.result!.resources as { uri: string }[]).map((r) => r.uri)
    expect(uris).toContain('ui://billr/invoice-v1.html')

    const read = await rpc('resources/read', { uri: 'ui://billr/ready-to-bill-v1.html' })
    const [content] = read.result!.contents as { mimeType: string; text: string; _meta: Record<string, unknown> }[]
    expect(content.mimeType).toBe('text/html;profile=mcp-app')
    expect(content.text).toContain('data-view="ready"')
    expect(content._meta).toMatchObject({ ui: { csp: { connectDomains: [] } } })
  })
})
