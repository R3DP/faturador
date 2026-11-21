/**
 * Sistema de cores dos relatórios. Contém somente dados, sem React, para ser
 * importado por gráficos, legendas, tabelas e testes; assim, todas as interfaces
 * usam os mesmos códigos hexadecimais definidos em um único lugar.
 *
 * Como esses valores foram escolhidos (não a olho):
 *
 * - A primeira posição usa o azul da marca Faturador (#2563eb no tema claro /
 *   #3b82f6 no escuro, o --primary do aplicativo em cada tema). As demais
 *   posições seguem a ordem categórica validada da paleta de visualização de
 *   dados, ajustada para cada superfície.
 * - O conjunto foi validado na superfície real do gráfico em cada tema (cartão
 *   branco #ffffff no claro e cartão ardósia #1e293b no escuro):
 *     claro: faixa de luminosidade PASSOU, limite mínimo de croma PASSOU,
 *            separação para daltonismo PASSOU (pior dE adjacente 9,1),
 *            limite para visão normal PASSOU (pior 19,6), AVISO de contraste
 *            em ciano/amarelo/magenta -> essas posições sempre são acompanhadas
 *            por rótulos visíveis e uma tabela (regra de reforço).
 *     escuro: as seis verificações PASSARAM (pior dE adjacente para daltonismo
 *             8,4, contraste >= 3:1).
 * - A escala de envelhecimento é ORDINAL (a idade tem uma ordem natural), por
 *   isso usa um único tom, do claro ao escuro, validado segundo as regras ordinais:
 *   no tema claro, os níveis vão de #86b6ef a #184f95 (contraste de 2,11:1 na
 *   extremidade clara); no tema escuro, vão de #256abf a #b7d3f6 (contraste de
 *   2,71:1), pois numa superfície escura o tom MAIS CLARO é o que se destaca.
 *   As duas direções foram validadas para que a faixa mais antiga seja a mais
 *   proeminente em ambos os temas.
 * - "Ainda não vencido" fica intencionalmente fora da escala, em cinza discreto:
 *   é contexto, não uma etapa de atraso, e o cinza direciona o olhar para os
 *   valores que realmente estão vencidos.
 *
 * Os gráficos usam essas cores por meio de propriedades personalizadas de CSS
 * (consulte components/reports/chart-theme.tsx), para alternar entre os temas
 * claro e escuro em um só lugar, sem precisar informar ao Recharts qual tema está ativo.
 */

type VizRole =
  | 'series-1'
  | 'series-2'
  | 'series-3'
  | 'series-4'
  | 'series-5'
  | 'series-6'
  | 'compare'
  | 'grid'
  | 'axis'
  | 'surface'
  | 'age-0'
  | 'age-1'
  | 'age-2'
  | 'age-3'
  | 'age-4'

export type VizPalette = Record<VizRole, string>

export const VIZ_LIGHT: VizPalette = {
  'series-1': '#2563eb', // azul; cor primária do Faturador
  'series-2': '#eb6834', // laranja
  'series-3': '#1baf7a', // turquesa
  'series-4': '#eda100', // amarelo
  'series-5': '#e87ba4', // magenta
  'series-6': '#4a3aa7', // violeta
  compare: '#9ca3af', // cinza menos destacado para o período de comparação
  grid: '#e5e7eb',
  axis: '#6b7280',
  surface: '#ffffff',
  'age-0': '#9ca3af', // ainda não venceu; fica fora da escala de propósito
  'age-1': '#86b6ef',
  'age-2': '#5598e7',
  'age-3': '#2563eb',
  'age-4': '#184f95',
}

export const VIZ_DARK: VizPalette = {
  'series-1': '#3b82f6',
  'series-2': '#d95926',
  'series-3': '#199e70',
  'series-4': '#c98500',
  'series-5': '#d55181',
  'series-6': '#9085e9',
  compare: '#64748b',
  grid: '#334155',
  axis: '#94a3b8',
  surface: '#1e293b',
  'age-0': '#64748b',
  'age-1': '#256abf',
  'age-2': '#3987e5',
  'age-3': '#6da7ec',
  'age-4': '#b7d3f6',
}

/** Nome da propriedade personalizada de CSS para uma função. */
function vizVar(role: VizRole): string {
  return `var(--viz-${role})`
}

/** Atribuições fixas de séries. A cor acompanha a entidade, nunca sua posição. */
export const SERIES_COLORS = {
  invoiced: vizVar('series-1'),
  collected: vizVar('series-2'),
  expenses: vizVar('series-3'),
  profit: vizVar('series-4'),
  unbilled: vizVar('series-2'),
  billable: vizVar('series-1'),
  nonBillable: vizVar('compare'),
  previous: vizVar('compare'),
} as const

export const AGING_COLORS: Record<string, string> = {
  current: vizVar('age-0'),
  d1_30: vizVar('age-1'),
  d31_60: vizVar('age-2'),
  d61_90: vizVar('age-3'),
  d90_plus: vizVar('age-4'),
}

/** Serializa uma paleta para o bloco de propriedades CSS personalizadas exigido pelo escopo do tema. */
export function paletteToCss(palette: VizPalette): string {
  return Object.entries(palette)
    .map(([role, hex]) => `--viz-${role}: ${hex};`)
    .join(' ')
}
