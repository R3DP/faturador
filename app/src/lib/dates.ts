/**
 * A regra única para datas de calendário nesta aplicação.
 *
 * ----------------------------------------------------------------------------
 * A REGRA
 *
 *   1. Toda data de negócio fica em uma coluna DATE do Postgres: invoices.issue_date,
 *      invoices.due_date, invoices.paid_at, payments.payment_date,
 *      expenses.date, time_entries.date, estimates.expiry_date. DATE não tem
 *      horário nem fuso horário. É apenas um dia do calendário.
 *
 *   2. Em TypeScript, um dia do calendário é a string 'yyyy-MM-dd'. Nunca um Date.
 *      Strings são comparadas e ordenadas corretamente, sobrevivem ao JSON e não
 *      sofrem deslocamentos.
 *
 *   3. A conversão entre as duas formas sempre passa por este módulo:
 *        string -> Date   parseDay      (meia-noite LOCAL)
 *        Date   -> string toISODate     (campos do calendário LOCAL)
 *        now    -> string todayISO
 *
 *   4. Duas construções são terminantemente proibidas:
 *        new Date('2026-01-05')          interpreta como meia-noite UTC; por isso,
 *                                        format(...) exibe "4 de jan." para
 *                                        qualquer pessoa a oeste de Greenwich
 *        someDate.toISOString().slice(0, 10)
 *                                        converte um Date de meia-noite LOCAL para UTC,
 *                                        então uma data escolhida em 5 de jan. em Nova York
 *                                        é armazenada como 4 de jan.
 *      Os erros são inversos exatos um do outro e só se anulam por sorte.
 *
 * ----------------------------------------------------------------------------
 * POR QUE ISSO É COERENTE EM TODA A PILHA
 *
 * O caso delicado é "hoje", porque o navegador e o servidor ficam em fusos
 * diferentes. A regra é que "hoje" sempre corresponde ao dia do calendário do
 * relógio que está fazendo a consulta, lido por seus campos LOCAIS:
 *
 *   no navegador    o dia da própria pessoa, que é o dia pretendido ao escolher
 *                   uma data ou consultar um indicador de atraso
 *   no servidor     o dia da implantação. Na Vercel, o ambiente de execução usa
 *                   UTC, então todayISO() no servidor é igual a Postgres CURRENT_DATE,
 *                   e a resposta do servidor para "está atrasado?" concorda com
 *                   qualquer SQL que compare com CURRENT_DATE
 *
 * Essa é a mesma regra já documentada e seguida pela camada de relatórios (veja
 * src/lib/reports/date-ranges.ts, que reexporta estas funções auxiliares em vez
 * de manter uma segunda cópia). Nada na aplicação converte uma data de
 * calendário para ou de UTC, pois não há nada a converter: DATE não é um instante.
 *
 * Timestamps são a outra categoria e não são afetados. created_at, last_sent_at
 * e last_viewed_at são TIMESTAMPTZ, isto é, instantes reais, e permanecem como
 * strings ISO-8601 por meio de toISOString(). Somente os campos com precisão de
 * dia listados acima usam este módulo.
 */

/**
 * Converte 'yyyy-MM-dd' para meia-noite LOCAL.
 *
 * Nunca use `new Date(isoDateString)` para isso: a especificação ECMAScript
 * interpreta uma string contendo apenas a data como UTC, o que a coloca no dia
 * anterior do calendário para qualquer pessoa em um fuso de deslocamento negativo.
 */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/**
 * Formata um Date como 'yyyy-MM-dd' usando seus campos do calendário LOCAL.
 *
 * Nunca use `date.toISOString().slice(0, 10)` para isso: primeiro converte para
 * UTC, então um Date de meia-noite local vindo de um seletor de data retorna
 * como o dia anterior.
 */
export function toISODate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Hoje como string de data do calendário, conforme a regra acima. */
export function todayISO(now: Date = new Date()): string {
  return toISODate(now)
}

/** Retorna true para uma string 'yyyy-MM-dd' bem formada. */
export function isISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/**
 * Adiciona dias a uma string de data do calendário, mantendo o formato de string.
 * Trata limites de mês e ano e o horário de verão (DST) usando a aritmética
 * local de Date.
 */
export function addDaysISO(iso: string, days: number): string {
  const date = parseDay(iso)
  date.setDate(date.getDate() + days)
  return toISODate(date)
}
