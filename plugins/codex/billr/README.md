# Plugin upstream Billr para Codex e ChatGPT

O pacote `billr/` conecta-se ao serviço upstream Billr hospedado em `https://mcp.billr.cc`. Esse serviço não é o Faturador auto-hospedado. O pacote inclui Agent Plugins portáveis e manifestos do Codex, configuração MCP com OAuth, recursos para listagem e a skill de faturamento gerada. É necessária uma conta do serviço upstream; a instalação não inclui uma assinatura.

## Instalar no Codex

A partir de um checkout, instale o pacote. Depois, autorize a conexão MCP pelo fluxo OAuth apresentado pelo Codex:

```sh
codex plugin marketplace add ./plugins/codex
codex plugin add billr@billr
```

Para configurar somente o MCP do serviço upstream hospedado, use o alias local `faturador`:

```sh
codex mcp add faturador --url https://mcp.billr.cc
codex mcp login faturador
codex mcp list
```

Use apenas um dos métodos de configuração para evitar servidores duplicados. Selecione a
empresa e as permissões mínimas no navegador. Nunca cole credenciais no chat. Os comandos acima apontam para o Billr upstream hospedado, não para o Faturador. Para conectar o Faturador auto-hospedado, substitua o domínio de exemplo pela origem HTTPS da sua instalação e use o alias local `faturador`:

```sh
codex mcp add faturador --url https://faturador.sua-empresa.example/api/mcp
codex mcp login faturador
codex mcp list
```

## ChatGPT e distribuição pública

Teste o servidor upstream Billr hospedado (não o Faturador auto-hospedado) pelo fluxo de conexão MCP personalizado/de desenvolvedor disponível na sua conta. Teste o acesso somente para leitura, a criação explícita de
rascunhos e os cartões antes do envio. A disponibilidade da interface varia conforme o
cliente; os resultados em texto continuam necessários.

A publicação no diretório público exige o envio de um ZIP de plugin da OpenAI, identidade de
publicação verificada, verificações automatizadas, acesso do revisor e aprovação da revisão.
O pacote não tem arquivo de referência do app nem ganchos (hooks) de ciclo de vida: por isso, não está
qualificado para o envio público atual. Envie um ZIP cuja raiz seja `billr/`, contendo os
manifestos, arquivos MCP, skills, recursos e avisos de licença. Não inclua credenciais,
senhas de revisor nem notas privadas de auditoria.

Fontes: https://developers.openai.com/plugins/build/plugins,
https://developers.openai.com/plugins/deploy/submission.
