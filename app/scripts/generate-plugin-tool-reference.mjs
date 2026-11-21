#!/usr/bin/env node
/**
 * Gera todos os arquivos derivados em `plugins/`.
 *
 * Dois itens são gerados aqui e nunca devem ser editados manualmente:
 *
 * 1. `plugins/shared/skill/references/tools.md`, com base em
 *    `packages/agent-kit/src/tool-contracts.json` (a superfície de ferramentas registrada,
 *    com o título, a descrição e o esquema de entrada reais de cada ferramenta),
 *    `packages/agent-kit/src/tool-catalog.ts` (o agrupamento voltado às pessoas) e
 *    `app/src/lib/mcp/permissions.ts` (a permissão necessária para cada ferramenta). Uma
 *    lista de ferramentas mantida manualmente ficou desatualizada e anunciou uma ferramenta inexistente;
 *    este repositório não repetirá isso.
 *
 * 2. As cópias da habilidade compartilhada para cada plataforma. `plugins/shared/skill/` é
 *    a fonte única. Claude Code, Codex e OpenClaw precisam do mesmo
 *    texto em seus próprios formatos, e Cursor precisa dele como regras `.mdc` com
 *    frontmatter diferente; por isso, as cópias são feitas aqui, não manualmente.
 *
 * Uso:
 *   node app/scripts/generate-plugin-tool-reference.mjs           # gravar
 *   node app/scripts/generate-plugin-tool-reference.mjs --check   # apenas verificar
 *
 * `--check` não grava nada e termina com código diferente de zero quando algum arquivo
 * no disco difere do que seria gerado. É isso que o teste executa.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const GENERATOR = 'app/scripts/generate-plugin-tool-reference.mjs'
const SHARED = 'plugins/shared/skill'

const read = (p) => readFileSync(resolve(root, p), 'utf8')

/** Todas as strings entre aspas simples em um trecho dos arquivos TypeScript. */
function quoted(fragment) {
  return [...fragment.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) =>
    m[1].replace(/\\'/g, "'"),
  )
}

/**
 * O agrupamento voltado às pessoas, extraído da cópia do catálogo de ferramentas
 * do agent-kit. Analisar o texto em vez de importá-lo dispensa um carregador
 * TypeScript e qualquer dependência de versões do Node que removam ou não os tipos.
 * Cada resultado da análise é comparado aos contratos abaixo; assim, se o formato
 * deixar de ser reconhecido, haverá uma falha explícita em vez de deixar um arquivo vazio sem aviso.
 */
function toolGroups() {
  const src = read('packages/agent-kit/src/tool-catalog.ts')
  const groups = [
    ...src.matchAll(
      /\{\s*name:\s*'((?:[^'\\]|\\.)*)',\s*blurb:\s*'((?:[^'\\]|\\.)*)',\s*tools:\s*\[([\s\S]*?)\]/g,
    ),
  ].map((m) => ({
    name: m[1].replace(/\\'/g, "'"),
    blurb: m[2].replace(/\\'/g, "'"),
    tools: quoted(m[3]),
  }))
  if (!groups.length) throw Error('Nenhum grupo de ferramentas foi encontrado no catálogo')
  return groups
}

/** Permissão necessária para cada ferramenta, extraída da verificação de permissões do MCP. */
function toolPermissions() {
  const src = read('app/src/lib/mcp/permissions.ts')
  const permissions = new Map()
  for (const [, name, body] of src.matchAll(
    /const (reads|writes) = new Set\(\[([\s\S]*?)\]\)/g,
  ))
    for (const tool of quoted(body))
      permissions.set(tool, name === 'reads' ? 'read' : 'write')
  // O trecho final de toolPermission() trata send, delete e payments com
  // comparações explícitas, em vez de conjuntos.
  for (const [, condition, permission] of src.matchAll(
    /if \(([^)]*name ===[^)]*)\) return '(\w+)'/g,
  ))
    for (const tool of quoted(condition)) permissions.set(tool, permission)
  if (!permissions.size)
    throw Error('Nenhuma permissão de ferramenta foi encontrada na verificação de permissões')
  return permissions
}

function contracts() {
  const parsed = JSON.parse(read('packages/agent-kit/src/tool-contracts.json'))
  if (!Array.isArray(parsed) || !parsed.length)
    throw Error('Os contratos de ferramentas estão vazios')
  return parsed
}

const PERMISSION_NOTE = {
  read: 'read',
  write: 'write',
  send: 'send (apresenta um documento ao cliente)',
  payments: 'payments (registra movimentações financeiras)',
  delete: 'delete (remove um registro)',
}

function toolsMarkdown() {
  const groups = toolGroups()
  const permissions = toolPermissions()
  const byName = new Map(contracts().map((tool) => [tool.name, tool]))

  const grouped = groups.flatMap((g) => g.tools)
  const duplicates = grouped.filter((n, i) => grouped.indexOf(n) !== i)
  if (duplicates.length)
    throw Error(`Ferramenta listada em mais de um grupo: ${duplicates.join(', ')}`)
  const missing = grouped.filter((n) => !byName.has(n))
  if (missing.length)
    throw Error(`O catálogo anuncia ferramentas sem contrato: ${missing.join(', ')}`)
  const unlisted = [...byName.keys()].filter((n) => !grouped.includes(n))
  if (unlisted.length)
    throw Error(`Ferramentas com contrato, mas sem grupo no catálogo: ${unlisted.join(', ')}`)
  const unpermissioned = grouped.filter((n) => !permissions.has(n))
  if (unpermissioned.length)
    throw Error(`Ferramentas sem mapeamento de permissão: ${unpermissioned.join(', ')}`)

  const lines = [
    '# Ferramentas MCP do Faturador',
    '',
    `<!-- Gerado por ${GENERATOR}. Não edite. -->`,
    '',
    `Todas as ferramentas registradas pelo servidor MCP do Faturador: ${grouped.length}, nos`,
    'grupos usados pelo próprio app. Títulos, descrições e entradas vêm diretamente',
    'dos contratos das ferramentas registradas, então nada aqui pode anunciar uma ferramenta',
    'que não exista.',
    '',
    'A coluna **Permissão necessária** indica a permissão que a conexão precisa ter',
    'recebido. Se você não consegue ver uma ferramenta, ela não foi concedida; informe isso em vez de',
    'tentar contornar a restrição.',
    '',
    '`request_id` aparece nas ferramentas de escrita para garantir idempotência: gere um UUID novo',
    'para cada operação pretendida e reutilize o mesmo, com entrada idêntica, ao',
    'repetir uma chamada que talvez tenha sido parcialmente concluída.',
    '',
    '## Conteúdo',
    '',
  ]
  for (const group of groups)
    lines.push(
      `- [${group.name}](#${group.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}) (${group.tools.length})`,
    )

  for (const group of groups) {
    lines.push('', `## ${group.name}`, '', group.blurb, '')
    lines.push('| Ferramenta | Permissão necessária | Entrada obrigatória |', '| --- | --- | --- |')
    for (const name of group.tools) {
      const required = byName.get(name).inputSchema?.required ?? []
      lines.push(
        `| \`${name}\` | ${permissions.get(name)} | ${
          required.length ? required.map((r) => `\`${r}\``).join(', ') : 'nenhum'
        } |`,
      )
    }
    for (const name of group.tools) {
      const tool = byName.get(name)
      const schema = tool.inputSchema ?? {}
      const required = schema.required ?? []
      const optional = Object.keys(schema.properties ?? {}).filter(
        (p) => !required.includes(p),
      )
      lines.push(
        '',
        `### \`${name}\``,
        '',
        `*${tool.title ?? name}*, exige **${PERMISSION_NOTE[permissions.get(name)]}**.`,
        '',
        (tool.description ?? '').trim(),
        '',
        `- Obrigatórios: ${required.length ? required.map((r) => `\`${r}\``).join(', ') : 'nenhum'}`,
        `- Opcionais: ${optional.length ? optional.map((o) => `\`${o}\``).join(', ') : 'nenhum'}`,
      )
    }
  }
  lines.push('')
  const markdown = lines.join('\n')
  // Regra da casa: nada de travessões longos no que o Faturador distribui. Se uma descrição
  // de ferramenta ganhar um deles na origem, isso será detectado aqui, não no pacote publicado.
  if (markdown.includes('\u2014'))
    throw Error('A referência de ferramentas gerada contém um travessão longo')
  return markdown
}

/** Separa o frontmatter YAML e o corpo de um arquivo Markdown. */
function split(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) throw Error('Era esperado um frontmatter YAML')
  return { frontmatter: match[1], body: match[2] }
}

function stamped(text, sourcePath) {
  const { frontmatter, body } = split(text)
  return `---\n${frontmatter}\n---\n\n<!-- Gerado por ${GENERATOR} a partir de ${sourcePath}. Não edite; edite a fonte e execute o gerador novamente. -->\n${body.replace(/^\n+/, '\n')}`
}

/** Todos os arquivos controlados por este script, no formato caminho -> conteúdo. */
export function generatedFiles() {
  const files = new Map()
  files.set(`${SHARED}/references/tools.md`, toolsMarkdown())

  const skill = read(`${SHARED}/SKILL.md`)
  const workflows = read(`${SHARED}/references/workflows.md`)
  const tools = files.get(`${SHARED}/references/tools.md`)

  // Codex usa skills/<name>/SKILL.md com as referências
  // ao lado. No OpenClaw, a pasta da habilidade fica na raiz.
  for (const dir of [
    'plugins/codex/billr/skills/billr',
    'plugins/openclaw/billr',
  ]) {
    files.set(`${dir}/SKILL.md`, stamped(skill, `${SHARED}/SKILL.md`))
    files.set(
      `${dir}/references/workflows.md`,
      `<!-- Gerado por ${GENERATOR} a partir de ${SHARED}/references/workflows.md. Não edite. -->\n\n${workflows}`,
    )
    files.set(`${dir}/references/tools.md`, tools)
  }

  return files
}

export function checkGenerated() {
  const stale = []
  for (const [path, contents] of generatedFiles()) {
    let current = null
    try {
      current = read(path)
    } catch {
      stale.push(`${path}: ausente`)
      continue
    }
    if (current !== contents) stale.push(`${path}: desatualizado`)
  }
  return stale
}

function main(argv) {
  if (argv.includes('--check')) {
    const stale = checkGenerated()
    if (stale.length) {
      console.error(
        `Os arquivos gerados dos plugins estão desatualizados:\n${stale.map((s) => `  ${s}`).join('\n')}\n\nExecute: node ${GENERATOR}`,
      )
      process.exitCode = 1
      return
    }
    console.log('Os arquivos gerados dos plugins estão atualizados.')
    return
  }
  let written = 0
  for (const [path, contents] of generatedFiles()) {
    const full = resolve(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, contents)
    written++
  }
  console.log(`${written} arquivos gerados dos plugins foram gravados.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2))
