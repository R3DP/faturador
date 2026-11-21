import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// O kit de agentes inclui os próprios cálculos e o catálogo de ferramentas do app. As duas cópias
// só são seguras enquanto forem o mesmo arquivo.
const PAIRS = [
  ['src/lib/work/time.ts', 'time.ts'],
  ['src/lib/stripe/money.ts', 'money.ts'],
  ['src/lib/mcp/tool-catalog.ts', 'tool-catalog.ts'],
]

for (const [app, kit] of PAIRS)
  test(`packages/agent-kit/src/${kit} corresponde a app/${app}`, () =>
    assert.equal(
      readFileSync(new URL(`../../packages/agent-kit/src/${kit}`, import.meta.url), 'utf8'),
      readFileSync(new URL(`../${app}`, import.meta.url), 'utf8'),
      `Atualize as duas cópias: app/${app} e packages/agent-kit/src/${kit}`,
    ))
