export const dynamic = 'force-dynamic'
/** Verifica apenas se o serviço está ativo. Não revela credenciais nem afirma que o banco está pronto. */
export async function GET() {
  return Response.json(
    { status: 'ok' },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
