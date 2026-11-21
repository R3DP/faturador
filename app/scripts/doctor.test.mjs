import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import {
  MIN_SUPABASE_CLI,
  checkDocker,
  checkEnvFile,
  checkNode,
  checkPorts,
  checkSupabaseCli,
  compareVersions,
  portFree,
  report,
} from './doctor.mjs'

test('compara versões numericamente', () => {
  assert.equal(compareVersions('2.67.1', '2.67.1'), 0)
  assert.equal(compareVersions('2.120.0', '2.67.1'), 1)
  assert.equal(compareVersions('1.226.4', '2.67.1'), -1)
})

test('Node 22 passa e Node 20 falha', () => {
  assert.equal(checkNode('22.23.1').status, 'pass')
  const old = checkNode('20.19.0')
  assert.equal(old.status, 'fail')
  assert.match(old.detail, /22/)
})

test('Docker em execução com memória suficiente passa', () =>
  assert.equal(checkDocker(() => '29.2.1 12528578560\n').status, 'pass'))

test('Docker em execução com menos de 4 GB gera um aviso', () =>
  assert.equal(checkDocker(() => '29.2.1 2147483648\n').status, 'warn'))

test('Docker que não está em execução falha', () =>
  assert.equal(
    checkDocker(() => {
      throw new Error('Cannot connect to the Docker daemon')
    }).status,
    'fail',
  ))

test('a versão mínima da CLI do Supabase passa', () =>
  assert.equal(checkSupabaseCli(() => `${MIN_SUPABASE_CLI}\n`).status, 'pass'))

test('uma versão mais antiga da CLI do Supabase falha e informa o mínimo', () => {
  const result = checkSupabaseCli(() => '1.226.4\n')
  assert.equal(result.status, 'fail')
  assert.match(result.detail, /2\.67\.1/)
})

test('a CLI do Supabase ausente falha e exibe o link de instalação', () => {
  const result = checkSupabaseCli(() => {
    throw new Error('ENOENT')
  })
  assert.equal(result.status, 'fail')
  assert.match(result.detail, /supabase\.com/)
})

test('portas livres passam', async () =>
  assert.equal(
    (await checkPorts({ appPort: 3000, dbBase: 56421, isFree: async () => true, envExists: false })).status,
    'pass',
  ))

test('uma porta ocupada falha antes da configuração e indica a variável de substituição', async () => {
  const result = await checkPorts({
    appPort: 3000,
    dbBase: 56421,
    isFree: async (port) => port !== 56421,
    envExists: false,
  })
  assert.equal(result.status, 'fail')
  assert.match(result.detail, /56421/)
  assert.match(result.detail, /BILLR_LOCAL_DB_PORT/)
})

test('uma porta do app ocupada falha e indica a variável de substituição do app, não a do banco de dados', async () => {
  const result = await checkPorts({
    appPort: 3000,
    dbBase: 56421,
    isFree: async (port) => port !== 3000,
    envExists: false,
  })
  assert.equal(result.status, 'fail')
  assert.match(result.detail, /BILLR_LOCAL_APP_PORT para o app \(3000 está ocupado\)/)
  assert.match(result.detail, /BILLR_LOCAL_APP_PORT=3010 npm run doctor, e use o mesmo prefixo em npm run setup:local/)
  assert.doesNotMatch(result.detail, /BILLR_LOCAL_DB_PORT/)
})

test('verifica a porta do app e as dez portas locais do banco de dados', async () => {
  const asked = []
  await checkPorts({
    appPort: 3000,
    dbBase: 56421,
    isFree: async (port) => {
      asked.push(port)
      return true
    },
    envExists: false,
  })
  assert.deepEqual(asked, [3000, 56420, 56421, 56422, 56423, 56424, 56425, 56426, 56427, 56428, 56429])
})

test('portas ocupadas só geram aviso depois que a configuração foi executada', async () =>
  assert.equal(
    (await checkPorts({ appPort: 3000, dbBase: 56421, isFree: async () => false, envExists: true })).status,
    'warn',
  ))

test('detecta uma porta ocupada em todas as interfaces, como o Docker as publica', async () => {
  const server = createServer()
  await new Promise((done) => server.listen(0, '0.0.0.0', done))
  try {
    assert.equal(await portFree(server.address().port), false)
  } finally {
    await new Promise((done) => server.close(done))
  }
})

test('detecta uma porta ocupada apenas no loopback', async () => {
  const server = createServer()
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  try {
    assert.equal(await portFree(server.address().port), false)
  } finally {
    await new Promise((done) => server.close(done))
  }
})

test('um .env.local existente é um aviso, não uma falha', () => {
  assert.equal(checkEnvFile(true).status, 'warn')
  assert.equal(checkEnvFile(false).status, 'pass')
})

test('o relatório falha somente quando uma verificação falha', () => {
  assert.equal(report([{ status: 'pass', name: 'a', detail: '' }, { status: 'fail', name: 'b', detail: 'x' }]).ok, false)
  assert.equal(report([{ status: 'warn', name: 'a', detail: '' }]).ok, true)
  assert.match(report([{ status: 'fail', name: 'Docker', detail: 'não está em execução' }]).text, /^FAIL {2}Docker: não está em execução$/m)
})
