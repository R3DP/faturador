# Plugins do Faturador

Os pacotes de plugin deste repositório incluem integrações com o serviço **Billr hospedado**, em `https://mcp.billr.cc`. Esse serviço pertence ao projeto upstream `ethanplusai/billr` e não é o Faturador auto-hospedado. Entre com sua conta do serviço upstream e escolha a empresa e as permissões. Instalar um plugin não cria uma conta nem inclui uma assinatura.

| Plataforma | Pacote / conexão |
| --- | --- |
| Claude Code | [Guia de conexão com o serviço upstream hospedado](https://billr.cc/docs/connect) |
| Codex e ChatGPT | `codex/billr`, com manifestos portáteis e do Codex |
| Cursor e Grok Bot | [Guia de conexão com o serviço upstream hospedado](https://billr.cc/docs/connect) |
| OpenClaw | skill `openclaw/billr`; configure o MCP remoto separadamente |
| Claude na web/desktop | Conector personalizado usando a URL hospedada |
| Grok na web / API da xAI | Conexão MCP remota; distinta do Grok Bot |

Consulte o README da plataforma para a instalação. Um pacote neste repositório
não significa que ele foi aprovado ou publicado no diretório de uma plataforma.

## Autenticação e permissões

Use OAuth sempre que houver suporte. Informe a URL hospedada, sem segredo de
cliente ou credencial incorporada. Na tela de consentimento do serviço Billr hospedado (upstream, não o Faturador), escolha
uma única empresa de teste e apenas leitura na primeira verificação. Conceda
acesso de gravação/rascunho somente quando necessário. Enviar, registrar
pagamentos e excluir exigem permissões adicionais e um pedido explícito do
usuário. A skill incluída segue um fluxo que prioriza rascunhos.

Clientes que usam chaves de API podem usar uma chave de escopo restrito, criada
na página de agentes do serviço Billr hospedado (upstream). Use o suporte do cliente a variáveis de ambiente;
nunca faça commit de uma chave nem a cole no chat. Cada plataforma recebe os
dados retornados pelas ferramentas que você autorizar.

## Instalações auto-hospedadas

O aplicativo deste repositório também pode ser executado de forma independente.
Para conectar à sua própria instalação do Faturador, configure diretamente no
seu agente `https://<seu-dominio>/api/mcp` com o alias local `faturador`, ou edite uma cópia privada da URL do MCP
de um plugin antes de instalá-lo. Em clientes desktop locais, essa URL pode ser
`http://localhost:3000/api/mcp`, também com o alias local `faturador`. Clientes na nuvem precisam de um endpoint HTTPS
acessível por seus servidores. Não altere o pacote upstream distribuído para
uma instalação individual. O serviço Billr hospedado é separado do Faturador; Faturador é
a marca deste aplicativo local/auto-hospedado.

## Verificar cada plataforma

1. Instale em um perfil limpo e confira se a skill e a conexão MCP aparecem.
2. Entre com OAuth; aprove apenas leitura em uma empresa fictícia de teste.
3. Peça para listar os clientes e o trabalho não faturado. Confirme a empresa e a moeda corretas.
4. Peça um rascunho com acesso somente de leitura: deve recusar sem criar dados.
5. Reconecte com acesso de gravação e peça explicitamente um rascunho fictício.
6. Se o teste usar o serviço hospedado, verifique o rascunho no Billr upstream; esse serviço não é o Faturador auto-hospedado. Nenhum e-mail nem pagamento deve ocorrer.
7. Revogue somente a conexão criada para este teste e confirme que o acesso falha.
8. Reconecte e repita a leitura. Em hosts com interface, confira também a renderização dos cartões.

Execute as verificações automatizadas do pacote com:

```sh
node app/scripts/generate-plugin-tool-reference.mjs --check
node --test app/scripts/plugin-packages.test.mjs
```

A skill compartilhada e a referência de ferramentas são geradas em cada estrutura
de plataforma. Edite `shared/skill/` e execute `node app/scripts/generate-plugin-tool-reference.mjs`.
