# Teste em uma máquina nova

Um teste completo de instalação em um computador que nunca executou o Faturador. Siga do início ao fim. Cada etapa informa como identificar o sucesso; se o que você vir for diferente, pare e anote o número da etapa, o que executou e o que viu.

Reserve cerca de uma hora. As etapas 1 a 13 são obrigatórias; 14 a 16 são opcionais; a 17 faz a limpeza.

## 0. Pré-requisitos

| Ferramenta | Versão | Verificação |
| --- | --- | --- |
| Git | qualquer versão recente | `git --version` |
| Node.js | 22 ou mais recente | `node --version` mostra `v22` ou superior |
| Docker Desktop (ou Docker Engine) | em execução; pelo menos 4 GB de memória para a imagem de produção | `docker info` é concluído com sucesso |
| Supabase CLI | 2.67.1 ou mais recente | `supabase --version` |

Links de instalação: [Node.js](https://nodejs.org/), [Docker Desktop](https://docs.docker.com/desktop/), [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).

## 1. Clone o repositório

```sh
git clone --branch pt-br https://github.com/R3DP/faturador.git
cd faturador/app
```

Sucesso: o clone termina e `ls` mostra `package.json`, `Dockerfile` e `scripts`.

## 2. Verifique a máquina

```sh
npm run doctor
```

Sucesso: não há linhas `FAIL` e a última linha é `Pronto. Em seguida: npm ci e depois npm run setup:local.` Um `WARN` sobre memória do Docker só importa para a etapa 16.

Se uma porta estiver ocupada, a linha `FAIL` informa a variável a definir. Por exemplo, se outro programa já estiver usando a porta 3000, execute `BILLR_LOCAL_APP_PORT=3010 npm run doctor` e use o mesmo prefixo em `npm run setup:local` na etapa 4. Em todo o restante, substitua `3000` pela porta escolhida.

## 3. Instale as dependências

```sh
npm ci
```

Sucesso: o comando termina sem erro e imprime `added ... packages`.

## 4. Inicie o banco de dados local

```sh
npm run setup:local
ls -l .env.local
```

Sucesso: a saída inclui `Arquivo .env.local privado criado. Inicie o Faturador: npm run dev -- --port <porta> --hostname 127.0.0.1` (a porta corresponde à configuração), uma linha iniciada por `Projeto do banco de dados:` com o comando `supabase stop --workdir .self-host/<projeto>` e o aviso iniciado por `Apenas para desenvolvimento local:`. Na primeira execução, a inicialização pode levar vários minutos. `ls` mostra `-rw-------` para `.env.local`.

## 5. Inicie o Faturador

```sh
npm run dev -- --hostname 127.0.0.1
```

Se escolheu outra porta na etapa 2, use o comando impresso na etapa 4: ele acrescenta `--port`.

Abra http://localhost:3000. Sucesso: o terminal imprime `Ready` e o navegador abre a página de login.

## 6. Cadastre-se como proprietário

Escolha **Criar conta**. Use um nome e endereço fictícios, como `owner@fieldstone.example`, e uma senha com pelo menos 8 caracteres.

Sucesso: você chega à página de integração inicial que solicita o nome da empresa. O banco de dados local não envia e-mail de confirmação.

## 7. O cadastro agora está fechado

Em uma janela privativa do navegador, abra http://localhost:3000/signup.

Sucesso: a página mostra "O cadastro está fechado" e não exibe o formulário. Feche a janela privativa.

## 8. Crie uma empresa

Dê a ela o nome `Fieldstone Digital`, deixe ou preencha o e-mail comercial e continue.

Sucesso: você chega ao painel com todos os totais zerados. Um breve tour é aberto na primeira vez; ignore-o ou avance por ele. **Configurações** mostra exatamente quatro abas: Empresa, Identidade visual, Faturas e Conta.

## 9. Adicione um cliente

Em **Clientes**, escolha **Adicionar cliente**, informe o nome `Harbor & Lane` e o e-mail `billing@harborlane.example`. Depois, escolha **Criar cliente**.

Sucesso: o cliente aparece na lista com total faturado de $0.00.

## 10. Crie uma fatura

Em **Faturas**, escolha **Nova fatura** e selecione Harbor & Lane. Adicione o item `Manutenção do site`, com quantidade 1 e valor unitário 1500. Se quiser, preencha **Instruções de pagamento**. Escolha **Salvar e enviar**. A fatura é salva e uma janela de envio é aberta; feche-a, pois o e-mail ainda não está configurado (etapa 15). Em seguida, abra o menu **...** e escolha **Marcar como enviada**: um rascunho não tem página do cliente, e marcá-lo como enviado é a forma de emitir uma fatura que você entregará por conta própria.

Sucesso: a fatura mostra o status enviada, o primeiro número de fatura da empresa (`INV-0001`) e o total de $1,500.00.

## 11. Baixe o PDF

Na fatura, abra o menu **...** e escolha **Baixar PDF**.

Sucesso: o PDF é baixado e mostra Fieldstone Digital, Harbor & Lane, o item e 1,500.00.

## 12. Abra a visualização do cliente

No menu **...** da fatura, escolha **Copiar link** e abra o link em uma janela privativa do navegador.

Sucesso: a página carrega sem login e mostra o valor devido, uma seção de pagamento com as instruções da fatura (ou "Entre em contato com quem enviou para combinar o pagamento" quando não houver instruções, pois pagamentos com cartão ainda não estão configurados) e um botão **Baixar PDF**.

## 13. Registre um pagamento e conecte um agente

De volta à fatura, abra o menu **...**, escolha **Registrar pagamento** e registre 500 por transferência bancária. Você chegará à lista Pagamentos; abra a fatura novamente.

Sucesso: o status é parcial e o saldo devido é $1,000.00.

Abra **Agentes** e escolha **Conectar**. Sucesso: a URL MCP exibida é `http://localhost:3000/api/mcp`. Com o Claude Code instalado:

```sh
claude mcp add --transport http faturador-local http://localhost:3000/api/mcp
```

Execute `/mcp` no Claude Code, escolha `faturador-local`, entre e aprove. Sucesso: a página de consentimento pergunta qual empresa e quais permissões, e `claude mcp list` mostra `faturador-local` como conectado.

## 14. Opcional: pagamentos com cartão pela sua conta Stripe (modo de teste)

É necessária uma conta Stripe em modo de teste e a [Stripe CLI](https://docs.stripe.com/stripe-cli). Pare o servidor de desenvolvimento. Em `.env.local`, defina `STRIPE_SECRET_KEY` (`sk_test_...`) e `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_...`). Em um segundo terminal, execute:

```sh
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copie o segredo `whsec_...` impresso para `STRIPE_WEBHOOK_SECRET` e inicie novamente o servidor de desenvolvimento. Agora, em **Agentes**, abra **Pagamentos**. A página informa que os pagamentos com cartão estão ativados, em modo de teste. Abra o link público da fatura e pague o saldo com o cartão `4242 4242 4242 4242`, qualquer data de validade futura e qualquer CVC.

Sucesso: o pagamento é aprovado, o terminal `stripe listen` mostra que `payment_intent.succeeded` recebeu resposta 200, e a fatura passa para paga.

## 15. Opcional: envio de faturas por e-mail via Resend

É necessária uma conta Resend própria e um domínio de envio verificado. Pare o servidor de desenvolvimento e adicione a `.env.local`:

```
RESEND_API_KEY=re_your_key
RESEND_INVOICE_FROM=Fieldstone Digital <invoices@seu-dominio-verificado.example>
```

Inicie novamente o servidor de desenvolvimento, altere o e-mail do cliente para um endereço seu e escolha **Enviar fatura** em uma fatura.

Sucesso: o e-mail chega ao seu endereço com o PDF da fatura anexado.

## 16. Opcional: o contêiner de produção

Siga "Testar o contêiner com o banco de dados local de desenvolvimento" em [self-hosting.md](self-hosting.md). Primeiro, pare o servidor de desenvolvimento. Se escolheu outra porta para o aplicativo na etapa 2, defina também `BILLR_PORT` com esse valor, para que o contêiner escute no endereço indicado em `.env.local`.

Sucesso: `docker compose --env-file .env.local ps` informa que o aplicativo está `healthy`, e você consegue entrar em http://localhost:3000 e ver Harbor & Lane.

## 17. Limpeza

```sh
docker compose --env-file .env.local down
supabase stop --workdir .self-host/billr-local-56421
```

Sucesso: ambos os comandos terminam. Seus dados locais permanecem até que você exclua os volumes do Docker por conta própria.

## Relatório

Para cada etapa, escreva PASS ou FAIL. Em caso de FAIL, inclua o número da etapa, o comando ou clique, a mensagem exata, seu sistema operacional, `node --version` e `supabase --version`. Nunca cole o conteúdo de `.env.local`.
