# Executar o Faturador

O Faturador é uma ferramenta interna: sua empresa o executa para uso próprio. Este guia aborda a instalação local no seu computador e a instalação de produção em um servidor, conectado a um projeto Supabase seu. Não existe banco de dados, conta, chave de API nem plataforma de pagamento compartilhados do Faturador.

`/` abre o espaço de trabalho para um usuário conectado e, caso contrário, a página de login. Não há página inicial.

## Instalação local

Siga o início rápido no README ou consulte [fresh-machine-test.md](fresh-machine-test.md) para um passo a passo que descreve como identificar o sucesso em cada etapa. Execute primeiro `npm run doctor` para verificar o Node.js, o Docker, a Supabase CLI e as portas.

`npm run setup:local` inicia um projeto Supabase dedicado nas portas 56420 a 56429, aplica o esquema e grava `app/.env.local` com modo 0600. O comando se recusa a sobrescrever uma configuração existente. `BILLR_LOCAL_APP_PORT` e `BILLR_LOCAL_DB_PORT` substituem a porta do aplicativo e a porta base da API. `BILLR_SUPABASE_CLI` define o nome do binário da Supabase CLI executado por `setup:local` e `doctor`, por exemplo, uma cópia fixada fora do seu `PATH` (o padrão é `supabase`). Não reutilize credenciais de desenvolvimento na internet.

Pare o backend local sem excluir os dados:

```sh
supabase stop --workdir .self-host/billr-local-56421
```

A CLI pode publicar portas do banco além da interface de loopback; mantenha esta stack em uma máquina confiável, protegida por firewall. Esta não é uma configuração de produção.

## Backend de produção: seu Supabase

Provisione um projeto Supabase vazio que pertença a você ou siga o [guia oficial de auto-hospedagem do Supabase com Docker](https://supabase.com/docs/guides/self-hosting/docker) em uma infraestrutura sob seu controle. O arquivo Compose do Faturador executa o **aplicativo**, não uma segunda cópia do Supabase.

Para um backend auto-hospedado, gere novos segredos de produção seguindo as instruções do Supabase; não mantenha senhas nem segredos JWT de exemplo. Disponibilize a API pública por HTTPS, restrinja o banco de dados e o Studio aos administradores e habilite Auth, PostgREST e Storage. Preserve os volumes do banco de dados e do Storage.

Aplique as migrações em `app/supabase/migrations` com a Supabase CLI: uma migração de base, `00001_baseline.sql`, e todas as migrações numeradas posteriores. A partir de `app`, com `BILLR_DATABASE_URL` definida no shell como a string de conexão direta do Postgres do seu backend:

```sh
supabase db push --db-url "$BILLR_DATABASE_URL" --include-all
```

Use um banco de dados vazio na primeira instalação. A migração de base inclui as tabelas, as regras de autorização, as funções, os buckets de armazenamento e suas políticas. Não são necessários dados de seed.

## Configurar o aplicativo

A partir de `app`:

```sh
cp .env.example .env.local
chmod 600 .env.local
```

| Variável | Finalidade |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Origem HTTPS do seu aplicativo, por exemplo, `https://invoices.example.org`, sem caminho. |
| `NEXT_PUBLIC_SUPABASE_URL` | Origem HTTPS pública da API Supabase. Os navegadores precisam acessá-la. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Sua chave pública anon ou publishable. Nunca use uma chave service-role ou secreta. |
| `SUPABASE_SERVICE_ROLE_KEY` | Sua chave service-role ou secreta. Somente no servidor; nunca a passe como argumento de build. |
| `SUPABASE_INTERNAL_URL` | Opcional: origem da API para comunicação entre servidores do **mesmo** backend. Os navegadores continuam usando a URL pública. |
| `BILLR_OPEN_SIGNUP` | Opcional. `true` mantém o cadastro aberto após a primeira conta. Veja abaixo. |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Pagamentos com cartão, opcionais. Defina as três variáveis ou nenhuma. Veja abaixo. |
| `RESEND_API_KEY`, `RESEND_INVOICE_FROM` | E-mail de faturas, opcional. Veja abaixo. |
| `BILLR_EMAIL_DAILY_LIMIT` | Limite opcional de e-mails por empresa a cada 24 horas. |
| `BILLR_TRUSTED_IP_HEADER` | Opcional. Consulte "Endereços de clientes e limites de requisições". |

Configure a URL do site do Supabase Auth para a origem do seu aplicativo e permita a URL `/api/auth/callback` da sua origem como URL de redirecionamento. Para uma instalação de produção, configure o SMTP de autenticação para que os e-mails de redefinição de senha sejam enviados.

## Cadastro e colegas de equipe

A primeira pessoa que se cadastra é proprietária da instalação. Depois disso, o cadastro é fechado:

- a página de cadastro informa isso e não mostra formulário;
- uma nova conta criada por **Continue with GitHub** ou **Google** é desconectada imediatamente;
- o banco de dados se recusa a criar uma empresa para uma conta que a instalação nunca admitiu, mesmo quando alguém faz a chamada diretamente com sua chave pública.

Cadastre-se como proprietário logo após a instalação, antes que qualquer outra pessoa consiga acessar o endereço. Se você ativar confirmações de e-mail no Supabase Auth, a conta passa a ser considerada a primeira assim que o formulário de cadastro é enviado, antes da confirmação do endereço. Portanto, de outro modo, o cadastro não confirmado de outra pessoa poderia reivindicar a instalação.

Depois que a conta do proprietário existir, também desative a opção **Permitir que novos usuários se cadastrem** no seu projeto Supabase (Autenticação, Provedores de entrada) em uma instalação de produção. O Faturador já recusa novas contas, mas, com essa opção desativada, ninguém consegue sequer criar uma conta no Supabase Auth. Na stack local, a configuração correspondente é `enable_signup` em `[auth]` no arquivo `.self-host/billr-local-56421/supabase/config.toml`, a cópia criada por `npm run setup:local`.

Para conceder acesso a um colega:

1. Defina `BILLR_OPEN_SIGNUP=true`, reinicie o Faturador (e reative **Permitir que novos usuários se cadastrem** no Supabase, caso a tenha desativado).
2. Peça que a pessoa se cadastre.
3. Defina `BILLR_OPEN_SIGNUP` novamente como vazio (ou remova a variável), reinicie e desative mais uma vez a opção do Supabase.
4. Adicione a pessoa a uma empresa. Ainda não há tela de convite, então esta etapa é feita no editor SQL do Supabase. Substitua o UUID de exemplo pelo ID único da empresa; o bloco verifica que esse ID corresponde a exatamente uma empresa antes de inserir a associação:

```sql
do $$
declare
  v_business_id uuid := '00000000-0000-0000-0000-000000000000'; -- substitua pelo ID da empresa
  v_business_count integer;
  v_user_id uuid;
begin
  select count(*) into v_business_count
  from public.businesses
  where id = v_business_id;

  if v_business_count <> 1 then
    raise exception 'Esperada exatamente 1 empresa para business_id %, encontradas %',
      v_business_id, v_business_count;
  end if;

  select id into strict v_user_id
  from auth.users
  where email = 'teammate@fieldstone.example';

  insert into public.business_members (business_id, user_id, role)
  values (v_business_id, v_user_id, 'member');
end
$$;
```

Use `admin` em vez de `member` para alguém que possa aprovar preços de tarefas. Você também pode criar a pessoa diretamente no Supabase Studio (Autenticação, Adicionar usuário) e ignorar as etapas 1 a 3: uma conta que pertença a uma empresa é admitida quando inicia sessão pela primeira vez.

Remover alguém de uma empresa não remove seu acesso à conta. Uma conta admitida continua admitida: a pessoa ainda pode entrar, mas não verá nenhuma empresa. Para impedir totalmente que entre, exclua o usuário no Supabase Studio (Autenticação, Usuários). O banco de dados se recusa a excluir um usuário cujas ações constem nos registros de auditoria do Faturador (chamadas de ferramentas do agente, correções de pagamentos, eventos de tarefas, aprovações de preços de tarefas em `billing_policies.approved_by`), pois esses registros são preservados.

## Opcional: login com GitHub e Google

As páginas de login e cadastro mostram um botão do GitHub ou do Google somente quando esse provedor está habilitado no seu projeto Supabase; portanto, habilitá-lo não exige uma nova implantação.

- **GitHub:** crie um aplicativo OAuth no GitHub (Configurações, Configurações de desenvolvedor, Aplicativos OAuth). Defina a URL de retorno de autorização como `/auth/v1/callback` do seu projeto Supabase (não a rota do Faturador). No Supabase, acesse Autenticação, Provedores de entrada, GitHub; habilite-o e informe o ID e o segredo do cliente. O Faturador solicita somente autenticação, sem acesso a repositórios.
- **Google:** crie no Google Cloud um cliente OAuth do tipo Aplicativo da Web. Adicione `/auth/v1/callback` do seu projeto Supabase como URI de redirecionamento autorizada e, em seguida, habilite o Google no Supabase com esse ID e segredo do cliente.

O Supabase então retorna ao Faturador em `/api/auth/callback`, que precisa constar nas URLs de redirecionamento permitidas do Supabase. Os segredos dos provedores ficam somente no Supabase, nunca no ambiente do Faturador. O fechamento do cadastro também se aplica a esses botões.

## Compilar e executar

Na construção da imagem, o Next.js usa um heap de 3 GB; portanto, disponibilize pelo menos 4 GB de memória ao Docker, ou 6 GB se ele executar outras tarefas (Docker Desktop: Configurações > Recursos > Memória). O contêiner em execução precisa de bem menos. Em um host de compilação menor, reduza o heap com `BILLR_BUILD_HEAP_MB=2048 docker compose --env-file .env.local build`; abaixo de cerca de 2 GB, a compilação fica sem memória.

Execute a partir de `app`:

```sh
npm ci
npm run check:config
docker compose --env-file .env.local build
docker compose --env-file .env.local up -d
docker compose --env-file .env.local ps
```

O contêiner é executado como usuário não root e, por padrão, faz bind somente em `127.0.0.1:3000` no host; defina `BILLR_PORT` no shell para usar outra porta no host. Coloque seu proxy reverso HTTPS à frente dele. Encaminhe o Host e o esquema originais e permita HTTP em streaming, sem buffer, em `/api/mcp`. Não exponha o banco de dados, o Studio nem as interfaces de service-role. `/api/health` verifica somente se o serviço está ativo.

**Endereços de clientes e limites de requisições.** Os bloqueios de login e os links públicos de pagamento têm limites por endereço do solicitante, e esse endereço vem de um cabeçalho do proxy. Seu proxy precisa ACRESCENTAR o peer real a `X-Forwarded-For` (nginx: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`), pois o Faturador lê a última entrada, a única que o cliente não pode escolher. Se o proxy, em vez disso, SOBRESCREVER um cabeçalho de valor único, informe seu nome em `BILLR_TRUSTED_IP_HEADER` (por exemplo, `X-Real-IP` com `proxy_set_header X-Real-IP $remote_addr;`). Nunca indique um cabeçalho que o proxy encaminhe sem alteração. Se nenhum estiver configurado, todos os solicitantes compartilham o mesmo grupo de limite: os limites continuam valendo, mas são compartilhados.

Os valores `NEXT_PUBLIC_*` são compilados no código do navegador. Recompile sempre que as URLs públicas ou a chave publishable do Stripe mudarem. Os segredos do servidor são carregados em tempo de execução por `.env.local`, que é excluído do contexto de build do Docker.

Se o backend estiver no mesmo host, `127.0.0.1` dentro do contêiner do aplicativo se refere ao próprio contêiner. Use o nome de host da API pública ou um `SUPABASE_INTERNAL_URL` e uma rede Docker configurados corretamente; ambas as URLs de API precisam identificar o mesmo projeto. O contêiner se recusa a iniciar com uma `NEXT_PUBLIC_SUPABASE_URL` de loopback e sem `SUPABASE_INTERNAL_URL`, e informa isso em `docker compose logs app`.

### Testar o contêiner com o banco de dados local de desenvolvimento

Para testar a imagem de produção na sua máquina antes de ter um backend real, aponte-a para o banco de dados iniciado por `npm run setup:local`. Seu navegador continua usando `http://127.0.0.1:56421`; as chamadas do próprio servidor do contêiner vão para `host.docker.internal`, que o Compose mapeia para sua máquina no macOS, Windows e Linux. Primeiro, pare `npm run dev`, pois ambos usam a mesma porta. Se você passou `BILLR_LOCAL_APP_PORT` para `setup:local`, também execute `export BILLR_PORT=` com essa porta, para que o contêiner responda onde `NEXT_PUBLIC_APP_URL` aponta. A partir de `app`:

```sh
export SUPABASE_INTERNAL_URL=http://host.docker.internal:56421
docker compose --env-file .env.local build
docker compose --env-file .env.local up -d
docker compose --env-file .env.local ps
```

A variável vem do seu shell, então `.env.local` continua utilizável por `npm run dev`. Em até um minuto, `ps` deve informar que o aplicativo está `healthy`; depois, entre em http://localhost:3000 (ou na porta definida em `BILLR_PORT`) com a conta criada durante o desenvolvimento. Nesta configuração, os PDFs de fatura são renderizados sem seu logotipo: o renderizador de PDF só busca logotipos na origem pública de armazenamento, e essa origem é loopback aqui. Esta receita serve para testar a imagem localmente; não é uma configuração de produção.

## Receber pagamentos com cartão

Os pagamentos com cartão usam sua própria conta Stripe, compartilhada por todas as empresas da instalação. Os clientes pagam na página da fatura com o Elemento de pagamento (Payment Element) da Stripe; o valor é sempre obtido da fatura no servidor.

1. No painel da Stripe, abra Desenvolvedores > Chaves de API. Copie a chave publicável (`pk_...`) e a chave secreta (`sk_...`). Comece com chaves de teste.
2. Abra Desenvolvedores > Webhooks e adicione um endpoint em `https://YOUR_APP/api/stripe/webhook` que envie `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded` e `charge.dispute.created`. Crie-o como endpoint da sua própria conta, não de contas conectadas. Copie o segredo de assinatura (`whsec_...`).
3. Defina `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` e `STRIPE_WEBHOOK_SECRET`, todas no mesmo modo (teste ou produção), e reinicie. Uma imagem Docker precisa ser recompilada, pois a chave publicável é compilada no código do navegador. `npm run check:config` recusa um conjunto incompleto ou com modos misturados.

**Agentes → Pagamentos** mostra se os pagamentos com cartão estão ativados, em qual modo e qual URL de webhook usar. No seu computador, a Stripe CLI encaminha eventos em vez de usar um endpoint de webhook: `stripe listen --forward-to localhost:3000/api/stripe/webhook` imprime um segredo de assinatura para usar como `STRIPE_WEBHOOK_SECRET`. Se o Faturador estiver em outra porta, substitua `3000` pela porta escolhida. Antes de mudar para chaves de produção, teste o ciclo completo com o cartão `4242 4242 4242 4242`: um pagamento, um pagamento parcial, um reembolso e uma contestação iniciada no painel do Stripe.

Sem as chaves do Stripe, todo o restante funciona; você registra os pagamentos à medida que são recebidos.

## E-mail de faturas

O e-mail é opcional. Sem ele, tudo funciona, exceto o envio de documentos pelo Faturador: escolha **Marcar como enviada** no menu **...** de uma fatura ou **Marcar como enviado** em um orçamento e, em seguida, compartilhe você mesmo o link público ou o PDF. Um rascunho não tem página pública. Para ativar o recurso, defina `RESEND_API_KEY` e `RESEND_INVOICE_FROM` com um endereço de um domínio verificado na sua própria conta Resend. `npm run check:config` recusa uma chave Resend sem remetente. `BILLR_EMAIL_DAILY_LIMIT` limita opcionalmente quantos documentos cada empresa pode enviar por e-mail a cada 24 horas. Os e-mails de autenticação (confirmação de cadastro e redefinição de senha) são configurados separadamente, como SMTP no seu projeto Supabase.

## Verificar a instalação

1. Cadastre-se, conclua a configuração inicial e adicione um cliente fictício.
2. Abra `/signup` em uma janela privativa: o cadastro aparece como fechado.
3. Crie uma fatura e um orçamento, registre horas e despesas e anote um pagamento parcial externo.
4. Confira Relatórios e baixe um PDF. Confirme que os links usam sua origem.
5. Crie uma chave de leitura e uma de rascunho. Conecte um agente usando a URL exibida em **Agentes → Conectar**. Confirme que ele não consegue enviar nem registrar pagamentos. Revogue a chave e confirme que o acesso é interrompido.
6. Aprove uma política de preços de tarefas, registre uma tarefa, revise os custos e prepare uma fatura em rascunho.
7. Inspecione as requisições de rede do navegador: as chamadas ao banco de dados vão para sua URL Supabase, e os provedores só aparecem quando você usa as integrações correspondentes.

Teste automatizado local de aceitação do MCP (gravações fictícias, nunca em produção), a partir de `app` após a configuração local:

```sh
DOTENV_CONFIG_PATH=.env.local node scripts/local-mcp-acceptance.mjs
```

O script encontra o aplicativo na `NEXT_PUBLIC_APP_URL` gravada por `setup:local`, então não é preciso fazer mais nada ao usar `BILLR_LOCAL_APP_PORT`; `BILLR_LOCAL_APP_URL` substitui a URL do MCP. Se você escolheu outra `BILLR_LOCAL_DB_PORT` para `setup:local`, informe aqui a mesma variável `BILLR_LOCAL_DB_PORT`. Os testes SQL em `supabase/tests` são executados na stack de teste incluída no repositório: execute `supabase start` e, em seguida, `npm run test:sql`. `BILLR_SQL_CONTAINER` define o nome do contêiner do banco de dados usado pelos testes quando ele não for o padrão `supabase_db_<project_id>` de `supabase/config.toml`.

## Atualizações, backups e recuperação

Faça backup dos dados do Postgres, dos dados e da configuração do Supabase Auth, dos objetos do Storage e dos seus segredos usando o processo de backup compatível com seu backend. Um dump do banco de dados não inclui os logotipos enviados. Teste a restauração em uma instalação separada antes de depender do backup.

Antes de uma atualização: leia [CHANGELOG.md](../CHANGELOG.md), teste com uma cópia restaurada, faça um backup, aplique as migrações pendentes com `supabase db push`, recompile usando sua própria configuração pública e repita as verificações acima. Nunca edite uma migração que já tenha sido aplicada. Reverter a imagem do aplicativo não reverte uma alteração de esquema; restaure um backup verificado se a reversão exigir o esquema antigo.

Solução de problemas: confira os logs do contêiner sem compartilhar tokens nem dados de faturas; verifique se as duas origens da API chegam ao mesmo backend, se todas as migrações foram aplicadas, se os redirecionamentos do Auth correspondem, se as variáveis públicas foram recompiladas e se a chave service-role é usada somente no servidor.
