<p align="center">
  <img src="docs/images/wordmark.png" alt="Faturador" width="180">
</p>

<p align="center"><strong>Faturamento autônomo para o seu negócio e para os agentes que trabalham nele.</strong></p>

<p align="center">
O Faturador é a versão em português e adaptada para o Brasil (baseada no fork do <a href="https://github.com/ethanplusai/billr">Billr</a>) para gerenciar clientes, faturas, orçamentos, compromissos, horas, despesas, pagamentos e relatórios.
Ele também é um servidor MCP integrado, permitindo que agentes de IA (como Claude Code, Codex, Cursor) executem tarefas de faturamento com segurança e controle de chaves revogáveis.
</p>

<p align="center">
  <a href="LICENSE"><img alt="Licença: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"></a>
  <a href=".nvmrc"><img alt="Node 22+" src="https://img.shields.io/badge/node-22%2B-informational.svg"></a>
</p>

## O que é o Faturador

O Faturador é um sistema de faturamento self-hosted construído para colaboração com agentes de IA. Você o executa no seu próprio servidor ou computador, você e seus agentes faturam seus clientes a partir dele, e as únicas pessoas de fora que têm acesso são os próprios clientes através das páginas de faturas e orçamentos enviadas a eles.

- **Um único proprietário.** O primeiro usuário a se cadastrar torna-se o dono da instalação, e novos cadastros são fechados em seguida.
- **Sua conta Stripe.** Pagamentos por cartão vão direto para a sua conta Stripe configurada nas variáveis de ambiente. Nada fica no meio do caminho.
- **Seu banco de dados.** Tudo roda em um projeto Supabase sob o seu controle (local ou gerenciado).
- **Seus agentes.** Claude Code, Codex, Cursor e qualquer cliente MCP conectam-se via URL em `/api/mcp`.

## Início rápido

Você precisa do Node.js 22 ou superior, Docker rodando e a [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) 2.67.1 ou superior.

```sh
git clone https://github.com/Rodpais/faturador.git
cd faturador/app
npm run doctor
npm ci
npm run setup:local
npm run dev -- --hostname 127.0.0.1
```

Abra `http://localhost:3000` e crie sua conta.

## Documentação e Arquivos de Apoio

Consulte a pasta `arquivos/` para especificações adicionais e notas de tradução e integrações (como PostgreSQL/Split).
