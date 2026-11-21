import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { RATE_LIMITS, clientIpFrom, consumeRateLimits, ipKey, rateLimitKey } from '@/lib/rate-limit'
import { buildInvoicePdfData, renderInvoicePdf } from '@/lib/pdf/invoice-pdf'
import { stripePaymentsConfigured } from '@/lib/stripe/config'

export const runtime = 'nodejs'

// Download público identificado pelo public_id imprevisível, por meio da RPC SECURITY DEFINER
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ publicId: string }> }
) {
  const { publicId } = await params

  // Sem autenticação e custoso: cada requisição gera um PDF. Limitado por
  // documento e por IP no armazenamento persistente, para que
  // nem um link nem uma origem sobrecarreguem a CPU. A chave por IP
  // ignora o primeiro valor falsificável de x-forwarded-for. Em caso de falha, bloqueia.
  const limited = await consumeRateLimits([
    { bucket: rateLimitKey('pdf:invoice', publicId), policy: RATE_LIMITS.publicDocument },
    { bucket: ipKey('pdf:invoice:ip', clientIpFrom(req.headers)), policy: RATE_LIMITS.publicDocumentIp },
  ])
  if (!limited.allowed) {
    return NextResponse.json(
      { error: 'Muitas solicitações. Aguarde um momento e tente novamente.' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } }
    )
  }

  const supabase = await createClient()

  const { data, error } = await supabase.rpc('get_public_invoice', {
    p_public_id: publicId,
  })

  const payload = data as { invoice: Record<string, unknown>; line_items: Record<string, unknown>[] } | null
  if (error || !payload?.invoice) {
    return NextResponse.json({ error: 'Fatura não encontrada.' }, { status: 404 })
  }

  const invoice = payload.invoice
  const business = invoice.business_snapshot as Record<string, unknown> | null
  const client = invoice.client_snapshot as Record<string, unknown> | null

  const pdfData = buildInvoicePdfData(
    invoice,
    payload.line_items,
    business,
    client,
    stripePaymentsConfigured()
  )
  const pdf = await renderInvoicePdf(pdfData, business?.logo_url as string | undefined)

  // Para evitar injeção de cabeçalho, remova do Content-Disposition qualquer caractere que não pertença ao conjunto seguro de
  // nomes de arquivo (incluindo CR/LF).
  const safeName = String(invoice.invoice_number).replace(/[^A-Za-z0-9._-]/g, '_') || 'invoice'

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeName}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  })
}
