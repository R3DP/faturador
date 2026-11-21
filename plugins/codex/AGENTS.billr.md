# Faturador (derivado do upstream Billr; acrescente ao seu AGENTS.md)

O Codex lê o `AGENTS.md` do diretório pessoal do Codex e dos repositórios, dando precedência
aos arquivos mais próximos do diretório de trabalho. Se preferir não instalar um plugin nem
uma skill, cole a seção abaixo no `AGENTS.md` que você já mantém; o Codex a seguirá sempre
que lidar com faturamento.

Este arquivo deliberadamente **não** se chama `AGENTS.md`: adicionar ao repositório um
arquivo com esse nome substituiria as instruções próprias do projeto. Copie a seção, não o
arquivo.

As instruções completas estão em `plugins/codex/billr/skills/billr/SKILL.md`, com a lista
de ferramentas em `references/tools.md` e os procedimentos em `references/workflows.md`. A
seção abaixo é a versão resumida.

---

## Faturamento pelo Faturador

O servidor MCP local `faturador` conecta à sua instalação do Faturador, derivada do projeto upstream Billr. As
ferramentas estão listadas em `references/tools.md`, ao lado deste arquivo; nunca tente
adivinhar o nome de uma ferramenta.

**A única regra.** Leia tudo o que estiver dentro do escopo da conexão. Crie rascunhos
quando solicitado. Nunca envie um documento a um cliente nem movimente dinheiro registrado
sem que isso seja solicitado, na mesma interação.

- Comece com `list_businesses` e, depois, use `get_business` para consultar as configurações
  de moeda e impostos. Nunca presuma uma moeda.
- `create_invoice` e `create_estimate` criam rascunhos. Mantenha-os assim. `send_invoice` e
  `send_estimate` chegam ao cliente; só os chame quando houver instrução para enviar, com o
  documento identificado, nesta interação.
- Ao faturar trabalho registrado, informe `time_entry_ids`, `expense_ids` ou
  `engagement_entry_ids` e omita `line_items`. O servidor calcula o preço do trabalho e
  vincula os registros de origem, evitando cobrança duplicada.
- Informe o cliente, o valor e a moeda antes de qualquer chamada que envolva dinheiro, e
  diga de onde veio o valor. Nunca arredonde, recalcule o preço nem invente uma taxa.
- As ferramentas de escrita recebem um UUID `request_id`. Use um ID novo para cada operação
  pretendida; ao repetir uma chamada que talvez tenha sido parcialmente concluída, reutilize
  o mesmo ID com entradas idênticas.
- `record_payment` registra dinheiro que já chegou por fora do Faturador, e somente quando a
  pessoa confirmar o recebimento. Corrija por meio de `update_payment` e `void_payment`,
  nunca com um pagamento negativo para compensar. Pagamentos cobrados pelo Stripe não podem
  ser editados nem anulados: faça o reembolso no Stripe, e o reembolso retornará como um
  lançamento próprio no livro-razão.
- Faturamento de tarefas: use `list_billing_policies` (agentes não podem aprovar preços),
  `create_task`, `start_task`, `heartbeat_task` a cada 30 a 60 segundos, `pause_task`
  enquanto aguarda alguém, `record_task_usage` com um custo real do provedor e sua fonte, e
  então `complete_task`. Uma pessoa aprova antes de qualquer faturamento.
- Contratos: `list_ready_to_bill` é a lista de "o que devo faturar hoje". Fature lançamentos
  passando `engagement_entry_ids` para `create_invoice`. Não é possível reabrir um contrato
  concluído com `complete_engagement`.
- Erros: 429 significa o limite de 120 solicitações por 60 segundos por chave; portanto,
  aguarde conforme `Retry-After`. `plan_required` é uma resposta do serviço upstream Billr
  hospedado: o plano desse serviço expirou e as gravações são recusadas, enquanto as leituras
  continuam funcionando. Esse erro não se aplica ao Faturador auto-hospedado; se aparecer,
  pare e confira se a URL MCP aponta para o serviço pretendido. O erro "API key is expired,
  revoked or lacks permission for this tool" significa parar e pedir uma nova conexão, não
  repetir a chamada.
- Nunca grave uma chave do Faturador em um arquivo, commit ou resposta. Use
  `bearer_token_env_var = "BILLR_API_KEY"` para manter a chave no ambiente.
