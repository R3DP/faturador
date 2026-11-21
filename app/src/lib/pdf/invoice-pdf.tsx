import React from 'react'
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  renderToBuffer,
} from '@react-pdf/renderer'
import { publicUrl } from '@/lib/mcp/shared'
import { todayISO } from '@/lib/dates'
import { isAllowedLogoUrl } from '@/lib/branding/logo-url'

// Um único PDF para tudo: botão de download, página pública e anexo de e-mail.

interface InvoicePdfParty {
  name: string
  email?: string | null
  phone?: string | null
  website?: string | null
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  state?: string | null
  postal_code?: string | null
  country?: string | null
}

interface InvoicePdfLineItem {
  description: string
  quantity: number
  rate: number
  amount: number
}

export interface InvoicePdfData {
  invoice_number: string
  status: string
  issue_date: string
  due_date: string
  currency: string
  po_number?: string | null
  subtotal: number
  discount_amount: number
  tax_rate: number
  tax_amount: number
  shipping_amount: number
  total: number
  amount_paid: number
  balance_due: number
  notes?: string | null
  terms?: string | null
  payment_instructions?: string | null
  footer?: string | null
  primary_color?: string | null
  business: InvoicePdfParty
  client: InvoicePdfParty
  line_items: InvoicePdfLineItem[]
  logo?: { data: Buffer; format: 'png' | 'jpg' } | null
  payments_enabled?: boolean
  public_url?: string | null
}

const INK = '#111827'
const MUTED = '#6B7280'
const FAINT = '#9CA3AF'
const HAIRLINE = '#E5E7EB'
const ROW_ALT = '#F9FAFB'
const GREEN = '#059669'
const RED = '#DC2626'

const fmtMoney = (amount: number, currency = 'USD') =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount)

const fmtQty = (q: number) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(q)

// Formata 'YYYY-MM-DD' sem deslocamento de fuso horário.
const fmtDate = (d: string) => {
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  const months = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.']
  return `${day} de ${months[m - 1]} de ${y}`
}

const addressLines = (p: InvoicePdfParty): string[] => {
  const cityLine = [p.city, p.state, p.postal_code].filter(Boolean).join(', ')
  return [p.address_line1, p.address_line2, cityLine, p.country === 'US' ? null : p.country]
    .filter((l): l is string => !!l && l.trim().length > 0)
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingHorizontal: 48,
    paddingBottom: 72,
    fontFamily: 'Helvetica',
    fontSize: 9.5,
    color: INK,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  bizName: { fontSize: 17, fontFamily: 'Helvetica-Bold', letterSpacing: 0.2 },
  invoiceLabel: { fontSize: 9, letterSpacing: 2.5, color: MUTED, textAlign: 'right' },
  invoiceNumber: { fontSize: 15, fontFamily: 'Helvetica-Bold', textAlign: 'right', marginTop: 3 },
  accentBar: { height: 3, borderRadius: 1.5, marginTop: 18, marginBottom: 26 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontSize: 7, letterSpacing: 1.2, color: FAINT, fontFamily: 'Helvetica-Bold', marginBottom: 5 },
  partyName: { fontFamily: 'Helvetica-Bold', fontSize: 10, marginBottom: 2 },
  partyLine: { color: MUTED, marginBottom: 1.5 },
  detailRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 3 },
  detailLabel: { color: MUTED, width: 78, textAlign: 'right', marginRight: 10 },
  detailValue: { fontFamily: 'Helvetica-Bold', width: 68, textAlign: 'right' },
  table: { marginTop: 28 },
  th: { fontSize: 7, letterSpacing: 1.2, color: MUTED, fontFamily: 'Helvetica-Bold' },
  theadRow: {
    flexDirection: 'row',
    borderBottomWidth: 1.2,
    borderBottomColor: INK,
    paddingBottom: 6,
  },
  tr: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 7,
    borderBottomWidth: 0.75,
    borderBottomColor: HAIRLINE,
  },
  colDesc: { flex: 6, paddingRight: 12 },
  colQty: { flex: 1.1, textAlign: 'right' },
  colRate: { flex: 1.9, textAlign: 'right' },
  colAmount: { flex: 2, textAlign: 'right' },
  totals: { marginTop: 14, flexDirection: 'row', justifyContent: 'flex-end' },
  totalsBox: { width: 230 },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3.5 },
  totalsLabel: { color: MUTED },
  grandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1.2,
    borderTopColor: INK,
    marginTop: 4,
    paddingTop: 7,
  },
  grandLabel: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  grandValue: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  balanceBand: {
    marginTop: 10,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  balanceText: { color: '#FFFFFF', fontFamily: 'Helvetica-Bold', fontSize: 10.5 },
  paidStamp: {
    position: 'absolute',
    left: 60,
    fontSize: 40,
    fontFamily: 'Helvetica-Bold',
    color: GREEN,
    opacity: 0.18,
    letterSpacing: 6,
    transform: 'rotate(-10deg)',
  },
  section: { marginTop: 22 },
  sectionBody: { color: MUTED, lineHeight: 1.5, marginTop: 4 },
  footer: {
    position: 'absolute',
    left: 48,
    right: 48,
    bottom: 30,
    borderTopWidth: 0.75,
    borderTopColor: HAIRLINE,
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7.5,
    color: FAINT,
  },
})

function statusChip(data: InvoicePdfData) {
  const overdue =
    data.status !== 'paid' &&
    data.status !== 'cancelled' &&
    data.due_date < todayISO()
  if (data.status === 'paid') {
    return { text: 'PAGO', color: GREEN }
  }
  if (overdue) {
    return { text: 'VENCIDA', color: RED }
  }
  return null
}

function InvoicePdfDocument({ data }: { data: InvoicePdfData }) {
  const accent = data.primary_color || '#4F46E5'
  const chip = statusChip(data)
  const biz = data.business
  const contactBits = [biz.email, biz.phone, biz.website].filter(Boolean).join('   •   ')

  return (
    <Document
      title={`Fatura ${data.invoice_number}`}
      author={biz.name}
      producer="Faturador"
      creator="Faturador"
    >
      <Page size="LETTER" style={styles.page}>
        {/* Cabeçalho */}
        <View style={styles.headerRow}>
          <View style={{ maxWidth: 300 }}>
            {data.logo && (
              <Image
                src={{ data: data.logo.data, format: data.logo.format }}
                style={{ height: 34, objectFit: 'contain', alignSelf: 'flex-start', marginBottom: 10 }}
              />
            )}
            <Text style={styles.bizName}>{biz.name}</Text>
          </View>
          <View>
            <Text style={styles.invoiceLabel}>FATURA</Text>
            <Text style={styles.invoiceNumber}>{data.invoice_number}</Text>
            {chip && (
              <Text
                style={{
                  textAlign: 'right',
                  marginTop: 5,
                  fontSize: 8,
                  letterSpacing: 1.5,
                  fontFamily: 'Helvetica-Bold',
                  color: chip.color,
                }}
              >
                {chip.text}
              </Text>
            )}
          </View>
        </View>

        <View style={[styles.accentBar, { backgroundColor: accent }]} />

        {/* De / Cobrança para / Detalhes */}
        <View style={styles.metaRow}>
          <View style={{ width: 160 }}>
            <Text style={styles.label}>DE</Text>
            <Text style={styles.partyName}>{biz.name}</Text>
            {addressLines(biz).map((l, i) => (
              <Text key={i} style={styles.partyLine}>{l}</Text>
            ))}
            {biz.email && <Text style={styles.partyLine}>{biz.email}</Text>}
            {biz.phone && <Text style={styles.partyLine}>{biz.phone}</Text>}
          </View>
          <View style={{ width: 160 }}>
            <Text style={styles.label}>COBRANÇA PARA</Text>
            <Text style={styles.partyName}>{data.client.name}</Text>
            {addressLines(data.client).map((l, i) => (
              <Text key={i} style={styles.partyLine}>{l}</Text>
            ))}
            {data.client.email && <Text style={styles.partyLine}>{data.client.email}</Text>}
          </View>
          <View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Data de emissão</Text>
              <Text style={styles.detailValue}>{fmtDate(data.issue_date)}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Vencimento</Text>
              <Text style={styles.detailValue}>{fmtDate(data.due_date)}</Text>
            </View>
            {data.po_number && (
              <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Nº do pedido</Text>
                <Text style={styles.detailValue}>{data.po_number}</Text>
              </View>
            )}
            <View style={[styles.detailRow, { marginTop: 8 }]}>
              <Text style={styles.detailLabel}>Valor devido</Text>
              <Text style={[styles.detailValue, { color: accent, fontSize: 11 }]}>
                {fmtMoney(data.balance_due, data.currency)}
              </Text>
            </View>
          </View>
        </View>

        {/* Itens */}
        <View style={styles.table}>
          <View style={styles.theadRow}>
            <Text style={[styles.th, styles.colDesc]}>DESCRIÇÃO</Text>
            <Text style={[styles.th, styles.colQty]}>QTD.</Text>
            <Text style={[styles.th, styles.colRate]}>VALOR UNITÁRIO</Text>
            <Text style={[styles.th, styles.colAmount]}>VALOR</Text>
          </View>
          {data.line_items.map((li, i) => (
            <View
              key={i}
              style={[styles.tr, ...(i % 2 === 1 ? [{ backgroundColor: ROW_ALT }] : [])]}
              wrap={false}
            >
              <Text style={styles.colDesc}>{li.description}</Text>
              <Text style={styles.colQty}>{fmtQty(li.quantity)}</Text>
              <Text style={styles.colRate}>{fmtMoney(li.rate, data.currency)}</Text>
              <Text style={styles.colAmount}>{fmtMoney(li.amount, data.currency)}</Text>
            </View>
          ))}
        </View>

        {/* Totais */}
        <View style={styles.totals} wrap={false}>
          {data.status === 'paid' && <Text style={[styles.paidStamp, { top: 2 }]}>PAGO</Text>}
          <View style={styles.totalsBox}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Subtotal</Text>
              <Text>{fmtMoney(data.subtotal, data.currency)}</Text>
            </View>
            {data.discount_amount > 0 && (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Desconto</Text>
                <Text style={{ color: GREEN }}>
                  -{fmtMoney(data.discount_amount, data.currency)}
                </Text>
              </View>
            )}
            {data.tax_amount > 0 && (
              <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Imposto ({data.tax_rate}%)</Text>
                <Text>{fmtMoney(data.tax_amount, data.currency)}</Text>
              </View>
            )}
            {data.shipping_amount > 0 && (
              <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Frete</Text>
                <Text>{fmtMoney(data.shipping_amount, data.currency)}</Text>
              </View>
            )}
            <View style={styles.grandRow}>
              <Text style={styles.grandLabel}>Total</Text>
              <Text style={styles.grandValue}>{fmtMoney(data.total, data.currency)}</Text>
            </View>
            {data.amount_paid > 0 && (
              <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Valor pago</Text>
                <Text style={{ color: GREEN }}>
                  -{fmtMoney(data.amount_paid, data.currency)}
                </Text>
              </View>
            )}
            {data.status !== 'paid' && (
              <View style={[styles.balanceBand, { backgroundColor: accent }]}>
                <Text style={styles.balanceText}>Saldo devido</Text>
                <Text style={styles.balanceText}>
                  {fmtMoney(data.balance_due, data.currency)}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Observações / Condições / Instruções de pagamento */}
        {data.notes && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.label}>OBSERVAÇÕES</Text>
            <Text style={styles.sectionBody}>{data.notes}</Text>
          </View>
        )}
        {data.payment_instructions && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.label}>INSTRUÇÕES DE PAGAMENTO</Text>
            <Text style={styles.sectionBody}>{data.payment_instructions}</Text>
          </View>
        )}
        {data.payments_enabled && data.status !== 'paid' && data.public_url && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.label}>PAGUE ONLINE</Text>
            <Text style={styles.sectionBody}>Pague online em {data.public_url}</Text>
          </View>
        )}
        {data.terms && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.label}>CONDIÇÕES</Text>
            <Text style={styles.sectionBody}>{data.terms}</Text>
          </View>
        )}
        {data.footer && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionBody}>{data.footer}</Text>
          </View>
        )}

        {/* Rodapé da página */}
        <View style={styles.footer} fixed>
          <Text>{contactBits}</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              totalPages > 1 ? `Página ${pageNumber} de ${totalPages}` : ''
            }
          />
        </View>
      </Page>
    </Document>
  )
}

// ---- Montagem dos dados ----

/* eslint-disable @typescript-eslint/no-explicit-any */
export function buildInvoicePdfData(
  invoice: any,
  lineItems: any[],
  business: any,
  client: any,
  paymentsEnabled = false
): InvoicePdfData {
  business = invoice.business_snapshot && typeof invoice.business_snapshot === 'object' ? invoice.business_snapshot : business
  client = invoice.client_snapshot && typeof invoice.client_snapshot === 'object' ? invoice.client_snapshot : client
  return {
    invoice_number: invoice.invoice_number,
    status: invoice.status,
    issue_date: invoice.issue_date,
    due_date: invoice.due_date,
    currency: invoice.currency || 'USD',
    po_number: invoice.po_number,
    subtotal: Number(invoice.subtotal) || 0,
    discount_amount: Number(invoice.discount_amount) || 0,
    tax_rate: Number(invoice.tax_rate) || 0,
    tax_amount: Number(invoice.tax_amount) || 0,
    shipping_amount: Number(invoice.shipping_amount) || 0,
    total: Number(invoice.total) || 0,
    amount_paid: Number(invoice.amount_paid) || 0,
    balance_due: Number(invoice.balance_due) || 0,
    notes: invoice.notes,
    terms: invoice.terms,
    payment_instructions: invoice.payment_instructions,
    footer: invoice.footer,
    primary_color: business?.primary_color,
    business: {
      name: business?.name || 'Faturador',
      email: business?.email,
      phone: business?.phone,
      website: business?.website,
      address_line1: business?.address_line1,
      address_line2: business?.address_line2,
      city: business?.city,
      state: business?.state,
      postal_code: business?.postal_code,
      country: business?.country,
    },
    client: {
      name: client?.name || 'Cliente',
      email: client?.email,
      address_line1: client?.address_line1,
      address_line2: client?.address_line2,
      city: client?.city,
      state: client?.state,
      postal_code: client?.postal_code,
      country: client?.country,
    },
    line_items: (lineItems || [])
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((li) => ({
        description: li.description || '',
        quantity: Number(li.quantity) || 0,
        rate: Number(li.rate) || 0,
        amount: Number(li.amount) || 0,
      })),
    payments_enabled: !!paymentsEnabled,
    public_url: invoice.public_id ? publicUrl(invoice.public_id) : null,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Reforço contra SSRF: esta busca do logotipo pode ser acessada SEM AUTENTICAÇÃO
// pela rota pública do PDF (/api/public/invoices/[publicId]/pdf), e a URL vem de
// business.logo_url, controlada pelo usuário. Rejeita endereços que possam alcançar
// a infraestrutura interna ou um endpoint de metadados da nuvem.
const MAX_LOGO_BYTES = 5 * 1024 * 1024 // 5MB

// Retorna true se `ip` for um endereço privado, de loopback, link-local ou de
// metadados que NÃO deve ser buscado pelo servidor. Exportada para testes unitários.
export function isBlockedLogoAddress(ip: string): boolean {
  const addr = ip.trim().toLowerCase()

  // IPv4 (também corresponde a IPv4 mapeado em IPv6, como ::ffff:127.0.0.1, pelo sufixo abaixo)
  const v4 = addr.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 0) return true // 0.0.0.0/8 ("este host")
    if (a === 127) return true // loopback 127/8
    if (a === 10) return true // privado 10/8
    if (a === 172 && b >= 16 && b <= 31) return true // privado 172.16/12
    if (a === 192 && b === 168) return true // privado 192.168/16
    if (a === 169 && b === 254) return true // link-local / metadados 169.254/16
    if (a >= 224) return true // multicast / reservado
    return false
  }

  // IPv6
  if (addr === '::1') return true // loopback
  if (addr === '::') return true // não especificado
  if (addr.startsWith('fe80')) return true // link-local
  // Endereços locais exclusivos fc00::/7 -> fc.. ou fd..
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true

  return false
}

/**
 * A pilha local da CLI do Supabase É loopback http, então a lista de bloqueio
 * de faixas privadas abaixo recusaria o único armazenamento de uma instalação
 * de desenvolvimento. A exceção é intencionalmente restrita: só se aplica quando
 * a URL já corresponde à origem NEXT_PUBLIC_SUPABASE_URL configurada, que em
 * qualquer instalação real é um host público https.
 */
function isLoopbackStorage(parsed: URL): boolean {
  return (
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]')
  )
}

/** Exportada para testes unitários, assim como isBlockedLogoAddress acima. */
export async function fetchLogo(
  url: string | null | undefined
): Promise<InvoicePdfData['logo']> {
  if (!url) return null
  try {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return null
    }
    // (a) somente a origem de armazenamento desta instalação. Esta é a
    // verificação mais restritiva e reforça as demais: a rota abaixo pode ser
    // acessada sem autenticação, então um host público arbitrário a transformaria
    // em amplificadora de requisições para qualquer destino indicado por logo_url.
    // A ação de identidade visual não grava nenhum outro tipo de URL.
    if (!isAllowedLogoUrl(url)) return null

    // (b) somente https
    if (parsed.protocol !== 'https:' && !isLoopbackStorage(parsed)) return null

    // (c) resolve o hostname e rejeita faixas privadas, de loopback ou metadados
    if (!isLoopbackStorage(parsed)) {
      const { lookup } = await import('node:dns/promises')
      const resolved = await lookup(parsed.hostname, { all: true })
      if (resolved.length === 0) return null
      if (resolved.some((r) => isBlockedLogoAddress(r.address))) return null
    }

    // (d) redirecionamento 'manual' para impedir que uma resposta 30x aponte para um host interno
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      redirect: 'manual',
    })
    if (!res.ok) return null

    const type = res.headers.get('content-type') || ''
    const format = type.includes('png') ? 'png' : type.includes('jpe') || type.includes('jpg') ? 'jpg' : null
    if (!format) return null

    // (e) limita o tamanho do corpo: rejeita cedo pelo Content-Length e limita os bytes lidos
    const len = Number(res.headers.get('content-length'))
    if (Number.isFinite(len) && len > MAX_LOGO_BYTES) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > MAX_LOGO_BYTES) return null

    return { data: buf, format }
  } catch {
    return null
  }
}

export async function renderInvoicePdf(
  data: InvoicePdfData,
  logoUrl?: string | null
): Promise<Buffer> {
  const logo = await fetchLogo(logoUrl)
  return renderToBuffer(<InvoicePdfDocument data={{ ...data, logo }} />)
}
