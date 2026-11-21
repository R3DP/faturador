/**
 * Funções auxiliares compartilhadas por todos os arquivos de ferramentas MCP, para que route.ts continue sendo um
 * registrador enxuto e cada arquivo de ferramenta não redefina os mesmos recursos.
 *
 * Padrão de registro de ferramentas (copie ao criar novas ferramentas):
 *   server.registerTool(name, { title, description, inputSchema: z.object({...}) }, async (input) => {...})
 * Todo handler deve resolver o acesso à empresa por ctx.db (resolveBusinessId /
 * assertClientAccess / assertInvoiceAccess) antes de consultar ctx.db.svc; uma
 * consulta direta a ctx.db.svc sem uma dessas chamadas de definição de escopo não é permitida.
 */

import { appOrigin } from '@/lib/deployment'
import { todayISO } from '@/lib/dates'

export const serverInfo = { name: 'billr', version: '1.0.0' }

/**
 * URL base para links do aplicativo (por exemplo, /invoices/:id) e links públicos/compartilháveis
 * (por exemplo, /i/:publicId, /api/public/invoices/:publicId/pdf). Fonte única
 * para que todos os arquivos de ferramentas usem a mesma variável de ambiente e o mesmo
 * valor alternativo, em vez de cada um definir seu próprio valor fixo.
 */
export function appUrl(): string {
  return appOrigin()
}

export function publicUrl(publicId: string): string {
  return `${appUrl()}/i/${publicId}`
}

export function pdfUrl(publicId: string): string {
  return `${appUrl()}/api/public/invoices/${publicId}/pdf`
}

/**
 * Escapa curingas `ilike` do PostgREST (% e _) para que um valor literal que contenha
 * qualquer um desses caracteres (por exemplo, "50% Off Co") seja localizado exatamente, e não como um
 * padrão. Fonte única usada em todas as chamadas ilike (busca de clientes em
 * invoices-write.ts e verificação de nomes duplicados em clients.ts), para evitar que o escape
 * fique inconsistente entre elas.
 */
export function escapeLike(value: string): string {
  return value.replace(/[%_]/g, (m) => `\\${m}`)
}

/**
 * Envolve um valor para que o PostgREST o interprete como literal dentro de uma árvore lógica.
 *
 * `escapeLike` neutraliza apenas `%` e `_` do SQL. Ele não afeta
 * a gramática PRÓPRIA do PostgREST, e `.or()` recebe uma expressão de filtro bruta; assim, um
 * termo de busca com vírgula ou ponto é interpretado como vários filtros:
 *
 *     search = 'a,nosuchcol.eq.1,name.ilike.'
 *     or=(name.ilike.%a,nosuchcol.eq.1,name.ilike.%,email.ilike.%a,...%)
 *     => 42703 a coluna clients.nosuchcol não existe
 *
 * Aspas duplas fazem com que tudo seja um único literal. Dentro delas, o PostgREST
 * remove o escape de `\"` e `\\`; por isso, esses são os únicos caracteres que precisam
 * ser escapados aqui; `\%` (gerado por escapeLike) permanece intacto entre aspas.
 */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/["\\]/g, (m) => `\\${m}`)}"`
}

/**
 * Uma expressão `or` do PostgREST que busca `search` como trecho de qualquer uma das
 * `columns`. Ela é criada aqui, em vez de em cada ponto de chamada, para que o escape acima
 * nunca seja esquecido em novas chamadas.
 */
export function likeAnyFilter(columns: readonly string[], search: string): string {
  const pattern = quoteFilterValue(`%${escapeLike(search)}%`)
  return columns.map((column) => `${column}.ilike.${pattern}`).join(',')
}

/**
 * Acrescenta um aviso de truncamento ao resumo quando uma consulta retorna exatamente o
 * limite de registros, para que quem chama saiba que os totais calculados podem estar incompletos, em vez de
 * confiar silenciosamente em um conjunto parcial.
 */
export function truncationNote(cap: number): string {
  return ` (resultados truncados no limite de ${cap}; os totais podem estar incompletos)`
}

export function errorResult(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true as const }
}

export function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
}

export function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amount)
  } catch {
    // Código de moeda desconhecido ou inválido: usa um número simples com rótulo
    // em vez de deixar Intl lançar um erro.
    return `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
  }
}

export const UNPAID_STATUSES = ['sent', 'viewed', 'partial', 'overdue']
const OVERDUE_ELIGIBLE_STATUSES = [
  'sent',
  'viewed',
  'partial',
  'overdue',
]

export function isOverdue(status: string, dueDate: string): boolean {
  const today = todayISO()
  return OVERDUE_ELIGIBLE_STATUSES.includes(status) && dueDate < today
}
