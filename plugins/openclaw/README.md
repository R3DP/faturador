# Conectar o OpenClaw ao serviço upstream Billr

Esta skill conecta o agente ao serviço upstream Billr hospedado em `https://mcp.billr.cc`, que não é o Faturador auto-hospedado. É necessária uma conta do serviço upstream; a instalação não inclui assinatura. Configure o servidor MCP com o alias local `faturador`:

```sh
openclaw mcp set faturador '{"url":"https://mcp.billr.cc","transport":"streamable-http","auth":"oauth"}'
openclaw mcp login faturador
openclaw mcp tools faturador
```

Copie a pasta da skill upstream `billr/` para o diretório de skills do OpenClaw. Aprove somente a empresa
e as permissões necessárias para a tarefa. Use OAuth, não chaves bearer em
comandos ou no chat. Primeiro, solicite trabalho não faturado; confirme que
nenhuma gravação acontece.

Para sua própria instalação do Faturador, configure uma conexão MCP separada com o alias local `faturador` e substitua explicitamente pela URL HTTPS `/api/mcp` da sua instalação. Clientes na nuvem não conseguem acessar um
servidor localhost no seu computador.

## Publicação no ClawHub

A skill é distribuída aqui sob a licença Apache-2.0. Atualmente, o ClawHub exige
MIT-0 para skills publicadas. A pessoa responsável pelo projeto deve aprovar qualquer alteração de licença necessária antes do envio. Não reclassifique este arquivo
automaticamente. Instalar uma skill localmente é diferente de listá-la no
ClawHub.

Fontes: https://docs.openclaw.ai/clawhub/skill-format,
https://docs.openclaw.ai/cli/mcp/transports.
