# Kit de agentes do Faturador (derivado de ethanplusai/billr)

Kit de agentes do Faturador, derivado do projeto upstream [ethanplusai/billr](https://github.com/ethanplusai/billr). Contém um cliente MCP em
TypeScript, o catálogo de ferramentas, os esquemas JSON exportados das ferramentas e os
mesmos cálculos de tempo e moeda usados pela aplicação Faturador. Não contém credenciais,
registros de clientes, ferramentas de administração de banco de dados nem configuração de
implantação.

O pacote fica no repositório do Faturador e permanece privado para evitar publicação
acidental no npm. Informe a URL MCP da sua própria instalação; não há conexão padrão.

## Conectar um agente

```ts
import { connectBillr } from '@billr/agent-kit'

const billr = await connectBillr({
  apiKey: process.env.BILLR_API_KEY!,
  url: process.env.BILLR_MCP_URL!,
})
try {
  const tools = await billr.listTools()
  const pricing = await billr.callTool({
    name: 'list_billing_policies',
    arguments: {},
  })
  // Confira as tarifas e escolha a política aprovada por uma pessoa para o cliente.
  const task = await billr.callTool({
    name: 'create_task',
    arguments: {
      request_id: crypto.randomUUID(),
      policy_id: 'HUMAN_APPROVED_POLICY_UUID',
      title: 'Implemente a alteração aprovada',
    },
  })
} finally {
  await billr.close()
}
```

Use uma chave separada para cada agente, limitada a uma empresa. As chaves padrão podem ler
e criar rascunhos, mas não enviar documentos, excluir lançamentos nem registrar pagamentos.
As chaves expiram em 90 dias. Descubra as ferramentas realmente permitidas com `listTools()`
; o catálogo inclui ferramentas que uma chave restrita talvez não possa usar.

## Contrato de tarefas

1. Uma pessoa aprova a taxa por hora, a moeda, o multiplicador de uso e o orçamento de cada
   tarefa no Faturador.
2. Crie uma tarefa e, depois, inicie-a quando o trabalho começar.
3. Envie um sinal de atividade a cada 30 a 60 segundos. Cada intervalo contabiliza no máximo 120
   segundos. Pause quando estiver ocioso ou aguardando.
4. Registre os custos conhecidos do provedor, com uma referência de solicitação do provedor
   e a fonte da evidência. São custos informados, não faturas do provedor verificadas. Não
   invente preços nem converta moedas implicitamente.
5. Conclua a tarefa, confira a prévia dos custos e peça à pessoa que a revise no Faturador.
   A aprovação humana cria um rascunho de fatura; o envio é uma etapa separada.

Cada mutação neste fluxo de tarefas exige um novo UUID de ID de solicitação. Em novas
tentativas, reutilize o ID original e argumentos idênticos. Persista esses IDs junto ao
estado da tarefa do agente. O registro manual de tempo/despesas, a criação de documentos, o
envio de documentos e o registro de pagamentos também usam IDs de solicitação estáveis.

O tempo é arredondado para segundos inteiros. O tempo faturável é
`round(seconds × hourly_rate / 3600, 2)`. O uso é
`round(sum(provider_cost) × multiplier, 2)`. Tarefas separadas podem se sobrepor; cabe a
quem chama evitar a cobrança duplicada pelo mesmo trabalho. Isso não é uma medição
independente da produtividade do agente.

A cobrança de tarefas está descrita no README do repositório. Teste em uma instância local
do Faturador com `url: 'http://localhost:3000/api/mcp'`.

## Esquemas de ferramentas e paginação

`TOOL_CONTRACTS` exporta as definições de ferramentas e os esquemas de entrada JSON
completos do servidor. Eles descrevem toda a superfície; as permissões em tempo de execução
ainda determinam quais ferramentas uma chave pode chamar. Os esquemas são gravados por
`app/scripts/local-mcp-acceptance.mjs` neste repositório: execute com
`BILLR_EXPORT_CONTRACTS=1` contra uma instância local do Faturador; o script lista as
ferramentas registradas pelo servidor MCP ativo e as salva em `src/tool-contracts.json`,
para que correspondam ao que o servidor realmente expõe.

As ferramentas de coleção aceitam `offset` e retornam `next_offset` quando outra página pode
existir. Continue até que seja `null`. Os totais de trabalho não faturado são totais por
página; some as páginas separadamente por moeda.

## Desenvolvimento

```sh
npm ci
npm run build
```

Não coloque chaves de API em arquivos de código-fonte, instruções para agentes, pacotes do navegador nem no
histórico do Git. Configure `BILLR_API_KEY` no armazenamento de segredos do seu ambiente de
execução.
