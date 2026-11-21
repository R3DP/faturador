export interface AgentRecipe {
  id: string
  title: string
  description: string
  content: string
}

const timeLoggingRecipe = `## Registro de horas faturáveis

Quando eu terminar uma parte significativa do trabalho neste repositório (uma funcionalidade, uma correção de bug,
uma revisão ou qualquer atividade faturável ao cliente), registre-a no Faturador antes de continuar:

1. Estime quantas horas foram dedicadas à tarefa que acabou de concluir.
2. Chame \`log_time\` no servidor MCP do Faturador, no contexto da empresa "Acme Co",
   informando o nome do cliente, uma descrição do trabalho em uma linha, a data e as horas.
3. Não crie nem envie uma fatura. Apenas registre o tempo. Vou pedir a emissão das faturas separadamente.
4. Se não souber a qual cliente o trabalho pertence, pergunte antes de registrá-lo.
`

const monthEndRecipe = `## Emissão de faturas no fim do mês

Quando eu disser "emita as faturas de <month>" ou, se eu pedir essa rotina, no último dia útil do mês:

1. Chame \`list_unbilled\` para cada cliente ativo para consultar horas e despesas não faturadas, agrupadas por cliente.
2. Para cada cliente com trabalho não faturado, chame \`create_invoice\` com os \`time_entry_ids\` e \`expense_ids\` retornados para esse cliente e omita \`line_items\`. O servidor calcula os valores e associa o trabalho de origem em uma única etapa; não invente, arredonde nem recalcule nenhum item.
3. Deixe todas as faturas como **rascunho**. Nunca chame \`send_invoice\` nesta rotina.
4. Responda com uma tabela resumida contendo cliente, total da fatura e link do painel retornado pela ferramenta, para que eu possa revisar e enviar pelo app.

Tudo o que já estiver associado a um rascunho deixa de aparecer em \`list_unbilled\`; portanto, execute a etapa 1 uma vez por cliente e nunca fature novamente um id já informado.
`

const overdueChaseRecipe = `## Rascunhos de cobrança de faturas vencidas

Quando eu disser "verifique as faturas vencidas":

1. Chame \`list_invoices\` filtrando pelo status vencido.
2. Para cada fatura vencida, chame \`get_invoice_link\` para obter a URL pública da fatura.
3. Escreva um rascunho curto e cordial de e-mail de acompanhamento para cada cliente (não para cada fatura), mencionando o número da fatura, o valor e a data de vencimento, e incluindo o link público. Não envie nada.
4. Cole os rascunhos no chat, um por cliente, para que eu possa editá-los e enviá-los ou encaminhá-los para eu enviar pelo painel.
5. Nunca marque uma fatura como paga nem altere os termos dela nesta rotina.
`

const quoteBeforeYouBillRecipe = `## Faça um orçamento antes de faturar

Quando eu descrever um novo trabalho e disser "faça um orçamento" ou "me passe um valor para isto":

1. Confirme o cliente com \`list_clients\`. Se o nome for ambíguo ou o cliente ainda não existir, pergunte antes de criar qualquer coisa.
2. Chame \`list_items\` primeiro e calcule o escopo usando os valores salvos no catálogo sempre que houver um item correspondente. Só invente um valor se nada no catálogo se aplicar e, nesse caso, deixe isso explícito.
3. Chame \`create_estimate\` com um item por entrega. Use minhas palavras nas descrições, sem linguagem de marketing.
4. Pare no rascunho. Nunca chame \`send_estimate\`. O orçamento só vai para o cliente depois que eu o revisar.
5. Responda com os itens, o total e o número do orçamento para que eu possa aprovar ou ajustar. Se eu pedir alterações, use \`update_draft_estimate\` em vez de criar outro orçamento.
6. Depois, quando eu disser que o cliente aceitou, chame \`convert_estimate_to_invoice\` usando o id desse orçamento. Deixe a fatura resultante como **rascunho** e nunca chame \`send_invoice\`. Informe o número da fatura para que eu possa enviá-la pelo painel.
`

const paymentStatusRecipe = `## Consulta do status de pagamentos

Quando eu perguntar "como estão os pagamentos" ou sobre uma fatura específica antes de cobrar:

1. Chame \`list_invoices\` filtrando pelos status enviada e vencida para obter as possíveis faturas.
2. Para cada uma, chame \`get_payment_status\` em vez de confiar somente no total da fatura. A ferramenta retorna o livro-caixa de pagamentos, o saldo ainda devido e um sinalizador de divergência.
3. Se \`mismatch\` for true em qualquer fatura, pare e sinalize-a para mim pelo nome. Não informe um valor pago para essa fatura nem faça a cobrança. Os números divergem e preciso analisá-los pessoalmente.
4. Informe as demais em uma tabela curta: cliente, número da fatura, valor pago, saldo devido e dias em atraso.
5. Nunca chame \`record_payment\`, \`send_invoice\` nem qualquer operação que edite uma fatura nesta rotina. Ela é somente de leitura.
`

const rateCatalogRecipe = `## Manutenção do catálogo de preços

Quando eu disser "verifique o catálogo de preços" ou mencionar que um preço mudou:

1. Chame \`list_items\` e mostre os itens salvos atualmente e seus valores.
2. Chame \`list_invoices\` para os últimos meses e destaque descrições de itens que eu digito manualmente com frequência, mas que ainda não estão no catálogo, junto com o valor que cobrei por eles.
3. Proponha as inclusões e alterações de valores em uma lista. Não chame \`create_item\` nem \`update_item\` até eu indicar quais aplicar.
4. Quando eu aprovar, aplique exatamente o que aprovei e nada mais. Alterar um valor salvo muda o preço de orçamentos e faturas futuros, então nunca adivinhe um valor.
5. Esta rotina nunca altera uma fatura nem um orçamento. Ela apenas mantém o catálogo usado para faturá-los.
`

export const agentRecipes: AgentRecipe[] = [
  {
    id: 'billable-time-logging',
    title: 'Registro de horas faturáveis',
    description:
      'Registra as horas quando você termina um trabalho em um repositório, para que horas não faturadas não se acumulem sem aviso. A rotina só chama log_time e nunca cria nem envia nada, evitando erros do agente com valores.',
    content: timeLoggingRecipe,
  },
  {
    id: 'month-end-invoice-run',
    title: 'Emissão de faturas no fim do mês',
    description:
      'Reúne mensalmente tudo o que ainda não foi faturado por cliente e prepara as faturas como rascunhos. O agente nunca chama send_invoice, então nada chega ao cliente sem sua revisão.',
    content: monthEndRecipe,
  },
  {
    id: 'overdue-chase-drafts',
    title: 'Rascunhos de cobrança de faturas vencidas',
    description:
      'Encontra faturas vencidas e escreve e-mails de acompanhamento, mas para no rascunho. O agente nunca envia a mensagem nem altera o status da fatura. Você decide o que será enviado e quando.',
    content: overdueChaseRecipe,
  },
  {
    id: 'quote-before-you-bill',
    title: 'Faça um orçamento antes de faturar',
    description:
      'Transforma o escopo descrito em um orçamento com base nos valores salvos e para por aí. O agente nunca chama send_estimate; quando o cliente aceita, o orçamento é convertido em uma fatura como rascunho, que você ainda precisa enviar.',
    content: quoteBeforeYouBillRecipe,
  },
  {
    id: 'payment-status-check',
    title: 'Consulta do status de pagamentos',
    description:
      'Consulta o livro-caixa real de pagamentos por fatura, em vez de confiar no total da fatura, para mostrar o que foi efetivamente recebido. É somente de leitura e não informa valores quando o livro-caixa e a fatura divergem.',
    content: paymentStatusRecipe,
  },
  {
    id: 'rate-catalog-upkeep',
    title: 'Manutenção do catálogo de preços',
    description:
      'Mantém os itens salvos alinhados aos valores realmente cobrados, evitando que orçamentos e faturas sejam calculados de memória. O agente propõe cada alteração e aguarda sua aprovação antes de gravar qualquer coisa.',
    content: rateCatalogRecipe,
  },
]
