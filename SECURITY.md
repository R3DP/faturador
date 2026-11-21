# Política de segurança

## Versões com suporte

| Versão | Com suporte |
| --- | --- |
| Último commit em `pt-br` | Sim. As correções são feitas aqui. |
| Commits anteriores e forks | Não. Atualize para o último commit da branch `pt-br`. |

Atualizar significa obter o código-fonte mais recente e aplicar as migrações que ainda não estão instaladas. Consulte [docs/self-hosting.md](docs/self-hosting.md).

## Como relatar uma vulnerabilidade

Faça o relato em particular pelo GitHub: abra a aba **Segurança** deste repositório e escolha **Relatar uma vulnerabilidade**. Não abra uma issue pública, um pull request nem uma discussão sobre um problema de segurança.

Inclua:

- o commit que você está executando,
- uma reprodução mínima usando **somente dados fictícios**,
- o impacto que você acredita que o problema possa causar.

Não publique credenciais, faturas, dados de clientes ou instruções de exploração em público.

## O que esperar

- **Confirmação de recebimento em até 3 dias úteis.**
- **Uma avaliação inicial em até 10 dias úteis**, informando se o relato foi aceito, a gravidade e os próximos passos.
- **Atualizações pelo menos a cada 14 dias** enquanto o relato estiver em aberto.
- Crédito em [CHANGELOG.md](CHANGELOG.md) quando a correção for publicada, a menos que você peça para permanecer anônimo.

O Faturador é mantido por uma equipe muito pequena. Esses são compromissos de resposta, não de prazo para desenvolver uma correção.

## Abrangência

**Dentro do escopo**

- O código-fonte do aplicativo neste repositório, incluindo o servidor MCP, os endpoints OAuth, o modelo de chaves de API e as migrações do banco de dados.
- Problemas de isolamento entre empresas: ler, gravar ou inferir dados de outra empresa.
- Contornos de autenticação e autorização, incluindo uma chave de API que atue além de suas permissões ou de seu escopo empresarial, e a possibilidade de contornar o cadastro fechado.
- Vazamentos pelas páginas públicas de faturas e orçamentos, acessíveis a qualquer pessoa que tenha o link.
- O kit de ferramentas para agentes em `packages/agent-kit` e os pacotes de plugins em `plugins`.

**Fora do escopo**

- Uma instalação operada por outra pessoa. Relate o problema a essa pessoa operadora.
- Configuração incorreta da sua própria instalação: portas do banco de dados expostas, chave service-role em um pacote do navegador, pilha Supabase de desenvolvimento na internet pública ou ausência de TLS.
- A chave anon ou publishable do navegador estar visível. Ela é pública por definição; a segurança em nível de linha e as verificações no servidor impõem o controle de acesso.
- Negação de serviço por volume, engenharia social, acesso físico e problemas em serviços de terceiros (Supabase, Stripe, Resend ou provedor de hospedagem) que não tenham sido causados pelo código do Faturador.
- Resultados de scanners sem impacto demonstrado.

## Sua instalação

Você controla as chaves da sua instalação, aplica as atualizações e é responsável pelos dados. Mantenha em sigilo as chaves service-role do Supabase, os segredos Stripe, as credenciais de e-mail e os backups. Execute o último commit da branch `pt-br` com todas as migrações aplicadas, disponibilize o serviço por HTTPS, restrinja as portas do banco de dados e de administração e teste seus backups. O Faturador não envia dados da sua instalação a terceiros.

## Sem recompensa

Não há programa de recompensa por bugs nem pagamento por relatos. Oferecemos uma resposta concreta, uma correção e crédito público, se você quiser.
