# Ferramentas MCP do Faturador

<!-- Gerado por app/scripts/generate-plugin-tool-reference.mjs. Não edite. -->

Todas as ferramentas registradas pelo servidor MCP do Faturador: 53, nos
grupos usados pelo próprio app. Títulos, descrições e entradas vêm diretamente
dos contratos das ferramentas registradas, então nada aqui pode anunciar uma ferramenta
que não exista.

A coluna **Permissão necessária** indica a permissão que a conexão precisa ter
recebido. Se você não consegue ver uma ferramenta, ela não foi concedida; informe isso em vez de
tentar contornar a restrição.

`request_id` aparece nas ferramentas de escrita para garantir idempotência: gere um UUID novo
para cada operação pretendida e reutilize o mesmo, com entrada idêntica, ao
repetir uma chamada que talvez tenha sido parcialmente concluída.

## Conteúdo

- [Cobrança por tarefas](#cobran-a-por-tarefas) (8)
- [Clientes](#clientes) (4)
- [Faturas](#faturas) (6)
- [Orçamentos](#or-amentos) (6)
- [Contratos](#contratos) (9)
- [Itens salvos](#itens-salvos) (3)
- [Horas](#horas) (4)
- [Despesas](#despesas) (4)
- [Pagamentos](#pagamentos) (3)
- [Empresa e links](#empresa-e-links) (6)

## Cobrança por tarefas

Acompanhe o trabalho ativo e o uso informado conforme preços aprovados por uma pessoa.

| Ferramenta | Permissão necessária | Entrada obrigatória |
| --- | --- | --- |
| `list_billing_policies` | read | nenhum |
| `create_task` | write | `request_id`, `policy_id`, `title` |
| `start_task` | write | `request_id`, `task_id` |
| `heartbeat_task` | write | `request_id`, `task_id` |
| `pause_task` | write | `request_id`, `task_id` |
| `complete_task` | write | `request_id`, `task_id` |
| `record_task_usage` | write | `request_id`, `task_id`, `provider`, `provider_request_id`, `cost`, `currency`, `source` |
| `get_task_billing_preview` | read | `task_id` |

### `list_billing_policies`

*Listar preços aprovados*, exige **read**.

Consulte as tarifas de tarefas, os multiplicadores de uso, as moedas e os orçamentos aprovados por uma pessoa. Agentes não podem aprovar preços.

- Obrigatórios: nenhum
- Opcionais: `business_id`

### `create_task`

*Criar tarefa*, exige **write**.

Crie uma tarefa pausada usando uma política de preços aprovada por uma pessoa. Uma tarefa tem seu próprio orçamento. Em seguida, chame start_task quando o trabalho ativo começar.

- Obrigatórios: `request_id`, `policy_id`, `title`
- Opcionais: `business_id`

### `start_task`

*Iniciar tarefa*, exige **write**.

Inicie ou retome o trabalho em andamento. Envie heartbeat_task a cada 30 a 60 segundos. Apenas os primeiros 120 segundos após um heartbeat são contabilizados; enquanto aguarda uma resposta do usuário, a tarefa deve ficar pausada.

- Obrigatórios: `request_id`, `task_id`
- Opcionais: `business_id`

### `heartbeat_task`

*Registrar atividade da tarefa*, exige **write**.

Registra o tempo ativo decorrido usando marcas de data e hora do servidor, limitado a 120 segundos desde o registro anterior de atividade. Reutilize o mesmo ID da solicitação em novas tentativas para evitar contabilizar o tempo duas vezes.

- Obrigatórios: `request_id`, `task_id`
- Opcionais: `business_id`

### `pause_task`

*Pausar tarefa*, exige **write**.

Pare de contabilizar tempo enquanto aguarda ou está ocioso. Registra até 120 segundos desde o último heartbeat.

- Obrigatórios: `request_id`, `task_id`
- Opcionais: `business_id`

### `complete_task`

*concluir tarefa*, exige **write**.

Conclua uma tarefa depois de registrar todo o uso. Interrompe a contagem do tempo e congela o trabalho para revisão humana do faturamento. Esta ação não pode ser desfeita.

- Obrigatórios: `request_id`, `task_id`
- Opcionais: `business_id`

### `record_task_usage`

*Registrar uso da tarefa*, exige **write**.

Registra um custo conhecido do provedor na moeda definida pela política, com uma referência de solicitação exclusiva do provedor e uma fonte de comprovação. Esse é um custo informado, não verificado independentemente pelo Faturador. Não invente preços nem envie estimativas. Registre antes de concluir a tarefa.

- Obrigatórios: `request_id`, `task_id`, `provider`, `provider_request_id`, `cost`, `currency`, `source`
- Opcionais: `business_id`, `model`, `input_tokens`, `output_tokens`

### `get_task_billing_preview`

*Prévia de faturamento da tarefa*, exige **read**.

Consulte o tempo ativo registrado e o uso informado. O tempo não inclui intervalos em andamento que ainda não foram registrados. É necessário concluir a tarefa e obter aprovação humana antes de faturar. Os valores são arredondados por componente.

- Obrigatórios: `task_id`
- Opcionais: `business_id`

## Clientes

Consulte e mantenha a lista de clientes.

| Ferramenta | Permissão necessária | Entrada obrigatória |
| --- | --- | --- |
| `list_clients` | read | nenhum |
| `get_client` | read | `client_id` |
| `create_client` | write | `name` |
| `update_client` | write | `client_id` |

### `list_clients`

*Listar clientes*, exige **read**.

Liste os clientes de uma das empresas de quem fez a chamada, ordenados por nome. Opcionalmente, filtre por uma busca de trecho sem distinção entre maiúsculas e minúsculas no nome ou no e-mail.

- Obrigatórios: nenhum
- Opcionais: `offset`, `business_id`, `search`

### `get_client`

*Obter cliente*, exige **read**.

Busca todos os detalhes de um cliente, incluindo as cinco faturas mais recentes. O cliente deve pertencer a uma das empresas do usuário.

- Obrigatórios: `client_id`
- Opcionais: nenhum

### `create_client`

*Criar cliente*, exige **write**.

Cria um novo cliente em uma das empresas do solicitante. Retorna um erro com instruções caso já exista um cliente com o mesmo nome nessa empresa. Nesse caso, use update_client.

- Obrigatórios: `name`
- Opcionais: `business_id`, `email`, `phone`, `address_line1`, `address_line2`, `city`, `state`, `postal_code`, `country`, `currency`, `notes`

### `update_client`

*Atualizar cliente*, exige **write**.

Atualize campos de um cliente existente. Apenas os campos informados são alterados; os omitidos permanecem como estão. O cliente deve pertencer a uma das empresas do solicitante.

- Obrigatórios: `client_id`
- Opcionais: `name`, `email`, `phone`, `address_line1`, `address_line2`, `city`, `state`, `postal_code`, `country`, `currency`, `notes`

## Faturas

Crie, edite e envie faturas e registre seus pagamentos.

| Ferramenta | Permissão necessária | Entrada obrigatória |
| --- | --- | --- |
| `list_invoices` | read | nenhum |
| `get_invoice` | read | nenhum |
| `create_invoice` | write | `request_id` |
| `update_draft_invoice` | write | `invoice_id` |
| `send_invoice` | send | `request_id`, `invoice_id` |
| `record_payment` | payments | `request_id`, `invoice_id`, `amount` |

### `list_invoices`

*Listar faturas*, exige **read**.

Liste as faturas das empresas do chamador, começando pelas mais recentes. Opcionalmente, filtre por empresa, status (incluindo o status sintético 'unpaid', que corresponde a sent/viewed/partial/overdue) e/ou cliente.

- Obrigatórios: nenhum
- Opcionais: `offset`, `business_id`, `status`, `client_id`, `limit`

### `get_invoice`

*Consultar fatura*, exige **read**.

Consulte os detalhes completos de uma fatura, incluindo itens, cliente e links públicos/PDF. Identifique a fatura por invoice_id ou por invoice_number (opcionalmente limitado a uma empresa específica, se o solicitante tiver mais de uma).

- Obrigatórios: nenhum
- Opcionais: `invoice_id`, `invoice_number`, `business_id`

### `create_invoice`

*Criar fatura*, exige **write**.

Cria uma nova fatura em rascunho para um cliente, identificado por client_id ou client_name (correspondência exata, sem distinção entre maiúsculas e minúsculas). Sempre é criada como rascunho. Use send_invoice separadamente para enviá-la. Informe engagement_entry_ids para faturar o trabalho acordado de um cronograma de contrato; essas entradas serão marcadas como faturadas na mesma etapa, para que nunca sejam cobradas duas vezes.

- Obrigatórios: `request_id`
- Opcionais: `currency`, `business_id`, `client_id`, `client_name`, `line_items`, `issue_date`, `due_date`, `notes`, `status`, `time_entry_ids`, `expense_ids`, `engagement_entry_ids`, `discount_type`, `discount_value`, `tax_rate`, `shipping_amount`

### `update_draft_invoice`

*Atualizar fatura em rascunho*, exige **write**.

Atualiza uma fatura em rascunho: substitui os itens de linha e/ou ajusta datas, observações, desconto, imposto ou frete. Recusa-se a modificar faturas que já não estejam com status de rascunho. Cancele e crie novamente.

- Obrigatórios: `invoice_id`
- Opcionais: `line_items`, `notes`, `issue_date`, `due_date`, `discount_type`, `discount_value`, `tax_rate`, `shipping_amount`

### `send_invoice`

*Enviar fatura*, exige **send (apresenta um documento ao cliente)**.

Envie uma fatura (com o PDF anexado) por e-mail ao cliente, avançando o rascunho para "sent"; se `to` não for informado, o destinatário será o próprio e-mail do cliente. Recusa o envio de faturas que já estejam pagas ou canceladas.

- Obrigatórios: `request_id`, `invoice_id`
- Opcionais: `to`, `cc`, `bcc`, `subject`, `message`

### `record_payment`

*Registrar pagamento*, exige **payments (registra movimentações financeiras)**.

Registre um pagamento recebido referente a uma fatura, atualizando amount_paid/balance_due e o status da fatura ("paid" quando o saldo chega a zero; "partial" caso contrário). Corresponde ao fluxo Registrar pagamento do próprio aplicativo.

- Obrigatórios: `request_id`, `invoice_id`, `amount`
- Opcionais: `payment_date`, `method`, `notes`, `reference_number`

## Orçamentos

Prepare orçamentos e converta os aceitos em faturas.

| Ferramenta | Permissão necessária | Entrada obrigatória |
| --- | --- | --- |
| `list_estimates` | read | nenhum |
| `get_estimate` | read | `estimate_id` |
| `create_estimate` | write | `request_id`, `line_items` |
| `update_draft_estimate` | write | `estimate_id` |
| `send_estimate` | send | `request_id`, `estimate_id` |
| `convert_estimate_to_invoice` | write | `estimate_id` |

### `list_estimates`

*Listar orçamentos*, exige **read**.

Liste os orçamentos das empresas de quem fez a chamada, do mais recente para o mais antigo, com opção de filtrar por empresa, status ou cliente. Use para responder "quais orçamentos estão pendentes". Orçamentos NÃO são faturas e nunca têm saldo em aberto; use list_invoices para qualquer questão sobre valores devidos.

- Obrigatórios: nenhum
- Opcionais: `offset`, `business_id`, `status`, `client_id`, `limit`

### `get_estimate`

*Consultar estimativa*, exige **read**.

Consulte uma estimativa completa: itens, totais, cliente, status e link compartilhável. Use antes de update_draft_estimate ou convert_estimate_to_invoice para editar o conteúdo atual, e não algo presumido. Não retorna informações de pagamento ou saldo, porque uma estimativa não é uma fatura; use get_payment_status para consultar valores devidos.

- Obrigatórios: `estimate_id`
- Opcionais: nenhum

### `create_estimate`

*Criar orçamento*, exige **write**.

Elabore um novo orçamento para um cliente, identificado por client_id ou client_name. Use quando o trabalho ainda não foi aprovado e o cliente precisa primeiro saber o preço. Sempre é criado como rascunho: chame send_estimate para enviá-lo e, depois que for aceito, convert_estimate_to_invoice. NÃO use para trabalho já entregue; nesse caso, a ferramenta correta é create_invoice.

- Obrigatórios: `request_id`, `line_items`
- Opcionais: `business_id`, `client_id`, `client_name`, `issue_date`, `expiry_date`, `notes`, `terms`, `discount_type`, `discount_value`, `tax_rate`, `shipping_amount`

### `update_draft_estimate`

*Atualizar estimativa em rascunho*, exige **write**.

Atualiza uma estimativa em rascunho: substitui os itens de linha e/ou ajusta datas, observações, condições, desconto, imposto ou frete. Recusa-se a alterar uma estimativa que já tenha sido enviada, aceita, recusada ou convertida, pois o cliente já viu esses valores; crie uma nova estimativa.

- Obrigatórios: `estimate_id`
- Opcionais: `line_items`, `issue_date`, `expiry_date`, `notes`, `terms`, `discount_type`, `discount_value`, `tax_rate`, `shipping_amount`

### `send_estimate`

*Enviar orçamento*, exige **send (apresenta um documento ao cliente)**.

Envie um orçamento por e-mail ao cliente e avance o rascunho para "sent". Por padrão, o destinatário é o próprio e-mail do cliente. Use quando o orçamento estiver finalizado; isso não cria uma fatura nem recebe pagamentos. Recusa orçamentos que já foram convertidos em fatura.

- Obrigatórios: `request_id`, `estimate_id`
- Opcionais: `to`, `cc`, `bcc`, `subject`, `message`

### `convert_estimate_to_invoice`

*Converter orçamento em fatura*, exige **write**.

Transforma um orçamento em uma fatura em rascunho, mantendo os mesmos itens, moeda, observações e condições; em seguida, marca o orçamento como "converted" e vincula os dois. Use quando o cliente tiver concordado. Isso NÃO envia a fatura; depois, chame send_invoice. Recusa orçamentos que já tenham sido convertidos, recusados ou expirados.

- Obrigatórios: `estimate_id`
- Opcionais: `issue_date`, `due_date`

## Contratos

Fature os valores acordados conforme um cronograma, sem envios automáticos.

| Ferramenta | Permissão necessária | Entrada obrigatória |
| --- | --- | --- |
| `list_engagements` | read | nenhum |
| `get_engagement` | read | `engagement_id` |
| `list_ready_to_bill` | read | nenhum |
| `create_engagement` | write | `request_id`, `name`, `total`, `billing_mode` |
| `update_engagement` | write | `request_id`, `engagement_id` |
| `mark_milestone_complete` | write | `request_id`, `entry_id` |
| `complete_engagement` | write | `request_id`, `engagement_id` |
| `waive_engagement_entry` | write | `request_id`, `entry_id`, `reason` |
| `convert_estimate_to_engagement` | write | `request_id`, `estimate_id`, `billing_mode` |

### `list_engagements`

*Listar contratos*, exige **read**.

Liste os contratos: trabalhos acordados com um total e um cronograma de pagamentos, por exemplo, "12,000 pela reconstrução do site, 50% antecipadamente e 50% na entrega". Use para responder "o que foi acordado com este cliente" ou "o que ainda não foi faturado neste projeto". Cada contrato informa quanto já foi faturado, quanto falta e quantas parcelas do cronograma estão prontas para faturar agora. Somente leitura; as ferramentas de contratos nunca enviam nada a um cliente.

- Obrigatórios: nenhum
- Opcionais: `offset`, `business_id`, `client_id`, `status`, `has_ready_to_bill`, `limit`

### `get_engagement`

*Consultar contrato*, exige **read**.

Consulte um contrato completo: o total acordado, o que já foi faturado, o que falta e cada item do cronograma, com seu status, regra de vencimento e a fatura em que se tornou. Use antes de faturar para cobrar os itens que estão prontos, e não os que já foram faturados. Somente leitura; nada é enviado a ninguém.

- Obrigatórios: `engagement_id`
- Opcionais: nenhum

### `list_ready_to_bill`

*Listar itens prontos para faturar*, exige **read**.

Lista todas as parcelas do cronograma de pagamento de contratos que estão prontas para faturar agora, em todos os clientes. Esta é a lista de “o que devo faturar hoje”: adiantamentos de contratos iniciados, marcos marcados como concluídos, pagamentos com data vencida e pagamentos finais de contratos concluídos. Nada aqui foi faturado ainda, e consultar a lista não envia nada a ninguém. Somente leitura.

- Obrigatórios: nenhum
- Opcionais: `offset`, `business_id`, `client_id`, `limit`

### `create_engagement`

*Criar contrato de serviço*, exige **write**.

Registre um serviço acordado, com valor total e cronograma de pagamentos, por exemplo, "12,000 pela reformulação, 50% de entrada e 50% na entrega" ou "9,000 em 3 parcelas iguais". O cronograma é calculado no servidor para que os valores sempre totalizem exatamente o valor total; a última parcela absorve qualquer diferença de arredondamento. Criar um contrato não gera cobranças nem envia nada: as parcelas ficam prontas para cobrança quando suas regras de vencimento forem acionadas; depois, você emite uma fatura para elas. Use create_estimate se o preço ainda não tiver sido acordado e create_invoice se o trabalho já tiver sido entregue e precisar ser cobrado agora.

- Obrigatórios: `request_id`, `name`, `total`, `billing_mode`
- Opcionais: `business_id`, `client_id`, `client_name`, `currency`, `entries`, `installments`, `start_now`, `starts_on`, `target_end`, `notes`, `source_estimate_id`

### `update_engagement`

*Atualizar projeto contratado*, exige **write**.

Corrige detalhes de um projeto contratado: nome, datas de início e término ou notas internas. Os campos omitidos permanecem como estão. O total acordado, a moeda, a modalidade de cobrança e o cronograma não podem ser editados aqui, pois alterar um valor acordado depois de já ter sido usado para cobrar pelo trabalho é uma renegociação, não uma edição. Nada é enviado a ninguém.

- Obrigatórios: `request_id`, `engagement_id`
- Opcionais: `name`, `starts_on`, `target_end`, `notes`

### `mark_milestone_complete`

*Marcar marco como concluído*, exige **write**.

Registre que uma etapa do cronograma foi entregue. Uma etapa aguardando um marco fica pronta para faturamento; uma etapa aguardando o início ou o fim do contrato, ou uma data, mantém sua própria regra e simplesmente recebe o registro de conclusão. Nada é faturado nem enviado: use list_ready_to_bill para ver o que ficou disponível e, em seguida, emita uma fatura.

- Obrigatórios: `request_id`, `entry_id`
- Opcionais: nenhum

### `complete_engagement`

*Concluir contrato*, exige **write**.

Encerre um contrato: o trabalho foi concluído. Cada etapa do cronograma que aguardava a conclusão fica pronta para faturar, e, se ainda houver algum valor não faturado, a resposta informa quanto, para que nada seja esquecido. Concluir não gera fatura nem envia nada. Um contrato concluído não pode ser reaberto, então faça isso quando o trabalho realmente estiver terminado.

- Obrigatórios: `request_id`, `engagement_id`
- Opcionais: nenhum

### `waive_engagement_entry`

*Dispensar item do contrato*, exige **write**.

Baixe um item do cronograma que não será cobrado, informando um motivo. O item permanece no cronograma para que o acordo continue refletindo o que foi combinado, mas deixa de contar no saldo restante a faturar. Use quando parte do trabalho for cancelada ou absorvida. Um item já faturado não pode ser dispensado: isso exige uma nota de crédito, que deve ser emitida na fatura. Nada é enviado a ninguém.

- Obrigatórios: `request_id`, `entry_id`, `reason`
- Opcionais: nenhum

### `convert_estimate_to_engagement`

*Converter orçamento em contrato*, exige **write**.

Transforme um orçamento aceito em um contrato: o mesmo cliente, o mesmo total e a mesma moeda, agora com um cronograma de pagamentos em vez de uma única cobrança. Use esta ferramenta quando o orçamento tiver sido aprovado, mas o trabalho for faturado em parcelas; use convert_estimate_to_invoice quando o valor total vencer de uma só vez. Um orçamento pode se tornar uma coisa ou outra, nunca ambas, então esta ferramenta recusa um orçamento que já tenha se tornado uma fatura ou um contrato. O contrato é criado como rascunho e nada é faturado nem enviado: inicie-o quando o trabalho começar; é isso que deixa qualquer entrada de sinal pronta para faturar.

- Obrigatórios: `request_id`, `estimate_id`, `billing_mode`
- Opcionais: `entries`, `installments`

## Itens salvos

Catálogo de preços que pode ser usado pelo nome em faturas e estimativas.

| Ferramenta | Permissão necessária | Entrada obrigatória |
| --- | --- | --- |
| `list_items` | read | nenhum |
| `create_item` | write | `name`, `rate` |
| `update_item` | write | nenhum |

### `list_items`

*Listar itens salvos*, exige **read**.

Lista o catálogo de produtos e serviços salvos de uma empresa, com a tarifa registrada de cada item. Use antes de create_invoice ou create_estimate quando o usuário mencionar um serviço ("Consultoria", "Contrato contínuo de design"), para cobrar a tarifa salva em vez de adivinhar. Não use para consultar o que foi cobrado em uma fatura específica; use get_invoice.

- Obrigatórios: nenhum
- Opcionais: `offset`, `business_id`, `search`, `include_inactive`, `limit`

### `create_item`

*Criar item salvo*, exige **write**.

Adicione um produto ou serviço ao catálogo salvo para que faturas e orçamentos futuros possam incluí-lo pelo nome com uma tarifa consistente. Use quando o usuário disser "minha tarifa para X é Y" ou quiser um item reutilizável. NÃO use para adicionar um item avulso a uma fatura existente; em vez disso, passe line_items para create_invoice ou update_draft_invoice.

- Obrigatórios: `name`, `rate`
- Opcionais: `business_id`, `description`, `unit`, `type`, `tax_rate`

### `update_item`

*Atualizar item salvo*, exige **write**.

Altere a tarifa, o nome, a descrição, a unidade ou o status de ativo de um item salvo. Identifique-o por item_id ou pelo item_name exato. As alterações se aplicam apenas a faturas e estimativas FUTURAS; documentos já emitidos mantêm a tarifa pela qual foram cobrados. Portanto, não use esta ferramenta para corrigir uma fatura (use update_draft_invoice).

- Obrigatórios: nenhum
- Opcionais: `business_id`, `item_id`, `item_name`, `name`, `rate`, `description`, `unit`, `type`, `tax_rate`, `is_active`

## Horas

Registre e corrija horas trabalhadas antes de faturá-las.

| Ferramenta | Permissão necessária | Entrada obrigatória |
| --- | --- | --- |
| `log_time` | write | `request_id`, `description`, `hours` |
| `list_time_entries` | read | nenhum |
| `update_time_entry` | write | `time_entry_id` |
| `delete_time_entry` | delete | `time_entry_id` |

### `log_time`

*Registrar horas*, exige **write**.

Registra um lançamento de horas para um cliente, identificado por client_id ou client_name (correspondência exata, sem diferenciar maiúsculas de minúsculas). Por padrão, as horas podem ser cobradas.

- Obrigatórios: `request_id`, `description`, `hours`
- Opcionais: `business_id`, `client_id`, `client_name`, `date`, `rate`, `billable`

### `list_time_entries`

*Listar lançamentos de tempo*, exige **read**.

Liste o tempo registrado, filtrado por cliente, intervalo de datas e status de faturamento. Use isto para responder a "quantas horas dediquei a X" ou encontrar o lançamento a corrigir. Para preparar uma fatura com trabalho não faturado, prefira list_unbilled, que agrupa por cliente e calcula os totais.

- Obrigatórios: nenhum
- Opcionais: `offset`, `business_id`, `client_id`, `client_name`, `from`, `to`, `billed`, `billable`, `limit`

### `update_time_entry`

*Atualizar lançamento de tempo*, exige **write**.

Corrija um único lançamento de tempo: suas horas, taxa, descrição, data, cliente ou sinalizador de faturamento. Use para corrigir um erro antes de o trabalho ser faturado. Recusa lançamentos já associados a uma fatura, pois alterá-los não mudaria a fatura recebida pelo cliente.

- Obrigatórios: `time_entry_id`
- Opcionais: `description`, `hours`, `date`, `rate`, `client_id`, `client_name`, `billable`

### `delete_time_entry`

*Excluir registro de horas*, exige **delete (remove um registro)**.

Exclui permanentemente UM registro de horas pelo ID e retorna o que foi excluído para que possa ser registrado novamente caso tenha sido um engano. Não há exclusão em lote nem exclusão baseada em filtros, intencionalmente. Recusa registros já vinculados a uma fatura. Prefira update_time_entry quando o registro estiver incorreto, e não quando for indesejado.

- Obrigatórios: `time_entry_id`
- Opcionais: nenhum

## Despesas

Registre e corrija despesas, faturáveis ou não.

| Ferramenta | Permissão necessária | Entrada obrigatória |
| --- | --- | --- |
| `log_expense` | write | `request_id`, `description`, `amount` |
| `list_expenses` | read | nenhum |
| `update_expense` | write | `expense_id` |
| `delete_expense` | delete | `expense_id` |

### `log_expense`

*Registrar despesa*, exige **write**.

Registra uma despesa da empresa. O cliente é opcional; identifique-o por client_id ou client_name (correspondência exata, sem diferenciar maiúsculas de minúsculas) para vincular a despesa e poder cobrá-la posteriormente.

- Obrigatórios: `request_id`, `description`, `amount`
- Opcionais: `business_id`, `client_id`, `client_name`, `date`, `category`, `billable`

### `list_expenses`

*Listar despesas*, exige **read**.

Liste despesas filtradas por categoria, cliente, período e status de cobrança, com totais agrupados por moeda. Use para responder a perguntas como "quanto gastei com software no último trimestre" ou para encontrar uma despesa a corrigir. Para cobrar de um cliente custos ainda não faturados, prefira list_unbilled.

- Obrigatórios: nenhum
- Opcionais: `offset`, `business_id`, `category`, `client_id`, `client_name`, `from`, `to`, `billed`, `billable`, `limit`

### `update_expense`

*Atualizar despesa*, exige **write**.

Corrige uma única despesa registrada: valor, descrição, fornecedor, categoria, data, cliente ou indicador de faturável. Use para corrigir um erro antes de cobrar esse custo novamente. Não é permitido atualizar despesas já vinculadas a uma fatura, pois alterá-las não mudaria a fatura recebida pelo cliente.

- Obrigatórios: `expense_id`
- Opcionais: `description`, `amount`, `date`, `category`, `vendor`, `notes`, `client_id`, `client_name`, `billable`

### `delete_expense`

*Excluir despesa*, exige **delete (remove um registro)**.

Exclua permanentemente UMA despesa pelo seu ID, retornando o que foi excluído para que possa ser registrado novamente se isso tiver sido um engano. Não há exclusão em lote nem exclusão baseada em filtros, intencionalmente. Recusa despesas já vinculadas a uma fatura. Prefira update_expense quando a despesa estiver apenas incorreta, e não for indesejada.

- Obrigatórios: `expense_id`
- Opcionais: nenhum

## Pagamentos

Confira o que foi pago e o que ainda está pendente; corrija ou anule pagamentos registrados incorretamente.

| Ferramenta | Permissão necessária | Entrada obrigatória |
| --- | --- | --- |
| `get_payment_status` | read | `invoice_id` |
| `update_payment` | payments | `request_id`, `payment_id` |
| `void_payment` | payments | `request_id`, `payment_id`, `reason` |

### `get_payment_status`

*Consultar status do pagamento*, exige **read**.

Informe a situação financeira de uma fatura: valor devido, valor pago, cada pagamento registrado com seu payment_id, se o pagamento online com cartão está habilitado e o link pelo qual o cliente pode pagar. Use para responder a perguntas como "X já pagou?" ou "quanto ainda falta pagar?". Pagamentos anulados são excluídos da lista e de todos os totais, a menos que include_voided seja true. Somente leitura: use record_payment para registrar um pagamento recebido fora do Stripe, update_payment para corrigir um pagamento e void_payment para anulá-lo.

- Obrigatórios: `invoice_id`
- Opcionais: `include_voided`

### `update_payment`

*Atualizar pagamento*, exige **payments (registra movimentações financeiras)**.

Corrija um pagamento registrado: a data em que foi recebido, o método, o número de referência, as observações ou o valor, caso tenha sido digitado incorretamente. A fatura é recalculada com base nos pagamentos ativos; portanto, um valor menor reabre o saldo e faz uma fatura paga voltar ao status parcial. Use esta ferramenta para corrigir a data de um pagamento registrada incorretamente, que, caso contrário, colocaria o valor no mês errado em todos os relatórios de receita. Pagamentos recebidos pelo Stripe não podem ser editados: um pagamento com cartão deve ser alterado emitindo um reembolso no Stripe, que aparece aqui como um lançamento próprio no razão. Os campos omitidos permanecem como estão.

- Obrigatórios: `request_id`, `payment_id`
- Opcionais: `payment_date`, `method`, `notes`, `reference_number`, `amount`

### `void_payment`

*Anular pagamento*, exige **payments (registra movimentações financeiras)**.

Anule um pagamento que nunca deveria ter sido registrado, informando um motivo. O registro é mantido e continua visível, riscado e com o motivo, mas deixa de contar como dinheiro: a fatura volta a ter esse valor em aberto, e todos os totais, relatórios e listas o desconsideram. Use para um pagamento lançado duas vezes, associado à fatura errada ou registrado para um valor que nunca foi recebido. Pagamentos recebidos pelo Stripe não podem ser anulados: reembolse a cobrança no Stripe; o reembolso aparecerá aqui como um lançamento próprio no livro-razão.

- Obrigatórios: `request_id`, `payment_id`, `reason`
- Opcionais: nenhum

## Empresa e links

Configurações da empresa, resumos de faturamento e links compartilháveis.

| Ferramenta | Permissão necessária | Entrada obrigatória |
| --- | --- | --- |
| `get_profile` | read | nenhum |
| `get_business` | read | nenhum |
| `list_businesses` | read | nenhum |
| `revenue_summary` | read | nenhum |
| `get_invoice_link` | read | `invoice_id` |
| `list_unbilled` | read | nenhum |

### `get_profile`

*Consultar perfil*, exige **read**.

Retorna a conta Faturador usada para entrar por esta conexão: um ID opaco e estável, o nome e o endereço de e-mail. Use para confirmar qual login Faturador está conectado; use list_businesses para consultar as empresas nas quais ele pode atuar.

- Obrigatórios: nenhum
- Opcionais: nenhum

### `get_business`

*Obter empresa*, exige **read**.

Busca os detalhes de uma das empresas do usuário: nome, e-mail de contato, moeda e numeração de faturas. Se a chave de API estiver vinculada a uma única empresa, business_id pode ser omitido.

- Obrigatórios: nenhum
- Opcionais: `business_id`

### `list_businesses`

*Listar empresas*, exige **read**.

Liste todas as empresas às quais esta chave de API pode ter acesso, ordenadas pelo nome. Chame esta ferramenta primeiro se não souber qual business_id passar às outras ferramentas. Se apenas uma empresa for retornada, business_id pode ser omitido em todos os casos.

- Obrigatórios: nenhum
- Opcionais: nenhum

### `revenue_summary`

*Resumo da receita*, exige **read**.

Resume os valores faturados, pagos, pendentes e vencidos de uma das empresas de quem fez a chamada durante um período (padrão: this_year), além das contagens por status e dos 5 principais clientes por valor faturado. Faturas em rascunho e canceladas são excluídas de todos os totais em dólares (mas ainda são contabilizadas em by_status); “overdue” significa saldo ainda devido, data de vencimento passada e status sent/viewed/partial; overdue_total é uma parte de outstanding_total, não um valor adicional a ele.

- Obrigatórios: nenhum
- Opcionais: `business_id`, `period`

### `get_invoice_link`

*Obter link da fatura*, exige **read**.

Obtenha o link público compartilhável e o link para baixar o PDF de uma fatura. A fatura deve pertencer a uma das empresas do solicitante.

- Obrigatórios: `invoice_id`
- Opcionais: nenhum

### `list_unbilled`

*Listar trabalho não faturado*, exige **read**.

Liste lançamentos de tempo faturáveis e despesas ainda não vinculados a uma fatura, agrupados por cliente e com os totais. Use isto para preparar uma fatura com o trabalho não faturado de um cliente; lançamentos sem valor por hora são sinalizados. Lançamentos faturáveis sem cliente não podem ser agrupados em uma fatura de cliente, portanto ficam de fora de `clients`, mas ainda aparecem no resumo e no campo `unassigned`.

- Obrigatórios: nenhum
- Opcionais: `offset`, `business_id`, `client_id`
