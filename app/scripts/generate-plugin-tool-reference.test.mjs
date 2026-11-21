import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  checkGenerated,
  generatedFiles,
} from './generate-plugin-tool-reference.mjs'

/**
 * O objetivo do gerador é impedir que qualquer arquivo distribuído se desvie do código
 * que descreve. Isso só funciona se houver uma falha quando alguém editar manualmente
 * um arquivo gerado, adicionar uma ferramenta MCP ou renomear uma permissão sem
 * executar o gerador novamente. Este teste garante isso.
 */
test('todos os arquivos gerados dos plugins no disco estão atualizados', () => {
  const stale = checkGenerated()
  assert.deepEqual(
    stale,
    [],
    `Execute: node app/scripts/generate-plugin-tool-reference.mjs\n${stale.join('\n')}`,
  )
})

test('a referência de ferramentas cobre toda a superfície registrada', () => {
  const tools = generatedFiles().get(
    'plugins/shared/skill/references/tools.md',
  )
  assert(tools, 'o gerador não produziu uma referência de ferramentas')
  const contracts = JSON.parse(
    readFileSync(
      new URL('../../packages/agent-kit/src/tool-contracts.json', import.meta.url),
      'utf8',
    ),
  )
  assert(contracts.length > 0)
  for (const tool of contracts)
    assert(
      tools.includes(`### \`${tool.name}\``),
      `${tool.name} está registrada, mas falta na referência gerada`,
    )
  assert(
    tools.includes(`${contracts.length}, nos`),
    'a referência informa uma quantidade de ferramentas diferente da dos contratos',
  )
})

test('os arquivos gerados têm o aviso para não editar e não contêm travessão longo', () => {
  for (const [path, contents] of generatedFiles()) {
    assert(
      contents.includes('Não edite'),
      `${path} é gerado, mas não informa isso`,
    )
    assert(!contents.includes('\u2014'), `${path} contém um travessão longo`)
  }
})

test('as cópias das plataformas mantêm o conteúdo da habilidade compartilhada', () => {
  const files = generatedFiles()
  const marker = 'Crie rascunhos, nunca envie.'
  for (const path of [
    'plugins/codex/billr/skills/billr/SKILL.md',
    'plugins/openclaw/billr/SKILL.md',
  ])
    assert(
      files.get(path)?.includes(marker),
      `${path} está fora de sincronia com a habilidade compartilhada`,
    )
})
