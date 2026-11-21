/**
 * Primitivas monetárias da camada de relatórios. Sem React nem entrada/saída: são
 * funções puras para que os cálculos possam ser testados isoladamente.
 *
 * Este módulo existe para garantir duas regras:
 *
 * 1. O PostgREST retorna colunas numéricas/DECIMAL como STRINGS. Antes de entrar
 *    em qualquer cálculo, tudo passa por toNumber(); esta camada nunca presume
 *    que um valor já seja numérico.
 * 2. Arredonde UMA VEZ, ao final da acumulação, nunca a cada etapa. Arredondar
 *    cada parcela antes de somar gera um desvio de um centavo por linha, um
 *    problema que já ocorreu neste repositório.
 */

/** Converte um valor numérico do PostgREST (string), número JSON ou null/undefined em um número finito. */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

/** Arredonda para centavos. Use uma vez no total final, não em cada parcela. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0
  // Multiplica antes de arredondar, para que 1,005 não caia para 1,00 por erro de ponto flutuante.
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * Soma valores monetários brutos (possivelmente strings), acumulando com
 * precisão total e arredondando uma única vez.
 */
export function sumMoney(values: readonly unknown[]): number {
  let total = 0
  for (const value of values) total += toNumber(value)
  return roundMoney(total)
}

/** Participação em um total, de 0 a 100. Retorna 0, em vez de NaN/Infinity, quando o total é 0. */
export function percentOf(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total === 0) return 0
  return (part / total) * 100
}

export interface Delta {
  /** atual - anterior, arredondado uma vez. */
  absolute: number
  /** Variação percentual, ou null quando o período anterior foi zero (não há percentual significativo). */
  percent: number | null
  direction: 'up' | 'down' | 'flat'
}

/**
 * Variação entre períodos. Se o período anterior foi zero, o percentual é null,
 * em vez de Infinity ou de um "+100%" inventado; assim a interface pode
 * informar "sem atividade comparável" em vez de exibir um número falso.
 */
export function computeDelta(current: number, previous: number): Delta {
  const absolute = roundMoney(current - previous)
  const percent = previous === 0 ? null : ((current - previous) / Math.abs(previous)) * 100
  const direction = absolute > 0 ? 'up' : absolute < 0 ? 'down' : 'flat'
  return { absolute, percent, direction }
}

/** Converte minutos em horas decimais, arredondadas a duas casas para exibição. */
export function minutesToHours(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0
  return Math.round((minutes / 60) * 100) / 100
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
  }
}

/** Formato compacto para marcas dos eixos e cartões de indicadores: $4.2K, $1.3M. */
export function formatMoneyCompact(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(amount)
  } catch {
    return `${Math.round(amount).toLocaleString('pt-BR')} ${currency}`
  }
}

export function formatHours(hours: number): string {
  return `${hours.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}h`
}

export function formatPercent(value: number, digits = 0): string {
  return `${value.toFixed(digits).replace('.', ',')}%`
}
