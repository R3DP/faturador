import { authorizationServerMetadata, metadataResponse } from '@/lib/oauth/metadata'

/**
 * Metadados do servidor de autorização da RFC 8414, servidos na origem do aplicativo porque ela
 * é a emissora: o consentimento exige uma sessão autenticada, e o cookie de sessão
 * fica aqui, não no host MCP.
 */
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return metadataResponse(authorizationServerMetadata())
}

export async function OPTIONS(): Promise<Response> {
  return metadataResponse(authorizationServerMetadata())
}
