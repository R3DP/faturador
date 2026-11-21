# Registro de alterações

Todas as alterações relevantes deste projeto são documentadas aqui. O formato é baseado em [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), e este projeto segue o [Versionamento Semântico](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Primeira versão como repositório independente.

### Adicionado

- Espaço de trabalho de faturamento: clientes, itens, faturas, orçamentos, lançamentos de horas, despesas, pagamentos e relatórios, com numeração, moedas, descontos e impostos por empresa.
- Orçamentos que um cliente pode aprovar ou recusar por um link público e converter em fatura ou contrato de serviço.
- Contratos de serviço: total acordado com cronograma de cobrança, itens faturados a partir de uma fatura ou dispensados, e uma visualização de itens prontos para faturar.
- Pagamentos registrados por qualquer método, conciliados no banco de dados, com correções e anulações mantidas em um histórico de auditoria.
- Pagamentos opcionais com cartão na sua própria conta Stripe, configurados com três variáveis de ambiente, com eventos de webhook assinados e processados de forma idempotente para pagamentos, falhas, reembolsos e contestações.
- Envio opcional de faturas e orçamentos por e-mail usando sua própria conta Resend, com limite diário opcional.
- Cobrança de tarefas de agentes: abrir uma tarefa, enviar sinais de atividade, registrar o uso e concluir, deixando um registro para uma pessoa definir o preço e aprovar.
- Servidor MCP em `/api/mcp` com 53 ferramentas, OAuth 2.1 para conexão por URL e chaves de API `billr_sk_` com perfis de permissão, atividade e visualizações de auditoria.
- `packages/agent-kit` e pacotes de conexão de agentes em `plugins` para Claude Code, Codex, Cursor e OpenClaw, além de notas de conexão para Grok.
- O cadastro é fechado após a primeira conta, que se torna proprietária da instalação; `BILLR_OPEN_SIGNUP=true` reabre o cadastro.
- Uma migração de linha de base do banco de dados com testes SQL (`npm run test:sql`).
- `npm run doctor`, `npm run setup:local`, um Dockerfile e um arquivo Compose com uma receita documentada para o banco de dados local, e [docs/fresh-machine-test.md](docs/fresh-machine-test.md).
- CI: testes unitários, lint, verificação de tipos, verificação de código não utilizado, compilação, auditoria de dependências, testes SQL, detecção de divergência nos tipos gerados e compilação de contêiner.

### Segurança

- O acesso público a faturas e orçamentos ocorre somente por funções de leitura do banco de dados, identificadas por um `public_id` secreto e que retornam uma lista permitida de colunas.
- Cada ferramenta e rota resolve dados dentro do escopo de uma empresa; um registro inexistente e um registro fora do escopo retornam o mesmo erro genérico.
- Cada função e tabela declara explicitamente seus privilégios, revogados para `anon` e `authenticated` e concedidos novamente apenas quando necessário.
