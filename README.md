<p align="center">
  <img src="docs/images/faturador-wordmark.svg" alt="Faturador" width="210">
</p>

<p align="center"><strong>Faturamento para sua empresa e para os agentes que trabalham nela.</strong></p>

<p align="center">
Faturador é o espaço de faturamento que você executa para sua própria empresa: clientes, faturas, orçamentos, contratos de serviço, horas, despesas, pagamentos e relatórios.
Também é um servidor MCP, para que um agente de programação possa fazer o mesmo trabalho com uma chave de escopo limitado que você pode revogar, e cada documento que ele acessa permaneça em um aplicativo que uma pessoa pode abrir.
</p>

<p align="center">
  <a href="LICENSE"><img alt="Licença: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"></a>
  <a href=".nvmrc"><img alt="Node 22+" src="https://img.shields.io/badge/node-22%2B-informational.svg"></a>
  <a href="https://github.com/R3DP/faturador/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/R3DP/faturador/actions/workflows/ci.yml/badge.svg"></a>
</p>

**Este repositório é um fork do [Billr](https://github.com/ethanplusai/billr), adaptado para português do Brasil. O Faturador mantém a atribuição ao projeto de origem; a interface, a documentação e os comandos deste fork usam o nome Faturador.**

> **Nota sobre as capturas:** As imagens abaixo são referências do upstream Billr, em inglês e incluindo a marca Billr; não mostram a interface localizada do Faturador.

![Imagem de referência do upstream Billr em inglês; não é a interface localizada do Faturador](docs/images/dashboard.png)

*Referência visual do upstream Billr em inglês (não é a interface localizada do Faturador).*

## O que é

Faturador é um sistema de faturamento auto-hospedado, feito para trabalhar com agentes. Você o executa no seu próprio computador ou servidor, você e seus agentes faturam seus clientes por ele, e as únicas pessoas externas que o veem são esses clientes, nas páginas de fatura e orçamento que o Faturador envia a eles.

- **Um proprietário.** A primeira pessoa a se cadastrar é proprietária da instalação, e o cadastro é fechado em seguida.
- **Sua conta Stripe.** Os pagamentos com cartão vão direto para a conta Stripe cujas chaves você configura no ambiente. Nada fica no meio e nada é acrescentado à tarifa da Stripe.
- **Seu banco de dados.** Tudo fica em um projeto Supabase que você controla: no seu laptop, no seu próprio servidor ou gerenciado.
- **Seus agentes.** Claude Code, Codex, Cursor e qualquer cliente MCP se conectam por URL a `/api/mcp` na sua instalação.

## Início rápido

Você precisa do Node.js 22 ou mais recente, Docker (em execução) e da [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) 2.67.1 ou mais recente.

```sh
git clone --branch pt-br https://github.com/R3DP/faturador.git
cd faturador/app
npm run doctor
npm ci
npm run setup:local
npm run dev -- --hostname 127.0.0.1
```

Abra http://localhost:3000 e cadastre-se: essa conta será proprietária desta instalação do Faturador. Crie uma empresa, adicione um cliente, crie uma fatura e baixe o PDF.

`npm run doctor` verifica o Node.js, o Docker, a Supabase CLI e as portas locais antes de qualquer instalação. `npm run setup:local` inicia um projeto Supabase local isolado, aplica o esquema do banco de dados e grava credenciais locais em um `.env.local` ignorado pelo Git, com modo 0600; ele se recusa a sobrescrever um arquivo existente. Esta pilha local é apenas para sua máquina; não exponha as credenciais de desenvolvimento em um servidor público. Vai instalar em um computador novo pela primeira vez? [docs/fresh-machine-test.md](docs/fresh-machine-test.md) orienta cada etapa e mostra como é o resultado esperado.

Depois, abra **Agentes → Conectar** para ver a URL MCP da sua instalação, ou **Agentes → Chaves de API** para criar uma chave com as permissões necessárias ao agente. Um agente local se conecta a `http://localhost:3000/api/mcp`; um agente em outra máquina precisa de uma instalação acessível por ele.

Pagamentos com cartão e envio de faturas por e-mail são opcionais. Adicione suas chaves Stripe ou uma chave Resend quando quiser usar esses recursos: consulte [docs/self-hosting.md](docs/self-hosting.md).

## Instalação do Faturador (Billr no branch `main`) no Windows com Docker

O Faturador deste repositório está no projeto [R3DP/faturador](https://github.com/R3DP/faturador), branch `pt-br`. O projeto de origem Billr é o upstream [ethanplusai/billr](https://github.com/ethanplusai/billr), referenciado no branch `main`; isso não é a branch a clonar para obter a versão localizada. A atribuição ao upstream continua indicada acima.

### Antes de começar

- **Git for Windows** e **Node.js LTS 22 ou mais recente**. O instalador oficial do Node inclui o npm; não instale npm separadamente.
- **WSL 2** e o recurso Windows **Virtual Machine Platform**. A virtualização de hardware precisa estar habilitada na BIOS/UEFI. O comando abaixo instala/ativa os componentes e pode pedir reinicialização.
- **Docker Desktop** usando o backend WSL 2, aberto e em execução antes de chamar o diagnóstico. O Docker Desktop requer WSL 2.1.5 ou mais recente; para PCs x64, a documentação lista processador com SLAT e 8 GB de RAM, além de virtualização habilitada. Confira também se a versão do Windows e a arquitetura do seu PC são suportadas.
- **Supabase CLI v2**, versão 2.67.1 ou mais recente. A instalação padrão do Scoop usa v3; para este repositório, instale `supabase-v2-stable`, conforme a [orientação oficial para manter a CLI v2](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3), e não o pacote `supabase` do canal v3.

Instaladores e guias oficiais: [WSL (Microsoft)](https://learn.microsoft.com/windows/wsl/install), [Docker Desktop para Windows](https://docs.docker.com/desktop/setup/install/windows-install/), [Node.js](https://nodejs.org/en/download/), [Git for Windows](https://git-scm.com/install/windows), [PowerShell 7 (opcional, Microsoft)](https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-windows), [Scoop](https://scoop.sh/) e [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).

### Instale e prepare as ferramentas

1. Instale Git for Windows e Node.js LTS pelo instalador oficial, aceitando as opções padrão. Feche e reabra o PowerShell depois para atualizar o `PATH`.
2. Se esta for a primeira instalação do WSL, abra um PowerShell **como administrador** e execute:

   ```powershell
   wsl --install
   ```

   Esse comando é para a instalação inicial: ele pode habilitar componentes, instalar a distribuição Ubuntu padrão e solicitar a reinicialização do Windows. Reinicie quando solicitado. Se `wsl --install` mostrar apenas a ajuda (por exemplo, quando o WSL já existe), **não repita a instalação**; verifique a instalação existente nos próximos comandos.

   Em PowerShell como administrador, confira o estado, atualize o WSL e defina a versão padrão 2:

   ```powershell
   wsl --status
   wsl --list --verbose
   wsl --update
   wsl --set-default-version 2
   ```

   Só instale uma distribuição se `wsl --list --verbose` não listar nenhuma. Nesse caso, consulte as disponíveis e instale uma, por exemplo Ubuntu:

   ```powershell
   wsl --list --online
   wsl --install -d Ubuntu
   ```

   Se já houver uma distribuição, não instale outra Ubuntu. Se a coluna `VERSION` indicar `1`, converta a distribuição existente para WSL 2; para Ubuntu, por exemplo:

   ```powershell
   wsl --set-version Ubuntu 2
   ```

   Troque `Ubuntu` pelo nome exato mostrado em `wsl --list --verbose` (por exemplo, `Ubuntu-24.04`). A conversão pode levar algum tempo e falhar; faça backup dos arquivos importantes antes.

   Siga a [instalação manual oficial do WSL da Microsoft](https://learn.microsoft.com/windows/wsl/install-manual) se o Windows não atender ao requisito do comando (Windows 10 versão 2004, build 19041, ou posterior; ou Windows 11) ou se faltar o recurso **Virtual Machine Platform**. A ativação de componentes pode exigir reinicialização; reinicie quando solicitado antes de continuar. Se a virtualização estiver desativada na BIOS/UEFI, habilite-a antes de prosseguir.

3. Instale o Docker Desktop no modo **por usuário** (recomendado; não exige elevação), selecione o backend **WSL 2** se o instalador perguntar e abra o Docker Desktop pelo menu Iniciar. Espere o mecanismo indicar que está em execução; só ter o aplicativo instalado não basta. O comando `docker info` no PowerShell deve concluir sem erro.
4. Abra Windows PowerShell 5.1 (já incluído no Windows) ou PowerShell 7, **sem elevação**, para instalar o Scoop no escopo do seu usuário. O link para PowerShell 7 acima é opcional. Primeiro confira a política vigente:

   ```powershell
   Get-ExecutionPolicy -List
   ```

   Se a política da organização permitir, use somente `CurrentUser` e `RemoteSigned`. Confira a política efetiva antes de executar o instalador; se não for `RemoteSigned`, pare e peça orientação ao TI. Não use `Bypass`, `Unrestricted` nem tente contornar políticas corporativas.

   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   if ((Get-ExecutionPolicy) -ne 'RemoteSigned') {
     throw 'A política efetiva não é RemoteSigned; pare e consulte o TI.'
   }
   Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression
   scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
   scoop install supabase-v2-stable
   supabase --version
   ```

   A versão exibida precisa ser `2.67.1` ou superior, ainda na linha v2. Feche e reabra o PowerShell para carregar o `PATH` do Scoop.

### Clone, diagnostique e inicie

No PowerShell recém-aberto, confirme que Git, Node.js, npm, Supabase CLI e Docker estão disponíveis. O Docker Desktop precisa continuar aberto:

```powershell
git --version
node --version
npm --version
supabase --version
docker info
```

Clone a branch localizada (não use `main` neste comando) e entre na pasta do aplicativo:

```powershell
Set-Location $HOME
git clone --branch pt-br https://github.com/R3DP/faturador.git
Set-Location .\faturador\app
```

Execute o diagnóstico **antes** de instalar dependências. Ele verifica Node.js, Docker em execução, Supabase CLI (mínimo 2.67.1), arquivo `.env.local` e portas. Os padrões são a porta do aplicativo `3000` e as portas locais do Supabase `56420–56429`. Corrija cada linha `FAIL` e rode o diagnóstico novamente; só continue quando não houver `FAIL`. Um `WARN` de menos de 4 GB alocados ao Docker só afeta a compilação da imagem de produção; o próprio diagnóstico informa que o desenvolvimento local funciona.

```powershell
npm run doctor
```

Com o diagnóstico sem `FAIL`, instale as dependências travadas no lockfile:

```powershell
npm ci
```

Quando `npm ci` terminar sem erro, inicialize a stack local:

```powershell
npm run setup:local
```

Na primeira inicialização, `setup:local` baixa e inicia os contêineres locais do Supabase e pode levar alguns minutos. Ele cria `app/.env.local`, ignorado pelo Git, com as credenciais geradas localmente; se o arquivo já existir, o comando se recusa a sobrescrevê-lo. Não é necessário entrar em uma conta Supabase hospedada, fornecer chaves Supabase de nuvem ou configurar Stripe para executar o ambiente local.

Inicie o servidor de desenvolvimento:

```powershell
npm run dev -- --hostname 127.0.0.1
```

Quando o terminal mostrar que o Next.js está pronto, abra [http://localhost:3000](http://localhost:3000). Para parar o servidor, use `Ctrl+C` no terminal.

Se uma porta estiver ocupada, siga a mensagem `FAIL` do diagnóstico. Os scripts aceitam `BILLR_LOCAL_APP_PORT` e `BILLR_LOCAL_DB_PORT`; no PowerShell, defina a variável indicada antes de executar `npm run doctor` e mantenha-a na mesma sessão para `npm run setup:local`. Por exemplo, se a porta 3000 estiver ocupada:

```powershell
$env:BILLR_LOCAL_APP_PORT = "3010"
npm run doctor
```

Se o diagnóstico não mostrar `FAIL`, continue na mesma sessão do PowerShell:

```powershell
npm run setup:local
```

E use a porta escolhida ao iniciar o app:

```powershell
npm run dev -- --port 3010 --hostname 127.0.0.1
```

Se o conflito for na faixa do Supabase, defina `$env:BILLR_LOCAL_DB_PORT` com uma porta-base alternativa. Por exemplo:

```powershell
$env:BILLR_LOCAL_DB_PORT = "56451"
npm run doctor
```

Use outra base se essa faixa também estiver ocupada. Só depois de o diagnóstico confirmar que ela está livre, e sem fechar a sessão do PowerShell, rode `npm run setup:local`.

## O que você pode fazer

### Clientes

Dados de contato, endereço de cobrança, moeda, condições de pagamento, identificação fiscal e notas internas que nunca aparecem em um documento. Os totais por cliente, faturado e pendente, são mantidos pelo banco de dados em vez de recalculados no navegador, para que uma lista e uma página de detalhes nunca apresentem valores diferentes.

![Imagem de referência do upstream Billr em inglês; não é a interface localizada do Faturador](docs/images/clients-list.png)

*Referência visual do upstream Billr em inglês (não é a interface localizada do Faturador).*

### Faturas e orçamentos

- Itens com quantidades, valores unitários, descontos percentuais ou fixos, impostos e frete, todos totalizados no servidor.
- A numeração é por empresa, com um prefixo configurável, e o documento é criado em uma única transação do banco de dados, para que nunca exista uma fatura gravada pela metade.
- Status: rascunho, enviada, visualizada, parcial, paga, atrasada e cancelada. A lista filtra por eles e o painel os contabiliza.
- **Duplique** uma fatura em um novo rascunho ou **converta** um orçamento aceito em uma fatura ou contrato de serviço, mantendo o vínculo entre os dois.
- Faturas e orçamentos recebem uma página pública com um `public_id` secreto, e uma fatura também é renderizada como PDF, que o cliente pode baixar ou que o Faturador anexa ao enviar a fatura por e-mail.

![Imagem de referência do upstream Billr em inglês; não é a interface localizada do Faturador](docs/images/invoices-list.png)

*Referência visual do upstream Billr em inglês (não é a interface localizada do Faturador).*

![Imagem de referência do upstream Billr em inglês; não é a interface localizada do Faturador](docs/images/invoice-detail.png)

*Referência visual do upstream Billr em inglês (não é a interface localizada do Faturador).*

Um orçamento aceito mantém sua própria página, com um botão para convertê-lo em fatura e outro para convertê-lo em contrato de serviço.

![Imagem de referência do upstream Billr em inglês; não é a interface localizada do Faturador](docs/images/estimate-detail.png)

*Referência visual do upstream Billr em inglês (não é a interface localizada do Faturador).*

A página pública é o que seu cliente recebe. Ela é servida por funções dedicadas e somente de leitura do banco de dados, identificadas pelo `public_id`, nunca por uma política ampla de tabelas, e os dados retornados usam uma lista explícita de colunas permitidas: adicionar uma coluna a `businesses` ou `clients` não amplia o que um cliente pode ver. Quando suas chaves Stripe estão configuradas, o cliente paga com cartão diretamente nessa página.

![Imagem de referência do upstream Billr em inglês; não é a interface localizada do Faturador](docs/images/invoice-public-page.png)

*Referência visual do upstream Billr em inglês (não é a interface localizada do Faturador).*

### Do registro de horas e despesas à fatura

Registre horas e despesas para um cliente, na moeda dele, faturáveis ou não. A lista de itens não faturados é a área de trabalho: selecione lançamentos, transfira-os para um rascunho de fatura em uma etapa, e eles serão marcados como faturados nessa mesma etapa, para que a mesma hora não possa ser faturada duas vezes.

![Imagem de referência do upstream Billr em inglês; não é a interface localizada do Faturador](docs/images/time-and-expenses.png)

*Referência visual do upstream Billr em inglês (não é a interface localizada do Faturador).*

### Contratos de serviço

Um contrato de serviço define um total acordado e o cronograma pelo qual ele será faturado, para que o trabalho seja cobrado com base no que foi combinado, em vez de algo inventado a cada fatura.

- Modalidades de cobrança: `percent_split`, `equal_installments`, `milestones` e `manual`.
- Cada item do cronograma pode ser faturado quando uma regra for atendida: `on_start`, `on_complete`, `on_milestone`, `on_date` ou `manual`.
- O banco de dados garante que os itens somem exatamente o total, e o arredondamento é decidido em um único lugar: o último item absorve o restante.
- Um item que já foi faturado fica congelado. O total acordado, a moeda, a modalidade de cobrança e o cronograma deliberadamente não podem ser editados depois.
- Nada é enviado por meio de um contrato de serviço. Estar pronto para faturar é um status; transformar isso em fatura e enviá-la são etapas separadas e deliberadas.

![Imagem de referência do upstream Billr em inglês; não é a interface localizada do Faturador](docs/images/engagements-detail.png)

*Referência visual do upstream Billr em inglês (não é a interface localizada do Faturador).*

### Pagamentos

- Registre o que realmente foi recebido: dinheiro, cheque, transferência bancária, cartão, PayPal ou qualquer outro meio. Não é necessária uma conta Stripe.
- Saldos e status são conciliados pelo banco de dados, não pela página que você estiver consultando.
- Um pagamento registrado incorretamente pode ser **corrigido** ou **anulado** com um motivo. A linha anulada permanece, tachada, e deixa de contar como dinheiro: a fatura é reaberta naquele valor e todos os totais o excluem.
- Pagamentos com cartão usam **sua própria conta Stripe**, configurada com três variáveis de ambiente. Os dados do cartão vão do navegador do seu cliente para a Stripe; o valor cobrado sempre é recalculado a partir da fatura no servidor. A Stripe confirma o resultado por um webhook assinado, e os eventos são processados uma única vez, para que a reentrega de um webhook não pague uma fatura duas vezes.
- Reembolsos e contestações abertos no seu painel Stripe são sincronizados da mesma forma.

![Imagem de referência do upstream Billr em inglês; não é a interface localizada do Faturador](docs/images/payments-list.png)

*Referência visual do upstream Billr em inglês (não é a interface localizada do Faturador).*

### Cobrança de tarefas de agentes

Um agente abre uma tarefa sob uma política de preços aprovada por uma pessoa, envia sinais de atividade enquanto trabalha, informa os custos dos provedores que usou e conclui a tarefa. Depois, uma pessoa analisa e decide.

- Um proprietário ou administrador aprova uma política por cliente: moeda, valor por hora, multiplicador de uso e orçamento por tarefa. A ausência de preços nunca é tratada como zero.
- O tempo é medido com registros de data e hora do servidor, e cada sinal de atividade contabiliza no máximo 120 segundos desde o anterior, para que um intervalo longo não se transforme silenciosamente em uma hora faturável.
- O cálculo é especificado por completo: `time = active_seconds x hourly_rate / 3600`, `usage = reported_provider_cost x usage_multiplier`, `total = time + usage`.
- O Faturador não busca faturas de provedores nem deduz preços com base nos nomes de modelos. O uso informado precisa de uma referência de solicitação ao provedor e de uma fonte de evidência, e cada referência só pode ser faturada uma vez por empresa e provedor.
- A conclusão congela o registro. Aprovar o custo e criar o rascunho da fatura são ações humanas, e enviá-la é outra ação.

![Imagem de referência do upstream Billr em inglês; não é a interface localizada do Faturador](docs/images/task-billing.png)

*Referência visual do upstream Billr em inglês (não é a interface localizada do Faturador).*

### O servidor MCP

O servidor MCP faz parte do aplicativo e fica em `/api/mcp` na sua instalação. Ele disponibiliza **53 ferramentas** em dez grupos: clientes, faturas, orçamentos, contratos de serviço, itens salvos, horas, despesas, pagamentos, cobrança de tarefas e empresa e links. A referência das ferramentas em `plugins/shared/skill/references/tools.md` é gerada a partir do mesmo catálogo que o servidor registra, para que não seja possível publicar uma ferramenta documentada que não exista.

**Conexão por URL.** Sua instalação é um servidor de autorização OAuth 2.1 e um recurso protegido, publicados em `/.well-known/oauth-authorization-server` e `/.well-known/oauth-protected-resource`. Um cliente compatível com MCP remoto os descobre, registra-se, redireciona você para uma tela de acesso normal e recebe um token de curta duração, em vez de uma chave que você teria de copiar e colar.

![Imagem de referência do upstream Billr em inglês; não é a interface localizada do Faturador](docs/images/agents-connect.png)

*Referência visual do upstream Billr em inglês (não é a interface localizada do Faturador).*

Claude Code:

```sh
claude mcp add --transport http faturador https://YOUR_APP/api/mcp
```

Depois, execute `/mcp` no Claude Code, escolha `faturador`, autentique-se no navegador e confirme com `claude mcp list`.

Codex:

```sh
codex mcp add faturador --url https://YOUR_APP/api/mcp
codex mcp login faturador
codex mcp list
```

Cursor, ChatGPT e qualquer outro cliente compatível com MCP sobre HTTP em fluxo contínuo estão descritos em **Agentes → Conectar** e em [plugins/README.md](plugins/README.md).

Para instalar conectores de agentes neste fork, consulte a documentação em [plugins/README.md](plugins/README.md). Os diretórios, nomes de pacotes e identificadores herdados do projeto upstream Billr são mantidos quando necessários para compatibilidade técnica.

**A tela de consentimento.** Ao entrar, uma página pergunta em qual empresa o agente pode trabalhar e quais permissões ele recebe. A leitura é o nível básico e não pode ser desmarcada; envio, pagamentos e exclusão ficam desativados até você ativá-los. O acesso expira em 30 dias, a menos que o agente renove o token, e cada conexão pode ser revogada em **Agentes → Chaves de API**.

![Imagem de referência do upstream Billr em inglês; não é a interface localizada do Faturador](docs/images/agents-consent.png)

*Referência visual do upstream Billr em inglês (não é a interface localizada do Faturador).*

**Chaves de API e escopos.** Para clientes que não oferecem suporte a OAuth, crie uma chave `billr_sk_`. Esse identificador técnico é mantido por compatibilidade com o projeto de origem Billr. A chave é exibida uma única vez, armazenada apenas como hash SHA-256, pode ser limitada a uma empresa e expira em 90 dias. As chaves recebem perfis:

| Perfil | Permissões | O que pode fazer |
| --- | --- | --- |
| Somente leitura | `read` | Consultar clientes, documentos, trabalho e totais de receita |
| Leitura e rascunhos | `read`, `write` | O anterior, além de criar e editar rascunhos, clientes, itens, horas e despesas |
| Faturamento | `read`, `write`, `send`, `payments` | O anterior, além de enviar documentos por e-mail e registrar pagamentos |
| Completo | `read`, `write`, `send`, `payments`, `delete` | O anterior, além de excluir horas e despesas não faturadas |

Cada ferramenta corresponde a exatamente uma permissão, e ferramentas sem categoria são negadas, para que uma nova ferramenta não herde acesso silenciosamente. O escopo é verificado novamente quando uma ferramenta é executada, então a revogação passa a valer na chamada seguinte. A definição de preços de tarefas e a aprovação de faturas de tarefas sempre exigem uma pessoa, independentemente do que a chave permite.

![Imagem de referência do upstream Billr em inglês; não é a interface localizada do Faturador](docs/images/agents-keys.png)

*Referência visual do upstream Billr em inglês (não é a interface localizada do Faturador).*

As ferramentas de escrita recebem um `request_id` estável, para que uma nova tentativa após um tempo limite retorne o resultado original, em vez de criar uma segunda fatura. Tudo o que um agente cria é identificado: faturas e clientes exibem o selo "via agente", e **Agentes → Auditoria** mostra o que foi criado por um agente em vez de uma pessoa.

### Relatórios

Valores recebidos, faturados, pendentes e lucro para qualquer período, com comparação com o período anterior. O relatório de vencimento de contas a receber agrupa cada fatura em aberto pelo atraso, indica quem deve ser cobrado primeiro e exporta para CSV. Há uma demonstração de lucros e perdas pelo regime de caixa ou competência, além de um relatório de horas. Agentes consultam os mesmos números por meio de `revenue_summary`, calculado no banco de dados, para que o espaço de trabalho e um agente nunca apresentem valores diferentes.

![Imagem de referência do upstream Billr em inglês; não é a interface localizada do Faturador](docs/images/reports.png)

*Referência visual do upstream Billr em inglês (não é a interface localizada do Faturador).*

### Várias marcas e colegas de equipe

Uma instalação do Faturador pode conter várias empresas, cada uma com seus próprios clientes, numeração, identidade visual, moeda e chaves de agente, todas pagas na mesma conta Stripe. O seletor de espaço de trabalho no alto da barra lateral alterna entre elas, e uma chave de API pode ser vinculada a exatamente uma, para que um comando malicioso em um projeto não alcance as faturas de outra marca.

A associação tem uma função: `owner`, `admin` ou `member`. É preciso ser proprietário ou administrador para aprovar preços de tarefas e aprovar uma fatura de tarefa, e a segurança em nível de linha impõe esse limite no banco de dados. Para dar acesso a um colega, consulte "Cadastro e colegas de equipe" em [docs/self-hosting.md](docs/self-hosting.md).

## Executar em um servidor

[docs/self-hosting.md](docs/self-hosting.md) é o guia completo: banco de dados, variáveis de ambiente, cadastro, proxy reverso, pagamentos com cartão, e-mail, atualizações e backups. Em resumo:

```sh
cd app
cp .env.example .env.local && chmod 600 .env.local   # depois preencha o arquivo
npm ci
npm run check:config
docker compose --env-file .env.local build
docker compose --env-file .env.local up -d
```

O contêiner é executado como usuário não root e escuta somente em `127.0.0.1:3000`, então você coloca seu próprio proxy reverso HTTPS à frente. O HTTP em fluxo contínuo por `/api/mcp` precisa passar sem bufferização. Para criar a imagem, o Docker precisa ter pelo menos 4 GB de memória disponíveis.

O que você precisa fornecer:

- **Um projeto Supabase seu** (gerenciado ou auto-hospedado). O arquivo Compose do Faturador executa o aplicativo, não uma segunda cópia do Supabase.
- **Sua conta Stripe**, se quiser pagamentos com cartão. Deixe vazias as variáveis Stripe e todo o resto continuará funcionando; registre os pagamentos à medida que chegarem.
- **Sua conta Resend e um remetente verificado**, se quiser que o Faturador envie documentos por e-mail.

Nenhuma chave, conta ou alternativa de provedor está incluída, e nada envia dados da instalação para fora.

## Arquitetura em resumo

- **Aplicativo Next.js** (App Router, React, Tailwind, ações de servidor) que serve o espaço de trabalho, as páginas públicas de documentos, o renderizador de PDF e as rotas de API.
- **Supabase Postgres** como único armazenamento. A autorização fica em políticas de segurança em nível de linha e funções `SECURITY DEFINER` com `search_path` fixado; cálculos monetários, numeração de documentos, conciliação de pagamentos e cronogramas de contratos são impostos em SQL. O acesso público aos documentos passa somente por funções de leitura com lista de permissões, identificadas por um `public_id` secreto.
- **Servidor MCP** em `app/src/app/api/mcp`, com ferramentas em `app/src/lib/mcp/tools`. Cada ferramenta acessa o banco de dados por um cliente com escopo limitado, que filtra por empresa.
- **Servidor OAuth 2.1** em `app/src/app/api/oauth` e `app/src/app/(auth)/oauth/authorize`: registro dinâmico de clientes, PKCE com S256, correspondência exata de redirecionamento e tokens de acesso que são linhas comuns de chaves de API, para que um único resolvedor continue sendo a porta de entrada do MCP.
- **`packages/agent-kit`**: catálogo de ferramentas, esquemas de entrada JSON e auxiliares de valores monetários e tempo, verificados em relação às ferramentas registradas pelo servidor.

```
app/
  src/app/(app)        espaço de trabalho com sessão iniciada
  src/app/(auth)       entrada, cadastro, consentimento OAuth
  src/app/(public)     /i/<id> e /e/<id>, documentos voltados ao cliente
  src/app/api          mcp, oauth, stripe, auth, health, PDFs de faturas
  src/lib/mcp          definições de ferramentas, permissões, acesso ao banco com escopo
  src/lib/oauth        servidor de autorização, escopos, conexões
  src/lib/actions      ações de servidor por trás do espaço de trabalho
  supabase/migrations  esquema: uma linha de base, depois alterações numeradas
  supabase/tests       testes SQL (npm run test:sql)
packages/agent-kit     catálogo de ferramentas, esquemas e cálculos compartilhados
plugins                pacotes Codex e OpenClaw; outros guias de conexão de agentes
docs                   guia de auto-hospedagem, teste em máquina nova, capturas de tela
```

## Segurança

Relate vulnerabilidades em privado, conforme descrito em [SECURITY.md](SECURITY.md). Não abra uma issue pública para isso.

As garantias que orientam o código:

- Os dados de uma empresa só podem ser lidos por seus membros, e essa verificação ocorre no banco de dados.
- Os links de documentos voltados ao cliente usam identificadores impossíveis de adivinhar, resolvidos por funções de leitura que retornam uma lista explícita de campos. Suas notas internas e o próximo número de fatura não estão entre eles.
- As chaves de API são armazenadas como hashes. Ninguém, nem mesmo quem executa sua instalação, pode recuperar uma chave depois que ela é criada.
- Cada ferramenta de agente corresponde a exatamente uma permissão, e qualquer ferramenta sem categoria é recusada.
- A definição de preços e a decisão de cobrar são ações humanas que nenhuma chave pode executar.
- Os webhooks de pagamento têm a assinatura verificada e são processados uma única vez.
- Somente contas admitidas por esta instalação podem criar uma empresa; o cadastro é fechado depois que o proprietário se registra.

Cabe a você proteger sua instalação: o banco de dados, os backups, os segredos, o proxy reverso e as contas.

## Como contribuir

Leia primeiro [CONTRIBUTING.md](CONTRIBUTING.md). Todas as pessoas participantes seguem o [Código de Conduta](CODE_OF_CONDUCT.md). As alterações estão listadas em [CHANGELOG.md](CHANGELOG.md), e tudo o que não for um relato de vulnerabilidade deve ser encaminhado por [SUPPORT.md](SUPPORT.md).

```sh
cd app
npm test
npm run test:installation
npm run lint
npm run typecheck
npm run build
```

Os testes usam dados fictícios. Nunca os execute em um banco de dados que contenha faturas reais.

## Licença

Apache-2.0, direitos autorais de Voyage Studios LLC, que opera comercialmente como Billr, nome do projeto de origem deste repositório. Consulte [LICENSE](LICENSE) e [NOTICE](NOTICE). Ativos de terceiros mantêm suas próprias licenças. O nome Billr identifica o projeto upstream e não significa que a equipe Billr opere ou ofereça suporte à sua instalação do Faturador.
