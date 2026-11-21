---
name: billr
description: Fature clientes pelo Faturador. Use ao registrar tempo ou despesas faturáveis, criar ou conferir uma fatura ou cotação, perguntar o que não foi faturado ou está vencido, verificar um saldo ou pagamento, executar uma sessão de faturamento de tarefa de agente ou trabalhar com o cronograma de um contrato. Permite leituras, cria rascunhos quando solicitado e nunca envia nada a um cliente.
version: 1.2.0
---

# Faturador

Esta skill upstream conecta-se ao serviço Billr hospedado em `https://mcp.billr.cc`, do projeto de origem `ethanplusai/billr`; esse serviço não é o Faturador auto-hospedado. É necessária uma conta do serviço upstream e o acesso permitido pelo plano dele; instalar esta skill não cria uma conta nem inclui uma assinatura. Nunca peça uma senha ou um token no chat. Para usar uma instalação auto-hospedada do Faturador, use a URL MCP fornecida pela pessoa operadora, configure a conexão com o alias local `faturador` e confirme o serviço pretendido antes de autorizar.

O Faturador é um sistema de faturamento e cobrança para profissionais independentes e
pequenos estúdios. Esta skill explica como usar bem seu servidor MCP.

**A única regra.** Você pode ler tudo o que estiver dentro do escopo da conexão. Pode criar
rascunhos. Nunca movimenta dinheiro nem coloca um documento diante de um cliente sem que a
pessoa solicite isso, na mesma interação. Enviar uma fatura ou cotação, registrar um
pagamento, anular um pagamento e excluir um lançamento são ações irreversíveis que afetam o
dinheiro de outra pessoa.

## Antes da primeira chamada

1. Chame `list_businesses`. Uma conexão pode estar limitada a uma empresa ou a várias. Se
   houver mais de uma e a solicitação não indicar uma, pergunte qual usar antes de gravar
   qualquer coisa.
2. Chame `get_business` para consultar a moeda, as configurações de impostos e a numeração
   das faturas antes de cotar ou criar um valor. Nunca presuma uma moeda.
3. Se uma ferramenta esperada não aparecer na lista, a conexão não recebeu essa permissão.
   Diga isso claramente, em vez de contornar a restrição.

`references/tools.md` contém a lista completa de ferramentas, o que cada uma faz e do que
precisa. Consulte-a se não tiver certeza de que uma ferramenta existe; não tente adivinhar
um nome.

## Cartões no ChatGPT e no Codex

No ChatGPT, e no Codex dentro do aplicativo de desktop do ChatGPT quando ele os exibe,
quatro ferramentas mostram um cartão do Faturador abaixo da sua resposta: `get_invoice`,
`get_estimate`, `revenue_summary` e `list_ready_to_bill`. Quando a pessoa pedir para *ver*
uma fatura, uma cotação, a receita ou o que está pronto para faturar, chame essa ferramenta
em vez de descrever os dados em prosa; o cartão os apresenta, então limite seu texto a uma
frase.

Os botões do cartão nunca agem por conta própria. Cada botão envia uma mensagem em nome da
pessoa, como "Envie a fatura INV-0042 para Harbor & Lane." Trate essa mensagem exatamente
como uma solicitação digitada: é a pessoa pedindo, nesta interação, portanto o envio
identificado é permitido. Se o destinatário não estiver claro, confirme-o e nunca amplie o
escopo além do que a mensagem diz.

## Autenticação e escopos

O plugin distribuído conecta-se ao serviço upstream Billr em `https://mcp.billr.cc`, não ao Faturador auto-hospedado. Um operador de instalação
auto-hospedada pode escolher explicitamente o endpoint `/api/mcp` da própria origem. Há dois
métodos de autenticação:

- **OAuth (preferencial).** O cliente só precisa da URL. Ele descobre o servidor de
  autorização do serviço indicado por essa URL, registra-se e encaminha a pessoa a uma tela de consentimento
  onde ela escolhe a empresa e as permissões. Os tokens expiram após 30 dias e são renovados
  automaticamente.
- **Chave de API.** Use uma chave `billr_sk_` emitida pelo mesmo serviço indicado pelo
  endpoint configurado. Não reutilize uma chave do Faturador auto-hospedado com o endpoint
  `https://mcp.billr.cc`, nem uma chave do Billr hospedado com o endpoint de outra instalação.
  Envie-a como `Authorization: Bearer <key>`. A chave é exibida uma única vez, expira após
  90 dias e pode ser revogada a qualquer momento.

Há cinco permissões: `read`, `write`, `send`, `delete` e `payments`. Os perfis nomeados são:

| Perfil | Permissões | O que pode fazer |
| --- | --- | --- |
| Somente leitura | `read` | Consultar tudo, sem alterar nada |
| Leitura e rascunho | `read`, `write` | Também criar e editar rascunhos e registrar tempo e despesas |
| Faturamento | `read`, `write`, `send`, `payments` | Também enviar documentos e registrar pagamentos |
| Completo | Todas as cinco | Também excluir registros de tempo e despesas |

Peça o perfil mais restrito que permita realizar o trabalho. Leitura e rascunho é a opção
padrão correta para quase tudo nesta skill.

**Nunca grave uma chave em um arquivo.** Nem em um arquivo de configuração que você edite,
nem em um `.mcp.json` enviado ao Git, nem em uma nota temporária, nem na sua resposta. Se o
cliente aceitar interpolação de variáveis de ambiente, use-a (`${BILLR_API_KEY}`,
`bearer_token_env_var`, `${env:BILLR_API_KEY}` ). Nunca mostre uma chave, nunca execute um
comando que a imprima e nunca a cole em uma transcrição. Se encontrar uma chave em um
arquivo que a pessoa esteja usando, avise-a e pare.

## Padrões seguros

- **Leia antes de gravar.** Cada fluxo abaixo começa com uma chamada de lista ou consulta.
  Nunca crie um cliente, uma fatura ou uma cotação com base apenas em um nome mencionado em
  uma frase.
- **Crie rascunhos, nunca envie.** `create_invoice` e `create_estimate` criam rascunhos.
  Mantenha-os assim. `send_invoice` e `send_estimate` colocam um documento na caixa de
  entrada de um cliente; só os chame quando a pessoa disser para enviar, identificando o
  documento, nesta interação.
- **Confirme os valores em voz alta.** Antes de qualquer chamada de ferramenta que envolva
  dinheiro, informe o cliente, o valor e a moeda, e repita a origem do número: um item
  salvo, um registro de tempo ou o total de uma cotação. Nunca arredonde, recalcule o preço
  nem invente uma tarifa.
- **Prefira o cálculo do servidor.** Se tiver `time_entry_ids`, `expense_ids` ou
  `engagement_entry_ids`, informe esses IDs e omita `line_items`. O servidor calcula o
  preço do trabalho e vincula os registros de origem em uma única etapa, evitando cobranças
  duplicadas e divergências em relação ao trabalho registrado.
- **Use `request_id` corretamente.** A maioria das ferramentas de escrita recebe um UUID
  `request_id` para garantir idempotência. Gere um ID novo para cada operação pretendida e,
  ao repetir uma chamada que talvez tenha sido parcialmente concluída, reutilize o mesmo ID
  com entradas idênticas. Um ID novo na repetição pode gerar cobrança duplicada.
- **Uma ambiguidade, uma pergunta.** Se o nome do cliente for ambíguo, a tarifa não estiver
  no catálogo ou a data não estiver clara, pergunte. Não escolha a opção mais provável para
  prosseguir.

## Fluxos de trabalho principais

O texto completo de cada fluxo está em `references/workflows.md`. Em resumo:

- **Registrar tempo faturável.** Use `log_time` para registrar o tempo do cliente, as horas,
  a data e uma descrição em uma linha. Nada mais. O faturamento é uma solicitação separada.
- **Emissão de faturas no fechamento do mês.** Use `list_unbilled` para cada cliente e,
  depois, `create_invoice` com os `time_entry_ids` e `expense_ids` retornados. Todas as
  faturas permanecem como rascunho. Apresente uma tabela e pare.
- **Cobrança de faturas vencidas.** Use `list_invoices` com filtro para vencidas e
  `get_invoice_link` para obter a URL pública; em seguida, escreva as mensagens de
  acompanhamento na resposta. Nunca as envie nem altere o status da fatura.
- **Faça uma cotação antes de faturar.** Use `list_clients` e, depois, `list_items` para
  calcular o preço usando o catálogo de tarifas salvo; então chame `create_estimate`. Pare
  no rascunho. Mais tarde, após a aceitação, use `convert_estimate_to_invoice` (uma
  cobrança) ou `convert_estimate_to_engagement` (cobrança em partes). Uma cotação pode se
  transformar em uma opção ou na outra, nunca em ambas.
- **Status de pagamento.** Use `list_invoices` para faturas enviadas e vencidas e, depois,
  `get_payment_status` para cada fatura, em vez de confiar no total da fatura. Se `mismatch`
  for `true`, pare, identifique a fatura e não informe um valor pago para ela. Todo o fluxo
  é somente de leitura.
- **Manutenção do catálogo de tarifas.** Use `list_items`, proponha inclusões e alterações
  e aplique somente o que tiver sido aprovado. Alterar uma tarifa salva muda o valor de
  todas as cotações futuras.

## Sessões de faturamento de tarefas

Para trabalho de agente faturado pelo tempo ativo e pelo custo informado do provedor:

1. `list_billing_policies` consulta as tarifas, os multiplicadores, as moedas e os
   orçamentos já aprovados por uma pessoa. **Agentes não podem aprovar preços.** Se nenhuma
   política se encaixar, pare e informe isso.
2. Chame `create_task` com um `policy_id` e um título. A tarefa começa pausada e tem
   orçamento próprio.
3. Chame `start_task` quando o trabalho ativo começar.
4. Chame `heartbeat_task` a cada 30 a 60 segundos enquanto estiver trabalhando. Só os
   primeiros 120 segundos após um heartbeat são contabilizados; portanto, uma interrupção
   conta como tempo não faturado, não como cortesia. Repita um heartbeat com o mesmo
   `request_id` para que não seja contabilizado duas vezes.
5. Chame `pause_task` sempre que estiver aguardando uma pessoa. Esperar não é trabalhar.
6. Use `record_task_usage` para cada custo conhecido do provedor, informando o provedor, um
   `provider_request_id` único, o custo na moeda da política e a `source` de onde veio o
   valor. Este é um custo informado, não verificado pelo Faturador. Nunca estime nem invente
   um preço.
7. Chame `complete_task` depois de registrar todo o uso. Isso para o relógio e congela o
   trabalho para revisão humana do faturamento; não é possível desfazer essa ação.
8. `get_task_billing_preview` mostra os segundos ativos registrados e o uso informado. É uma
   prévia. A conclusão da tarefa e a aprovação de uma pessoa são necessárias antes de
   qualquer faturamento.

## Contratos

Um contrato é um valor total acordado, faturado conforme um cronograma: divisões
percentuais, parcelas iguais, etapas ou lançamentos manuais. Contratos não enviam nada por
conta própria.

- `list_ready_to_bill` é a lista de "o que devo faturar hoje" para todos os clientes:
  adiantamentos de contratos iniciados, etapas concluídas, pagamentos com data já vencida e
  pagamentos finais de contratos concluídos. Consultar a lista não fatura nem envia nada.
- Fature um lançamento passando seu `engagement_entry_ids` para `create_invoice`. O
  servidor recusa faturar o mesmo lançamento duas vezes.
- Use `mark_milestone_complete` quando uma etapa tiver sido realmente entregue; isso a deixa
  pronta para faturamento. `waive_engagement_entry` descarta um lançamento que não será
  cobrado.
- `complete_engagement` encerra o trabalho: todos os lançamentos que aguardavam a conclusão
  ficam prontos para faturamento, e a resposta identifica qualquer valor que ainda não tenha
  sido faturado. Não é possível reabrir um contrato, portanto use essa ação somente quando o
  trabalho estiver realmente concluído.

## Regras de pagamento

- `record_payment` registra dinheiro que **já chegou** por fora do Faturador: transferência
  bancária, cheque ou dinheiro em espécie. Registre somente um pagamento cujo recebimento a
  pessoa tenha confirmado. Nunca registre um pagamento porque parece que uma fatura deveria
  ter sido paga, nem para ajustar um saldo.
- Faça correções por meio de `update_payment` (data, método, referência, observações
  incorretos ou valor digitado incorretamente) e `void_payment` (registro duplicado,
  associado à fatura errada, ou dinheiro que nunca chegou; é necessário informar um motivo).
  A fatura é recalculada com base nos pagamentos válidos, portanto um valor menor reabre um
  saldo. Não registre um pagamento negativo ou compensatório para desfazer algo.
- Uma data de pagamento no mês errado desloca o dinheiro para o mês errado em todos os
  relatórios de receita. Corrija a data com `update_payment` em vez de anular e registrar
  novamente.
- **Pagamentos do Stripe só permitem reembolso.** Pagamentos cobrados pelo Stripe não podem
  ser editados nem anulados aqui. Para alterar um pagamento com cartão, faça um reembolso no
  Stripe; ele retornará ao Faturador como um lançamento próprio no livro-razão. Se uma
  ferramenta recusar por esse motivo, explique e indique o Stripe; não tente contornar a
  restrição.

## Tratamento de erros

- **429 com `Retry-After: 60`.** O limite do MCP por chave é de 120 solicitações por 60
  segundos. Aguarde o intervalo indicado e agrupe as leituras; não sobrecarregue uma
  ferramenta de lista chamando-a para cada linha.
- **`plan_required: ...`.** A empresa do serviço upstream Billr hospedado não tem um plano ativo; por isso, todas as
  gravações são recusadas, enquanto as leituras continuam funcionando. Informe o problema e
  pare de gravar; a pessoa deve resolvê-lo na área de cobrança desse serviço. Esse erro de
  plano não se aplica a uma instalação auto-hospedada do Faturador.
- **"API key is expired, revoked or lacks permission for this tool."** A chave foi revogada
  ou expirou durante a sessão, ou a conexão nunca teve essa permissão. Pare e diga à pessoa
  para reconectar ou conceder a permissão. Não repita a chamada.
- **401 ao conectar.** O cliente não tem um token válido. Em uma conexão OAuth, isso
  significa reconectar; com uma chave, significa que ela está incorreta, revogada ou
  expirada. Uma chave inválida retorna 401, nunca uma lista vazia; portanto, um resultado
  vazio realmente significa que a conta está vazia.
- **Erro genérico "not found or not accessible".** Registros inexistentes e fora do escopo
  retornam deliberadamente o mesmo erro, então não é possível descobrir se algo existe.
  Considere a mensagem pelo que ela diz.
- **Gravação com resultado incerto.** Leia antes de repetir e use o `request_id` original
  com entradas idênticas.

## Nunca faça

- Envie uma fatura ou cotação que não tenha sido solicitada nesta interação.
- Registre, edite ou anule um pagamento cujo recebimento a pessoa não tenha confirmado.
- Exclua um registro de tempo ou uma despesa para "arrumar" os dados.
- Invente uma tarifa, um cliente, uma data ou um custo de provedor.
- Fature novamente um `time_entry_id`, `expense_id` ou `engagement_entry_id` já anexado a
  um rascunho. Tudo o que estiver em um rascunho desaparece de `list_unbilled`.
- Inclua em uma resposta, commit ou arquivo uma chave, os dados de contato de um cliente ou
  as notas privadas de um cliente.
