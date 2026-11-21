# Skill upstream Billr para OpenClaw

Esta skill conecta o agente ao serviço upstream Billr hospedado em `https://mcp.billr.cc`, que não é o Faturador auto-hospedado. É necessária uma conta do serviço upstream; a instalação não inclui uma assinatura. Configure o servidor MCP com o alias local `faturador`:

```sh
openclaw mcp set faturador '{"url":"https://mcp.billr.cc","transport":"streamable-http","auth":"oauth"}'
openclaw mcp login faturador
openclaw mcp tools faturador
```

Copie a pasta da skill upstream `billr/` para o diretório de skills do OpenClaw. Aprove somente a empresa e as
permissões necessárias para a tarefa. Use OAuth, não chaves bearer em comandos nem no chat.
Primeiro, peça a lista de trabalho não faturado; verifique que nenhuma gravação ocorra.

Para sua própria instalação do Faturador, configure uma conexão MCP separada com o alias local `faturador` e use explicitamente o endpoint HTTPS `/api/mcp` dela. Clientes na nuvem não conseguem acessar um servidor localhost no seu computador.

## Publicação no ClawHub

A skill é distribuída aqui sob a licença Apache-2.0. Atualmente, o ClawHub exige a licença
MIT-0 para skills publicadas. A pessoa responsável pelo projeto deve aprovar qualquer alteração de licença
necessária antes do envio. Não altere automaticamente a licença deste arquivo. A instalação
de uma skill local é diferente de sua publicação no ClawHub.

Fontes: https://docs.openclaw.ai/clawhub/skill-format,
https://docs.openclaw.ai/cli/mcp/transports.
