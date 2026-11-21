import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { containerName, projectId, sqlTestFiles } from './test-sql.mjs'

const app = fileURLToPath(new URL('../', import.meta.url))
const tests = fileURLToPath(new URL('../supabase/tests/', import.meta.url))

test('lê o ID do projeto em config.toml', () =>
  assert.equal(projectId('project_id = "billr-development"\n[api]\n'), 'billr-development'))

test('recusa uma configuração sem ID de projeto', () =>
  assert.throws(() => projectId('[api]\nport = 1\n'), /project_id/))

test('deriva o contêiner do banco de dados da configuração versionada', () =>
  assert.equal(containerName(app), 'supabase_db_billr'))

test('encontra os testes SQL em ordem alfabética', () => {
  const files = sqlTestFiles(tests)
  assert.ok(files.includes('security.sql'))
  assert.deepEqual(files, [...files].sort())
})

test('nenhum teste SQL inclui outro arquivo, pois os testes são encaminhados pela entrada padrão', () => {
  for (const file of sqlTestFiles(tests))
    assert.doesNotMatch(readFileSync(`${tests}${file}`, 'utf8'), /^\\i/m, file)
})
