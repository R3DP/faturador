import { matchesResourceSuffix, metadataResponse, protectedResourceMetadata } from '@/lib/oauth/metadata'

/**
 * Formato de sufixo de caminho da RFC 9728: o caminho do recurso é anexado ao caminho well-known;
 * assim, um servidor MCP em https://example.org/api/mcp publica seus
 * metadados em https://example.org/.well-known/oauth-protected-resource/api/mcp.
 *
 * Um sufixo que indica outro caminho consulta um recurso que este servidor não protege;
 * por isso, recebe 404 em vez do documento deste servidor.
 */
export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ suffix?: string[] }> }
): Promise<Response> {
  const { suffix } = await ctx.params
  if (!matchesResourceSuffix(suffix)) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  }
  return metadataResponse(protectedResourceMetadata())
}
