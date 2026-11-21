<!-- Gerado por app/scripts/generate-plugin-tool-reference.mjs a partir de plugins/shared/skill/references/workflows.md. Não edite. -->

# Fluxos de trabalho do Faturador

Estes são os fluxos de trabalho que o Faturador disponibiliza para agentes, reapresentados
para uso pelo servidor MCP. Eles estão escritos como procedimentos: siga as etapas na ordem
e pare onde a etapa indicar.

Todos começam pela leitura e mantêm como rascunho qualquer coisa que possa chegar a um
cliente.

## Registro de tempo faturável

Quando uma parte significativa de trabalho faturável ao cliente for concluída (um recurso,
uma correção de bug, uma revisão):

1. Estime quantas horas a tarefa realmente levou.
2. Chame `log_time` com o cliente, uma descrição do trabalho em uma linha, a data e as
   horas.
3. Não crie nem envie uma fatura. Aqui, o trabalho termina no registro do tempo; emitir uma
   fatura é uma solicitação separada.
4. Se não estiver claro a qual cliente pertence o trabalho, pergunte antes de registrá-lo.

## Emissão de faturas no fechamento do mês

Quando a solicitação for "emitir faturas de <mês>":

1. Chame `list_unbilled` para cada cliente ativo, a fim de consultar o tempo e as despesas
   não faturados, agrupados por cliente.
2. Para cada cliente com trabalho não faturado, chame `create_invoice` com os
   `time_entry_ids` e `expense_ids` desse cliente obtidos na lista, e omita `line_items`. O
   servidor calcula o preço do trabalho e vincula os registros de origem em uma única etapa.
   Não invente, arredonde nem recalcule o preço de um item.
3. Mantenha todas as faturas como **rascunho**. Nunca chame `send_invoice` nesta etapa.
4. Responda com uma tabela: cliente, total da fatura e link do painel retornado pela
   ferramenta, para que a pessoa possa revisar e enviar pelo aplicativo.

Tudo o que já estiver anexado a um rascunho desaparece de `list_unbilled`; portanto,
execute a etapa 1 uma vez por cliente e nunca passe novamente um ID que já tenha faturado.

## Rascunhos de cobrança de faturas vencidas

Quando a solicitação for "verificar faturas vencidas":

1. Chame `list_invoices` com filtro para o status vencido.
2. Chame `get_invoice_link` para cada fatura vencida a fim de obter a URL pública.
3. Elabore uma mensagem curta e cordial de acompanhamento para cada **cliente** (não para
   cada fatura), citando o número da fatura, o valor e a data de vencimento, com o link
   público. Não envie nada.
4. Inclua os rascunhos na resposta, um por cliente, para que a pessoa os edite e envie.
5. Nunca marque uma fatura como paga nem altere seus termos aqui.

## Faça uma cotação antes de faturar

Quando a solicitação for "faça uma cotação" ou "me passe um valor para isto":

1. Confirme o cliente com `list_clients`. Se o nome for ambíguo ou o cliente ainda não
   existir, pergunte antes de criar qualquer coisa.
2. Chame `list_items` e calcule o preço do escopo usando o catálogo de tarifas salvo sempre
   que houver um item correspondente. Só invente uma tarifa quando nada no catálogo se
   encaixar e, nesse caso, diga isso explicitamente.
3. Chame `create_estimate` com um item por entrega, mantendo as descrições nas palavras da
   pessoa, sem linguagem de marketing.
4. Pare no rascunho. Nunca chame `send_estimate`.
5. Responda com os itens, o total e o número da cotação. Se houver pedidos de alteração, use
   `update_draft_estimate` em vez de criar outra cotação.
6. Quando houver aceitação, chame `convert_estimate_to_invoice` se o valor total vencer de
   uma vez ou `convert_estimate_to_engagement` se o trabalho for faturado em partes.
   Mantenha a fatura resultante como **rascunho** e nunca chame `send_invoice`. Uma cotação
   pode se tornar uma coisa ou outra, nunca ambas.

## Consulta do status de pagamento

Quando a solicitação for "como estão os pagamentos" ou disser respeito a uma fatura antes de
cobrar o cliente:

1. Chame `list_invoices` com filtro para os status `sent` (enviada) e `overdue` (vencida), a fim de encontrar as
   candidatas.
2. Chame `get_payment_status` para cada fatura em vez de confiar no total da fatura. A
   ferramenta retorna o livro-razão de pagamentos, o saldo ainda devido e uma flag
   `mismatch`.
3. Se `mismatch` for `true` em alguma fatura, pare e sinalize-a pelo nome. Não informe um
   valor pago para essa fatura nem cobre o cliente: os valores divergem e uma pessoa precisa
   verificar.
4. Informe as demais em uma tabela: cliente, número da fatura, valor pago, saldo devido e
   dias de atraso.
5. Nunca chame `record_payment`, `send_invoice` nem qualquer ferramenta que edite uma
   fatura aqui. Este fluxo é somente de leitura.

## Manutenção do catálogo de tarifas

Quando a solicitação for "verificar o catálogo de tarifas" ou um preço tiver mudado:

1. Chame `list_items` e mostre os itens salvos atuais com suas tarifas.
2. Chame `list_invoices` para os últimos meses e aponte descrições de itens digitadas
   manualmente que ainda não estejam no catálogo, indicando a tarifa efetivamente cobrada.
3. Proponha as inclusões e alterações de tarifa em uma lista. Não chame `create_item` nem
   `update_item` até receber instruções sobre o que aplicar.
4. Aplique exatamente o que foi aprovado e nada mais. Uma tarifa salva altera o valor
   cobrado em todas as cotações e faturas futuras; portanto, nunca adivinhe um valor.
5. Este fluxo nunca altera uma fatura nem uma cotação.

## Sessão de faturamento de tarefa

Para trabalho de agente faturado pelo tempo ativo e pelo custo informado do provedor:

1. Consulte `list_billing_policies` para as tarifas, os multiplicadores, as moedas e os
   orçamentos aprovados por uma pessoa. Agentes não podem aprovar preços; se nada se
   encaixar, pare.
2. Chame `create_task` com o `policy_id` e um título. A tarefa começa pausada.
3. Chame `start_task` quando o trabalho ativo começar.
4. Chame `heartbeat_task` a cada 30 a 60 segundos. Somente os primeiros 120 segundos após um
   heartbeat são contabilizados. Em novas tentativas, reutilize o mesmo `request_id` para
   não contabilizar nada duas vezes.
5. Chame `pause_task` enquanto aguarda uma pessoa.
6. Chame `record_task_usage` para cada custo conhecido do provedor: provedor,
   `provider_request_id` único, custo na moeda da política e a `source` de onde veio o
   valor. Nunca estime um custo.
7. Chame `complete_task` quando todo o uso estiver registrado. Não é possível desfazer essa
   ação.
8. Chame `get_task_billing_preview` para mostrar o tempo e o uso registrados. Uma pessoa
   precisa aprovar antes de qualquer faturamento.

## Emissão de fatura de contratos

Quando a solicitação for "o que devo faturar hoje" para trabalho com valor total acordado:

1. Chame `list_ready_to_bill`. A lista abrange todos os clientes: adiantamentos de
   contratos iniciados, etapas marcadas como concluídas, pagamentos datados cuja data já
   passou e pagamentos finais de contratos concluídos. Consultar a lista não fatura nem
   envia nada.
2. Chame `get_engagement` para qualquer contrato sobre o qual haja dúvida, a fim de
   consultar o cronograma e o que já foi faturado.
3. Chame `create_invoice` com os `engagement_entry_ids` a faturar. O servidor recusa faturar
   um mesmo lançamento duas vezes.
4. Mantenha a fatura como **rascunho**.
5. Use `mark_milestone_complete` somente quando uma etapa tiver sido realmente entregue. Use
   `waive_engagement_entry` somente quando houver instrução para não cobrar um lançamento.
   Use `complete_engagement` somente quando o trabalho estiver realmente concluído; não é
   possível reabri-lo.
