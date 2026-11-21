# AGENTS.md - Faturador

> Porta de entrada do projeto. Leia antes de agir no repositório.

## 1. O que é este projeto

Fork do Billr (`ethanplusai/billr`) adaptado como versão em português brasileiro e para o Brasil. A atribuição ao upstream deve permanecer clara; a interface, os textos e os exemplos locais usam a marca Faturador.

- **Repositório:** `https://github.com/R3DP/faturador`, organização R3DP. **Responsável:** Rodrigo Dias Pais.
- **Clone local:** qualquer diretório de trabalho do agente; o remoto canônico é o HTTPS acima. Não assuma caminho absoluto fixo.
- **Branch de localização:** `pt-br`.
- **Status:** desenvolvimento.

## 2. Leia nesta ordem, antes de agir

1. Este `AGENTS.md`: regras específicas do Faturador.
2. `README.md`: origem, instalação e uso do fork.
3. `docs/self-hosting.md` e `docs/fresh-machine-test.md`: operação e validação.
4. `app/package.json` e scripts citados no README: comandos efetivamente disponíveis.
5. Regras gerais/orquestração da máquina, se existirem no ambiente do agente (ex.: `~/.openclaw/workspace/`). São locais ao host, não fazem parte do repositório.

## 3. Regras invioláveis deste projeto

- Todo texto humano escrito para usuários/desenvolvedores brasileiros deve ficar em português brasileiro; nomes de marca locais e comandos de exemplo usam Faturador.
- Use Billr somente para identificar explicitamente o upstream, URLs/atribuição ou identificadores herdados que precisam de compatibilidade; explique essa distinção.
- Não renomeie contratos, campos JSON, variáveis de ambiente (`BILLR_*`), caminhos, pacotes ou IDs técnicos sem análise de compatibilidade e autorização.
- **`arquivos/` é material de apoio externo.** Nunca abrir, ler, alterar, versionar ou publicar nada em `arquivos/` sem decisão explícita do Rodrigo. Ferramentas de agente devem tratar esse diretório como fora de escopo.
- Nunca sobrescreva arquivo existente sem cópia prévia datada, guardada fora do checkout; não coloque backups dentro do repositório.
- `.env` e segredos ficam fora do git. Use `app/.env.example` como referência; nunca cole credenciais em documentação ou testes.
- Preserve alterações de terceiros no checkout. Não use `reset`/`clean` para descartar trabalho existente.
- Só publique depois de revisão independente e autorização vigente para push; quem implementa não homologa.
- Mudanças em `README.md`, marca/wordmark e código exigem escopo próprio; não misture com trabalho de documentação.

## 4. Ambientes

| Ambiente | Estado conhecido |
|---|---|
| Desenvolvimento | Execução local descrita no `README.md`; configure `app/.env` localmente a partir do exemplo. |
| Homologação | Não há ambiente do Faturador confirmado; não invente endereço, imagem ou digest. |
| Produção | Não há serviço do Faturador confirmado. |
| Banco | Depende da configuração Supabase/Postgres; não presuma que uma porta ou banco da máquina pertença ao Faturador. |

Homologação e produção só podem ser declaradas após prova do serviço e do digest.

## 5. Como rodar e testar

A raiz do aplicativo Next.js é `app/`; use o lockfile existente para instalação reproduzível:

```bash
cd app
npm ci
npm run dev
```

Da raiz do repositório, verificações de instalação e referências de plugins:

```bash
npm run test:installation --prefix app
node app/scripts/generate-plugin-tool-reference.mjs --check
npm test --prefix app
npm run build --prefix app
```

Testes de app e build requerem as dependências instaladas e configuração local válida. Registre bloqueios concretos (dependência, banco ou segredo ausente); não os trate como aprovação. Nunca rode migração destrutiva em banco real.

## 6. Mapa dos artefatos

| Caminho | O que é | Fonte de verdade para |
|---|---|---|
| `README.md` | Introdução, instalação e instruções do fork | Identidade pública do Faturador |
| `app/` | Aplicação Next.js, API, testes e configuração Supabase | Produto executável |
| `app/scripts/generate-plugin-tool-reference.mjs` | Gera documentação derivada dos plugins | Referências geradas em `plugins/` |
| `plugins/` | Conectores e documentação de agentes | Integrações disponíveis no repositório |
| `packages/agent-kit/` | Pacote cliente e contratos MCP | API pública do agent kit |
| `docs/` | Guias operacionais e imagens | Procedimentos e explicações |
| `arquivos/` | Material de apoio externo, fora de escopo sem decisão do Rodrigo | Nada; ver §3 |

## 7. Antes de dizer "pronto"

- [ ] Confirmar branch, diretório de trabalho, origem remota e `git status`.
- [ ] Comparar diff completo e verificar que contratos e comportamento foram preservados.
- [ ] Rodar `git diff --check`, testes aplicáveis e o check do gerador.
- [ ] Confirmar README, logo Faturador, branch `pt-br` e referências claras ao upstream.
- [ ] Verificar que não há segredos, backups ou artefatos indevidos no stage.
- [ ] Confirmar que nada em `arquivos/` foi tocado.
- [ ] Registrar limitações de testes e obter homologação independente antes de publicar.

## 8. Documentos relacionados

| Documento | Para quê |
|---|---|
| `CONTRIBUTING.md` | Contribuição no repositório |
| `SECURITY.md` / `SUPPORT.md` | Política de segurança e suporte |
| `docs/self-hosting.md` | Instalação auto-hospedada |
| `docs/fresh-machine-test.md` | Validação em máquina limpa |
