# Contribuindo com o Faturador

Agradecemos seu interesse em ajudar. Leia esta página antes de abrir um pull request; isso evita uma rodada extra de revisão.

## Para que serve o Faturador

Faturador é um sistema de faturamento auto-hospedado que pessoas e seus agentes executam para cobrar seus próprios clientes. São bem-vindas alterações que sirvam a esse propósito. Alterações que o transformem em um serviço hospedado não são aceitas: planos e períodos de avaliação, uma plataforma de pagamentos entre a pessoa que opera o sistema e a Stripe, uma central pública de suporte, aceite de termos e telemetria. Os pull requests são revisados e integrados aqui. As contribuições são aceitas sob a licença Apache-2.0, a mesma licença do projeto.

## Configuração local

Você precisa do Node.js 22+, Docker e da [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) 2.67.1 ou mais recente.

```sh
git clone --branch pt-br https://github.com/R3DP/faturador
cd faturador/app
npm run doctor
npm ci
npm run setup:local
npm run dev -- --hostname 127.0.0.1
```

`npm run setup:local` inicia um projeto Supabase local isolado, aplica todas as migrações e grava um arquivo `app/.env.local` ignorado pelo Git. Nunca direcione o desenvolvimento local, os testes ou as execuções de aceitação a um banco de dados que contenha faturas reais.

## Ramificações, commits e pull requests

- Crie a branch a partir de `pt-br`. Dê a ela um nome que descreva a alteração, por exemplo `corrigir-conversao-orcamento-moeda`. Direcione o pull request para `pt-br`.
- Um assunto por pull request. É difícil revisar e ainda mais difícil reverter uma refatoração combinada com uma alteração de comportamento.
- Escreva os assuntos dos commits no imperativo, com cerca de 72 caracteres no máximo, descrevendo o que a alteração faz, e não o que você fez: `Fature lançamentos de contrato a partir de faturas`, em vez de `ajustes diversos`. Explique o motivo no corpo, com linhas limitadas a 72 colunas.
- A descrição do pull request deve explicar qual era o problema, qual é o comportamento resultante e como você o validou. Inclua os comandos executados.

## Testes a executar

A partir de `app/`:

```sh
npm test                  # testes unitários e de integração (vitest)
npm run test:installation # verificações de configuração, scripts e repositório
npm run lint              # eslint
npm run typecheck         # next typegen e depois tsc
npm run check:unused      # arquivos, exportações e dependências não utilizados (knip)
npm run build             # compilação de produção
supabase start && npm run test:sql   # testes SQL, para alterações no banco de dados
```

Execute todos para qualquer alteração que toque código compartilhado. Acrescente testes junto com a alteração: uma correção de bug deve vir acompanhada do teste que teria detectado o problema.

## Migrações do banco de dados

As migrações são somente de acréscimo. Uma migração aplicada em qualquer lugar faz parte do histórico, e o histórico não é editado.

- O esquema começa com uma migração de linha de base, `app/supabase/migrations/00001_baseline.sql`. Acrescente cada alteração em um novo arquivo com o próximo número, preenchido com zeros até cinco dígitos, e uma descrição curta em snake_case: `00002_short_description.sql`.
- Nunca modifique uma migração aplicada nem renumere uma. Corrija um erro com uma nova migração.
- Verifique cada migração duas vezes: em um banco de dados novo (`supabase db reset`) e em um banco local existente com as migrações anteriores já aplicadas (`supabase migration up`). Ambas devem funcionar, e `npm run test:sql` deve passar.
- Toda função `SECURITY DEFINER` deve terminar com `SET search_path = public, pg_temp`. `CREATE OR REPLACE FUNCTION` substitui toda a configuração em vez de mesclá-la, portanto recriar uma função remove silenciosamente essa fixação. `app/supabase/tests/security.sql` verifica se todas as funções em `public` a mantêm.
- **Concessões não são trabalho opcional.** O Supabase concede `EXECUTE` em cada função nova a `anon`, `authenticated` e `service_role` nominalmente; portanto, `REVOKE ALL ON FUNCTION ... FROM PUBLIC` não restringe o acesso. Execute explicitamente `REVOKE ALL ON FUNCTION ... FROM anon, authenticated`, depois conceda de volta com `GRANT` somente o necessário e verifique o resultado na mesma migração com `has_function_privilege(...)`.
- O acesso público a faturas e orçamentos ocorre somente por funções dedicadas `SECURITY DEFINER` identificadas por `public_id`. Não adicione políticas amplas de `SELECT` a `invoices` ou `estimates`.
- Os dados públicos são montados a partir de uma **lista de permissões** de colunas, nunca removendo colunas de uma linha. Adicionar uma coluna a `businesses` ou `clients` não pode ampliar o que um documento público expõe.
- Valide usando o esquema real, não um subconjunto reconstruído. Algumas restrições são adicionadas por `ALTER TABLE` depois que as tabelas existem e não serão reproduzidas por um esquema de teste simplificado.
- `app/src/types/database.ts` é gerado com `supabase gen types typescript --local --schema public`. Gere-o novamente após uma migração, em vez de editá-lo manualmente; a CI falha se ele estiver desatualizado.

## Regras do contrato de ferramentas MCP

O servidor MCP e o kit de ferramentas de agentes formam um contrato publicado. Agentes em uso dependem dele.

- Cada ferramenta deve acessar os dados pelos auxiliares de banco com escopo limitado. Uma consulta direta com a função service-role, sem filtro de escopo por empresa, nunca é aceitável em uma ferramenta.
- Um registro inexistente e um registro fora do escopo devem retornar o mesmo erro genérico. Erros diferentes informariam a um agente se existe a fatura de outra pessoa.
- Cada ferramenta deve pertencer a exatamente uma permissão. Ferramentas sem categoria são negadas por padrão; inclua a ferramenta no conjunto correto na mesma alteração.
- Um teste compara o catálogo de ferramentas com as ferramentas registradas. Nunca mantenha manualmente em outro lugar da base de código uma lista de ferramentas: uma lista escrita à mão já anunciou uma ferramenta inexistente e omitiu outra existente.
- Ferramentas de escrita que um agente possa tentar novamente devem receber um identificador de solicitação estável e ser idempotentes.
- Alterar o nome de uma ferramenta, seu esquema de entrada ou o significado de um campo é uma alteração incompatível. Informe isso no pull request.

## Regras de texto

Estas regras se aplicam a tudo que uma pessoa usuária possa ler: textos da interface, mensagens de erro, documentação, comentários e mensagens de commit.

- **Não use travessão longo.** Use vírgula, dois-pontos, ponto final ou parênteses.
- **Não invente métricas ou afirmações.** Nada de número de usuários, valores faturados, avaliações, números de "recomendado por" ou dados de desempenho que ninguém mediu.
- **Somente dados fictícios.** Conteúdo de exemplo e demonstração usa o elenco fictício do projeto (Fieldstone Digital, Harbor & Lane, Halcyon Labs, Meridian Design, Camber Coffee) em domínios `.example` reservados pela RFC 2606. Nunca use uma pessoa, empresa, cliente, domínio ou endereço de e-mail real, inclusive os seus.
- Escreva de forma simples. Diga o que algo faz e o que não faz.

## O que as pessoas mantenedoras não integrarão

- Qualquer coisa que enfraqueça o isolamento entre empresas: uma nova chamada com service-role, uma política ampla em nível de linha ou uma ferramenta que confie em um id de empresa fornecido pelo cliente.
- Alteração em uma migração já aplicada ou renumeração de uma migração.
- Segredos, arquivos de ambiente, despejos do banco de dados, faturas reais, logs ou artefatos de compilação enviados para a árvore do repositório.
- Canal de telemetria, análise, relatório de falhas ou atualização automática que envie dados da instalação para fora.
- Uma segunda implementação de algo que já existe, por exemplo, uma cópia paralela de uma lista de ferramentas, um cálculo de cobrança duplicado ou um caminho de código exclusivo do aplicativo que as ferramentas MCP não compartilhem.
- URL, endereço ou conta de provedor de uma instalação alheia codificados diretamente. Tudo de que uma pessoa operadora precisa deve vir do próprio ambiente dela.
- Recursos de SaaS: planos, períodos de avaliação, bloqueios por pagamento, pagamentos pela plataforma, formulário público de suporte, aceite de termos.
- Afirmações inventadas, travessões longos e dados reais de clientes em arquivos de teste.
- Dependência adicionada para poucas linhas de código ou cuja licença não seja compatível com Apache-2.0. Novos ativos de terceiros devem manter seus arquivos de licença e avisos.
- Uma grande reescrita não solicitada. Abra uma issue e combine a abordagem primeiro.

## Como relatar uma vulnerabilidade

Não abra um pull request nem uma issue pública sobre um problema de segurança. Siga [SECURITY.md](SECURITY.md).
