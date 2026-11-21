# Plugin upstream do Billr para Codex e ChatGPT

O pacote `billr/` conecta-se ao serviço upstream Billr hospedado em `https://mcp.billr.cc`, que não é o Faturador auto-hospedado. Inclui Agent Plugins portáteis e manifestos do Codex, configuração OAuth MCP, recursos de listagem e a skill de faturamento gerada. É necessária uma conta do serviço upstream; a instalação não inclui assinatura.

## Instalar no Codex

Em um checkout, instale o pacote. Depois, autorize a conexão MCP pelo fluxo OAuth apresentado pelo Codex:

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

Use apenas um dos caminhos de configuração para evitar servidores duplicados.
No fluxo OAuth, selecione a empresa e as permissões mínimas no navegador. Nunca cole credenciais
no chat. Os exemplos acima apontam para o serviço upstream Billr, não para uma instalação do Faturador. Para conectar o Faturador auto-hospedado, substitua o domínio de exemplo pela origem HTTPS da sua instalação e use o alias local `faturador`:

```sh
codex mcp add faturador --url https://faturador.sua-empresa.example/api/mcp
codex mcp login faturador
codex mcp list
```

## ChatGPT e distribuição pública

Teste o servidor upstream Billr hospedado (não o Faturador auto-hospedado) pelo fluxo disponível na sua conta para estabelecer uma conexão MCP personalizada ou de desenvolvedor. Teste o acesso somente de leitura,
rascunhos explícitos e cartões antes do envio para análise. A disponibilidade
da interface varia conforme o cliente; resultados em texto continuam sendo
obrigatórios.

A publicação em diretório público exige o envio de um ZIP de plugin da OpenAI,
identidade de publicação verificada, verificações automatizadas, acesso do
avaliador e aprovação na análise. O pacote não tem arquivo de referência do
app nem hooks de ciclo de vida: portanto, não está qualificado para o envio
público atual. Envie um ZIP com raiz em `billr/`, contendo seus manifests,
arquivos MCP, skills, recursos e avisos de licença. Não inclua credenciais,
senhas para avaliadores nem notas privadas de auditoria.

Fontes: https://developers.openai.com/plugins/build/plugins,
https://developers.openai.com/plugins/deploy/submission.
