# Suporte

## Onde pedir ajuda

| Você quer | Acesse |
| --- | --- |
| Fazer uma pergunta sobre como executar o Faturador | Issues do GitHub neste repositório; comece o título com "Dúvida:" |
| Relatar um bug reproduzível | Issues do GitHub, usando o formulário de relato de bug |
| Sugerir um recurso | Issues do GitHub, usando o formulário de solicitação de recurso |
| Relatar uma vulnerabilidade | Em particular, pela aba **Segurança (Security)**. Consulte [SECURITY.md](SECURITY.md) |

## Antes de perguntar

A maioria das dúvidas de configuração é respondida por [README.md](README.md), [docs/self-hosting.md](docs/self-hosting.md) e [docs/fresh-machine-test.md](docs/fresh-machine-test.md). Se a resposta não estiver lá, diga isso: uma pergunta que a documentação deveria responder indica um problema na documentação.

Ao pedir ajuda, inclua:

- como você executa o Faturador (desenvolvimento local, Docker e qual host),
- o commit em que você está,
- a versão do Node.js e o sistema operacional,
- o comando exato executado e sua saída, sem segredos,
- o que você esperava e o que aconteceu.

Nunca cole uma chave service-role, um segredo Stripe, uma chave de API, uma URL de banco de dados com senha nem um registro real de fatura ou cliente. Reproduza o problema com dados fictícios.

## Com o que as pessoas mantenedoras ajudam

- Bugs neste código-fonte, incluindo o servidor MCP, as migrações, o kit de ferramentas de agentes e os plugins.
- Documentação incorreta, ausente ou enganosa.
- Dúvidas sobre o comportamento esperado de um recurso ou contrato de ferramenta.

## O que cabe a você operar

As pessoas mantenedoras não operam sua instalação e não podem acessá-la:

- **Infraestrutura:** Supabase ou Postgres, contêineres, proxies reversos, TLS, DNS, armazenamento e custos.
- **Contas de terceiros:** sua conta Stripe, sua conta Resend e o domínio de envio, além dos aplicativos do seu provedor OAuth.
- **Seus dados:** backups, restaurações, retenção e recuperação após uma exclusão. Não há importador de faturas históricas.
- **Suas modificações:** um fork, uma política alterada ou uma chamada service-role adicionada têm suporte de quem as criou.
- **Conformidade:** tratamento fiscal, legalidade das faturas na sua jurisdição e residência dos dados.

O suporte é oferecido conforme a disponibilidade de uma equipe muito pequena, sem acordo de nível de serviço.
