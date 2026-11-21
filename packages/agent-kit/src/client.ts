import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

/** Conecte-se usando uma chave de API armazenada em uma variável de ambiente. Nunca a envie ao navegador. */
export async function connectBillr(options: {
  apiKey: string
  url: string
  name?: string
}) {
  if (!options.url)
    throw new Error('Informe a URL MCP da sua instalação do Faturador')
  if (!options.apiKey) throw new Error('É necessária uma chave de API do Faturador')
  const url = new URL(options.url)
  if (
    url.protocol !== 'https:' &&
    !(
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
  )
    throw new Error('As conexões com o Faturador exigem HTTPS fora do localhost')
  if (url.username || url.password)
    throw new Error('Não inclua credenciais na URL do endpoint')
  const client = new Client({
    name: options.name ?? 'billr-agent-kit',
    version: '0.1.0',
  })
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${options.apiKey}` } },
  })
  try {
    await client.connect(transport)
    return client
  } catch (error) {
    await transport.close().catch(() => {})
    throw error
  }
}
