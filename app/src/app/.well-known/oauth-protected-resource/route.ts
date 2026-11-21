import { metadataResponse, protectedResourceMetadata } from '@/lib/oauth/metadata'

/**
 * Formato raiz do documento de recurso protegido, para clientes que conhecem apenas
 * esta forma. O formato com sufixo de caminho (RFC 9728) fica em ./[...suffix]/route.ts.
 */
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return metadataResponse(protectedResourceMetadata())
}

export async function OPTIONS(): Promise<Response> {
  return metadataResponse(protectedResourceMetadata())
}
