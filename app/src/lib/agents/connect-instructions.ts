/**
 * Fonte única das etapas de "como conecto isto" para cada cliente. Tanto o
 * painel Agentes → Conectar no app quanto a página pública /docs/connect são
 * renderizados daqui, para que nunca divirjam, assim como a lista de ferramentas
 * MCP fica em src/lib/mcp/tool-catalog.ts.
 *
 * As etapas de cada cliente foram conferidas na documentação do próprio
 * fornecedor em 2026-09-21. A página consultada está registrada em `source`
 * para cada cliente. Se alterar um caminho de menu ou comando aqui, consulte
 * novamente a página do fornecedor e atualize `source` e `verifiedOn`. Nunca
 * escreva uma etapa de memória.
 */

import { mcpUrl } from '@/lib/deployment'

/** Um comando ou bloco de configuração copiável associado a uma etapa. */
export interface ConnectCode {
  /** Exibido acima do bloco, por exemplo, "TERMINAL" ou ".cursor/mcp.json". */
  label: string
  text: string
}

export interface ConnectStep {
  title: string
  /** Uma ou duas frases de contexto. Opcional quando o título já explica tudo. */
  detail?: string
  code?: ConnectCode
}

/** O fluxo manual `billr_sk_`, exibido em uma seção expansível abaixo das etapas. */
interface ConnectFallback {
  summary: string
  detail: string
  steps: ConnectStep[]
}

export interface ConnectClient {
  id: string
  /** Rótulo da aba. */
  name: string
  /** Nome-base do ícone em /public/agents. */
  mark: string
  /** Título mais longo dentro da aba. */
  title: string
  /** A linha "O que você precisa". */
  requirements: string
  steps: ConnectStep[]
  /** A primeira coisa a pedir ao agente depois de conectado. */
  verify: string
  fallback?: ConnectFallback
  /** Página da documentação do fornecedor consultada para estas etapas, se houver. */
  source?: string
  verifiedOn: string
}

/** O que a tela de consentimento do Faturador solicita, usado nas duas interfaces. */
export const CONSENT_SUMMARY =
  'Ao entrar, uma tela de consentimento pergunta em qual empresa o agente pode trabalhar e quais permissões terá. Leitura e gravação vêm ativadas por padrão; envio, pagamentos e exclusão são opcionais. Todas as conexões aparecem em Agentes → Chaves de API e podem ser revogadas a qualquer momento.'

/** Solicitação somente de leitura para comprovar a conexão sem gravar nada. */
export const FIRST_PROMPT =
  'Liste meus clientes no Faturador e diga o que ainda não foi faturado.'

const VERIFIED_ON = '2026-09-21'

export function connectClients(url: string = mcpUrl()): ConnectClient[] {
  return [
    {
      id: 'claude',
      name: 'Claude',
      mark: 'claude',
      title: 'Adicione o Faturador como conector personalizado',
      requirements:
        'Uma conta do Claude em qualquer plano. Contas gratuitas podem adicionar um conector personalizado. Nos planos Team e Enterprise, somente um Owner pode adicionar o conector; depois, cada membro faz a própria conexão.',
      steps: [
        {
          title: 'Abra a lista de conectores',
          detail:
            'No claude.ai ou no Claude Desktop, acesse Personalizar (Customize) e depois Conectores (Connectors). Owners dos planos Team e Enterprise adicionam o conector em Organization settings e depois Conectores (Connectors).',
        },
        {
          title: 'Adicione um conector personalizado',
          detail:
            'Clique no botão de mais e depois em "Add custom connector". Owners dos planos Team e Enterprise clicam em "Add", passam o cursor sobre "Custom" e selecionam "Web".',
        },
        {
          title: 'Cole a URL MCP do Faturador',
          detail:
            'A URL é o único campo necessário. Deixe Configurações avançadas (Advanced settings) em branco: o Faturador registra o Claude como cliente automaticamente, então não há client ID nem segredo para colar.',
          code: { label: 'URL DO SERVIDOR MCP', text: url },
        },
        {
          title: 'Clique em Add e depois em Connect',
          detail:
            'O Claude direciona você ao Faturador para entrar e aprovar a conexão. Escolha a empresa e as permissões e confirme.',
        },
        {
          title: 'Ative o Faturador em uma conversa',
          detail:
            'Use o botão de mais na parte inferior da conversa, escolha Conectores (Connectors) e ative o Faturador para essa conversa.',
        },
      ],
      verify: `Peça ao Claude: "${FIRST_PROMPT}" A consulta é somente de leitura, então nada será criado nem enviado.`,
      source:
        'https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp',
      verifiedOn: VERIFIED_ON,
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      mark: 'claude',
      title: 'Adicione o Faturador pelo terminal',
      requirements:
        'Claude Code instalado e um terminal aberto em qualquer diretório de projeto.',
      steps: [
        {
          title: 'Adicione o servidor',
          detail:
            'Execute uma vez. Adicione --scope user para disponibilizar o Faturador em todos os projetos, em vez de somente neste.',
          code: {
            label: 'TERMINAL',
            text: `claude mcp add --transport http faturador ${url}`,
          },
        },
        {
          title: 'Inicie o Claude Code e execute /mcp',
          detail:
            'Escolha faturador na lista e selecione a opção de autenticação. O Claude Code abre o Faturador no navegador.',
          code: { label: 'NO CLAUDE CODE', text: '/mcp' },
        },
        {
          title: 'Aprove no navegador',
          detail:
            'Entre no Faturador, escolha a empresa e as permissões e confirme. Depois, volte ao terminal.',
        },
        {
          title: 'Confira se está conectado',
          detail: 'faturador deve aparecer como conectado.',
          code: { label: 'TERMINAL', text: 'claude mcp list' },
        },
      ],
      verify: `Peça ao Claude Code: "${FIRST_PROMPT}" A consulta é somente de leitura, então nada será criado nem enviado.`,
      fallback: {
        summary: 'Use uma chave de API',
        detail:
          'Crie uma chave em Agentes → Chaves de API e passe-a como bearer token ao adicionar o servidor. Substitua YOUR_KEY pela chave copiada.',
        steps: [
          {
            title: 'Adicione o servidor com uma chave',
            code: {
              label: 'TERMINAL',
              text: `claude mcp add --transport http faturador ${url} --header "Authorization: Bearer YOUR_KEY"`,
            },
          },
        ],
      },
      source: 'https://code.claude.com/docs/en/mcp',
      verifiedOn: VERIFIED_ON,
    },
    {
      id: 'codex',
      name: 'Codex',
      mark: 'codex',
      title: 'Adicione o Faturador à CLI do Codex',
      requirements: 'CLI do Codex instalada e sessão iniciada.',
      steps: [
        {
          title: 'Adicione o servidor',
          code: {
            label: 'TERMINAL',
            text: `codex mcp add faturador --url ${url}`,
          },
        },
        {
          title: 'Entre na sua conta',
          detail:
            'O Codex abre o Faturador no navegador. Escolha a empresa e as permissões e confirme.',
          code: { label: 'TERMINAL', text: 'codex mcp login faturador' },
        },
        {
          title: 'Confira se está conectado',
          detail:
            'faturador deve aparecer na lista. Na TUI do Codex, /mcp mostra a mesma informação.',
          code: { label: 'TERMINAL', text: 'codex mcp list' },
        },
      ],
      verify: `Peça ao Codex: "${FIRST_PROMPT}" A consulta é somente de leitura, então nada será criado nem enviado.`,
      fallback: {
        summary: 'Use uma chave de API',
        detail:
          'Crie uma chave em Agentes → Chaves de API e exporte-a como BILLR_API_KEY no shell que inicia o Codex. Depois, adicione esta tabela a ~/.codex/config.toml ou a .codex/config.toml para um único projeto.',
        steps: [
          {
            title: 'Configure um bearer token',
            code: {
              label: '~/.codex/config.toml',
              text: `[mcp_servers.faturador]\nurl = "${url}"\nbearer_token_env_var = "BILLR_API_KEY"`,
            },
          },
        ],
      },
      source: 'https://learn.chatgpt.com/docs/extend/mcp?surface=cli',
      verifiedOn: VERIFIED_ON,
    },
    {
      id: 'cursor',
      name: 'Cursor',
      mark: 'cursor',
      title: 'Adicione o Faturador à configuração do Cursor',
      requirements:
        'Cursor e uma pasta de projeto, caso queira usar o Faturador somente naquele projeto.',
      steps: [
        {
          title: 'Crie o arquivo de configuração',
          detail:
            'Use .cursor/mcp.json na raiz do projeto para configurá-lo individualmente ou ~/.cursor/mcp.json para todos os projetos.',
        },
        {
          title: 'Cole a entrada do servidor',
          detail:
            'O Cursor precisa apenas de uma entrada url. Ele se registra automaticamente no Faturador, portanto não é necessário preencher client ID.',
          code: {
            label: '.cursor/mcp.json',
            text: `{\n  "mcpServers": {\n    "faturador": {\n      "url": "${url}"\n    }\n  }\n}`,
          },
        },
        {
          title: 'Salve o arquivo e entre na sua conta',
          detail:
            'O Faturador aparece na lista MCP da página Personalizar (Customize). O Cursor oferece suporte a OAuth para servidores que exigem autenticação e, por isso, abre o Faturador no navegador. Escolha a empresa e as permissões e confirme.',
        },
      ],
      verify: `Peça ao Cursor: "${FIRST_PROMPT}" A consulta é somente de leitura, então nada será criado nem enviado.`,
      fallback: {
        summary: 'Use uma chave de API',
        detail:
          'Crie uma chave em Agentes → Chaves de API e defina BILLR_API_KEY no ambiente em que o Cursor é iniciado; depois, envie-a em um cabeçalho. O Cursor interpreta ${env:NAME} nos valores dos cabeçalhos, então a chave nunca fica armazenada no arquivo.',
        steps: [
          {
            title: 'Envie a chave em um cabeçalho',
            code: {
              label: '.cursor/mcp.json',
              text: `{\n  "mcpServers": {\n    "faturador": {\n      "url": "${url}",\n      "headers": {\n        "Authorization": "Bearer \${env:BILLR_API_KEY}"\n      }\n    }\n  }\n}`,
            },
          },
        ],
      },
      source: 'https://cursor.com/docs/context/mcp',
      verifiedOn: VERIFIED_ON,
    },
    {
      id: 'chatgpt',
      name: 'ChatGPT',
      mark: 'chatgpt',
      title: 'Conecte o Faturador no modo de desenvolvedor',
      requirements:
        'Uma conta do ChatGPT com developer mode disponível. A OpenAI documenta as etapas abaixo, mas não informa quais planos incluem esse modo; confira primeiro em Settings.',
      steps: [
        {
          title: 'Ative o developer mode',
          detail:
            'No ChatGPT, abra Settings, depois "Security and login" e ative Developer mode.',
        },
        {
          title: 'Abra a lista de plugins',
          detail: 'Acesse ChatGPT Plugins e selecione o botão de mais.',
        },
        {
          title: 'Conecte a URL MCP do Faturador',
          detail: 'Cole a URL e conecte o servidor no developer mode.',
          code: { label: 'URL DO SERVIDOR MCP', text: url },
        },
        {
          title: 'Entre no Faturador',
          detail:
            'O ChatGPT inicia um fluxo OAuth com o Faturador. Escolha a empresa e as permissões e confirme. Não há opção de chave de API aqui: OAuth é a única forma de conexão.',
        },
      ],
      verify: `Peça ao ChatGPT: "${FIRST_PROMPT}" A consulta é somente de leitura, então nada será criado nem enviado.`,
      source: 'https://developers.openai.com/api/docs/mcp',
      verifiedOn: VERIFIED_ON,
    },
    {
      id: 'other',
      name: 'Outro / chave de API',
      mark: 'mcp',
      title: 'Conecte outro cliente MCP',
      requirements:
        'Qualquer cliente que consiga se comunicar com um servidor MCP remoto por HTTP streamable.',
      steps: [
        {
          title: 'Adicione um servidor MCP HTTP remoto usando esta URL',
          detail:
            'Se o cliente oferecer suporte à autorização MCP, isso é tudo de que ele precisa. Ele encontra a página de acesso do Faturador pela URL e solicita que você aprove uma empresa e um conjunto de permissões.',
          code: { label: 'URL DO SERVIDOR MCP', text: url },
        },
        {
          title: 'Entre quando o cliente abrir o Faturador',
          detail:
            'Escolha a empresa e as permissões e confirme. A conexão aparecerá em Agentes → Chaves de API.',
        },
        {
          title: 'Se o cliente não conseguir autenticar, use uma chave',
          detail:
            'Clientes sem suporte a OAuth ainda podem se conectar com um bearer token. Abra o painel abaixo.',
        },
      ],
      verify: `Peça ao seu agente: "${FIRST_PROMPT}" A consulta é somente de leitura, então nada será criado nem enviado.`,
      fallback: {
        summary: 'Use uma chave de API',
        detail:
          'Crie uma chave em Agentes → Chaves de API, copie-a uma única vez e forneça ao cliente a URL e um cabeçalho Authorization. Uma chave incorreta ou revogada retorna 401 em vez de uma lista vazia, para que uma chave inválida nunca pareça uma conta sem dados.',
        steps: [
          {
            title: 'URL e cabeçalho',
            code: {
              label: 'CONFIGURAÇÃO MCP',
              text: `URL: ${url}\nAuthorization: Bearer YOUR_KEY`,
            },
          },
        ],
      },
      verifiedOn: VERIFIED_ON,
    },
  ]
}
