/**
 * Onde o logotipo de uma empresa pode ficar.
 *
 * `businesses.logo_url` é gravado pela ação de configurações da marca e depois
 * lido de volta em três lugares que não são igualmente permissivos: um `<img src>`
 * na página da fatura e nas duas páginas públicas de documentos, e um `fetch`
 * no servidor, no renderizador de PDF, que pode ser acessado SEM AUTENTICAÇÃO por
 * `/api/public/invoices/[publicId]/pdf`.
 *
 * A auditoria da aplicação registrou duas constatações sobre isso (Low-2 e Low-3):
 * `z.string().url()` aceita `javascript:`, `data:` e `file:` no zod 4, e a rota de PDF
 * busca qualquer host público `https` indicado pelo proprietário, o que amplifica
 * requisições e insere uma origem escolhida por um invasor em um documento que
 * a empresa envia aos próprios clientes.
 *
 * Os dois problemas são resolvidos da mesma forma: o logotipo só pode usar a
 * origem de armazenamento do Supabase da própria instalação, que também é a
 * única origem para a qual a página de identidade visual pode enviar arquivos.
 * Tudo deriva de `NEXT_PUBLIC_SUPABASE_URL`, então cada instalação valida usando
 * seu próprio banco de dados.
 */

/** O Supabase Storage serve objetos públicos a partir deste prefixo de caminho. */
const PUBLIC_OBJECT_PREFIX = '/storage/v1/object/public/'

/** O único bucket para o qual um logotipo é enviado. */
const LOGO_BUCKET = 'logos'

export const MAX_LOGO_URL_LENGTH = 2000

/** A origem configurada do Supabase, ou null se não houver configuração utilizável. */
export function supabaseStorageOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin
  } catch {
    return null
  }
}

/**
 * Retorna true quando `value` é um logotipo que esta instalação pode exibir ou buscar.
 *
 * Exige-se https, com uma exceção intencional: a pilha local da CLI do Supabase
 * é servida por http simples em loopback, e recusá-la tornaria a página de
 * identidade visual inutilizável durante o desenvolvimento sem ganho de
 * segurança (a origem ainda precisa corresponder, então nada mais fica
 * acessível). Uma instalação configurada com uma URL https do Supabase nunca
 * aceitará http aqui, pois a comparação de origem já falha por causa do esquema.
 */
export function isAllowedLogoUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > MAX_LOGO_URL_LENGTH) return false
  const origin = supabaseStorageOrigin()
  if (!origin) return false
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  // A origem contém o esquema, o host e a porta; portanto, esta única comparação
  // recusa javascript:, data:, file: e qualquer outro host.
  if (parsed.origin !== origin) return false
  if (parsed.username || parsed.password) return false
  return parsed.pathname.startsWith(`${PUBLIC_OBJECT_PREFIX}${LOGO_BUCKET}/`)
}

/** Mensagem exibida à pessoa e registrada nos testes da ação de identidade visual. */
export const LOGO_URL_MESSAGE =
  'O logotipo deve ser enviado para esta instalação e servido pelo armazenamento dela.'
