## O que esta alteração muda

<!-- O problema e o comportamento resultante. Um assunto por pull request. -->

## Por quê

<!-- O que tornou o comportamento atual incorreto ou insuficiente. Inclua o link da issue, se houver. -->

## Como foi validada

<!-- Cole os comandos executados e os resultados. -->

```
cd app
npm test
npm run test:installation
npm run lint
npm run typecheck
npm run build
```

## Lista de verificação

- [ ] Um único assunto, e o diff é tão pequeno quanto esse assunto permite.
- [ ] Testes adicionados ou atualizados, incluindo um teste que teria detectado o bug.
- [ ] Os testes unitários, as verificações de instalação, o lint, a verificação de tipos e uma compilação de produção passaram.
- [ ] Não há travessões longos em conteúdo que uma pessoa usuária possa ler, nem métricas ou afirmações inventadas.
- [ ] Dados de teste e conteúdo de exemplo usam o elenco fictício em domínios `.example`. Nenhuma pessoa, empresa, cliente, domínio ou endereço de e-mail real, inclusive os meus.
- [ ] Nenhum segredo, arquivo de ambiente, despejo do banco de dados, fatura real, log ou artefato de compilação foi incluído no commit.

### Se esta alteração tocar o banco de dados

- [ ] Uma nova migração com o próximo número; nenhuma migração aplicada foi modificada ou renumerada.
- [ ] Verificada com `supabase db reset` e `supabase migration up`, e `npm run test:sql` passou.
- [ ] Toda função `SECURITY DEFINER` termina com `SET search_path = public, pg_temp`.
- [ ] Concessões revogadas de `anon` e `authenticated` e concedidas novamente de forma explícita, com verificação na mesma migração.
- [ ] Os dados públicos continuam sendo montados a partir de uma lista permitida de colunas.
- [ ] `app/src/types/database.ts` foi gerado novamente, não editado manualmente.

### Se esta alteração tocar ferramentas MCP

- [ ] Os dados são acessados por meio dos auxiliares de banco com escopo limitado, nunca por uma consulta sem escopo com service-role.
- [ ] Registros inexistentes e fora do escopo retornam o mesmo erro genérico.
- [ ] A ferramenta está categorizada em exatamente uma permissão.
- [ ] O teste do catálogo de ferramentas passou e os contratos do kit de ferramentas de agentes estão sincronizados.
- [ ] Gravações com novas tentativas possíveis recebem um identificador de solicitação estável e são idempotentes.
- [ ] Qualquer alteração incompatível no nome de uma ferramenta, no esquema de entrada ou no significado de um campo está indicada acima.
