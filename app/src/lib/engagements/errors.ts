import { scheduleErrorMessage } from './schedule'

/**
 * Um vocabulário único para todas as recusas de operações de contrato.
 *
 * As RPCs de contratos retornam códigos estáveis em vez de frases, para que
 * as duas interfaces que as chamam (as ferramentas MCP e as ações de servidor
 * do app) transformem o mesmo código na mesma explicação. Sem isso, elas
 * divergiriam e uma pessoa e um agente receberiam explicações diferentes
 * sobre a mesma regra.
 *
 * Os códigos gerados pelos cálculos do cronograma ficam em schedule.ts, junto
 * dos próprios cálculos, e são consultados primeiro.
 */
const ENGAGEMENT_ERRORS: Record<string, string> = {
  engagement_not_found: 'Contrato não encontrado',
  entry_not_found: 'Item do cronograma não encontrado',
  client_not_found: 'Cliente não encontrado',
  estimate_not_found: 'Orçamento não encontrado',
  request_id_reused:
    'Esse identificador de solicitação já foi usado em outra gravação de contrato. Use um novo identificador.',
  key_cannot_manage_engagements:
    'Esta chave de API não tem a permissão de gravação, necessária para criar ou alterar um contrato.',
  engagement_closed:
    'Este contrato já foi concluído ou cancelado, então sua situação não pode ser alterada novamente.',
  invalid_status_transition: 'Não é possível mudar a situação atual do contrato para essa opção.',
  invalid_status: 'Escolha uma situação válida para o contrato.',
  engagement_cancelled: 'Este contrato foi cancelado, então não é possível faturar mais nada nele.',
  entry_already_invoiced:
    'Esse item já foi faturado. O valor faturado não pode ser alterado aqui; faça a correção na fatura.',
  entry_waived: 'Esse item já foi dispensado.',
  entry_invoiced_immutable:
    'Esse item já foi faturado, então seu valor não pode ser alterado nem ele pode ser removido.',
  waive_reason_required: 'É necessário informar o motivo para dispensar um item do cronograma.',
  engagement_schedule_unbalanced:
    'Os itens do cronograma devem somar exatamente o valor total do contrato.',
  invalid_name: 'O nome do contrato deve ter entre 1 e 200 caracteres.',
  invalid_currency: 'Use um código de moeda com três letras, por exemplo USD.',
  invalid_initial_status: 'Um contrato novo só pode começar como rascunho ou ativo.',
  invalid_actor: 'Não foi possível atribuir esta gravação a ninguém, então ela foi recusada.',
  invalid_agent_key: 'Essa chave de API não pode ser usada para esta empresa.',
  request_id_required: 'É necessário informar um identificador de solicitação para esta gravação.',

  // Parte B: faturamento de um item do cronograma em uma fatura e
  // conversão de um orçamento aceito em contrato.
  engagement_entry_already_invoiced:
    'Esse item do cronograma já está em uma fatura. Se a fatura de rascunho estiver incorreta, exclua-a primeiro ou fature outro item.',
  engagement_entry_not_ready:
    'Esse item do cronograma ainda não está pronto para faturar. A regra de vencimento ainda não foi acionada: inicie o contrato, marque a etapa como concluída ou aguarde a data.',
  engagement_entry_not_found: 'Item do cronograma não encontrado',
  engagement_entry_client_mismatch:
    'Esse item do cronograma pertence a outro cliente, então não pode ser incluído nesta fatura.',
  engagement_entry_currency_mismatch:
    'O contrato e a fatura estão em moedas diferentes. O Faturador nunca converte valores por conta própria; emita a fatura na moeda do contrato.',
  engagement_not_billable:
    'Esse contrato está em rascunho ou foi cancelado, então não é possível faturar nada nele. Se o trabalho for continuar, inicie o contrato primeiro.',
  duplicate_engagement_entry_ids: 'O mesmo item do cronograma foi informado duas vezes. Informe cada item apenas uma vez.',
  estimate_already_converted:
    'Esse orçamento já foi convertido em fatura, então não pode também ser convertido em contrato.',
  estimate_already_an_engagement:
    'Esse orçamento já foi convertido em contrato. Fature pelo cronograma do contrato em vez de convertê-lo novamente.',
  estimate_not_convertible:
    'Esse orçamento foi recusado ou expirou, então não pode ser convertido.',
}

/**
 * A frase correspondente ao código retornado, ou null quando o código não é
 * nosso (nesse caso, quem chamou mostra sua própria mensagem alternativa, em
 * vez de repassar um erro do Postgres para a pessoa).
 */
export function engagementErrorMessage(raw: string | null | undefined): string | null {
  const code = (raw ?? '').trim()
  if (!code) return null

  const exact = scheduleErrorMessage(code) ?? ENGAGEMENT_ERRORS[code]
  if (exact) return exact

  // Em alguns caminhos, o Postgres inclui o código em uma mensagem mais longa;
  // por isso, tentamos encontrar o código dentro do texto antes de desistir de
  // identificar uma regra conhecida.
  for (const [key, message] of Object.entries(ENGAGEMENT_ERRORS)) {
    if (code.includes(key)) return message
  }
  return null
}
