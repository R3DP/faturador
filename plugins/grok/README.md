# Integração upstream Billr para Grok Bot e Grok

## Grok Bot

Grok Bot é um produto distinto, com plugins e skills. O pacote compartilhado
do Cursor é mantido separadamente deste repositório de auto-hospedagem. Consulte
o [guia de conexão com o serviço upstream hospedado](https://billr.cc/docs/connect) para configurar.
O endpoint `https://mcp.billr.cc` pertence ao Billr upstream hospedado, não ao Faturador auto-hospedado.

Antes de publicar no marketplace, teste uma conexão MCP personalizada pedindo
ao Grok Bot que adicione o endpoint upstream hospedado. Depois, aprove somente a empresa e os
escopos desejados na página de login do serviço Billr hospedado. Não cole senhas ou chaves no chat.

## Grok web e a API xAI

São superfícies de integração distintas. Para o Grok na web, use o fluxo de
conector MCP personalizado com a mesma URL do serviço upstream hospedado. Para a API xAI, use uma
ferramenta MCP remota e uma chave bearer do serviço Billr hospedado com escopo restrito, carregada
de uma variável de ambiente secreta. Nunca incorpore credenciais em um pacote.
Essa integração com a API não é uma publicação no marketplace do Grok Bot.

Fontes: https://cursor.com/help/grok-bot/connect-plugins,
https://docs.x.ai/grok/connectors,
https://docs.x.ai/developers/tools/remote-mcp.
