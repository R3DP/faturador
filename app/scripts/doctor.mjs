// Verifica a máquina antes de instalar o Faturador. Usa apenas recursos internos do Node, então
// roda antes de `npm ci`. Exibe PASS, WARN ou FAIL para cada verificação; termina com código 1 em FAIL.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { connect, createServer } from 'node:net'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const MIN_NODE_MAJOR = 22
/** Versão da CLI do Supabase usada pelo CI para testar as migrações. */
export const MIN_SUPABASE_CLI = '2.67.1'
/** Memória necessária para o Docker compilar a imagem de produção (consulte docs/self-hosting.md). */
export const BUILD_MEMORY_BYTES = 4 * 1024 ** 3

export function compareVersions(a, b) {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const difference = (left[i] || 0) - (right[i] || 0)
    if (difference) return Math.sign(difference)
  }
  return 0
}

export function checkNode(version = process.versions.node) {
  const major = Number(version.split('.')[0])
  return major >= MIN_NODE_MAJOR
    ? { status: 'pass', name: 'Node.js', detail: `v${version}` }
    : {
        status: 'fail',
        name: 'Node.js',
        detail: `v${version} encontrada; instale o Node.js ${MIN_NODE_MAJOR} ou mais recente (a versão está indicada no .nvmrc do repositório)`,
      }
}

export function checkDocker(run) {
  let output
  try {
    output = run('docker', ['info', '--format', '{{.ServerVersion}} {{.MemTotal}}']).trim()
  } catch {
    return {
      status: 'fail',
      name: 'Docker',
      detail: 'não está em execução ou não está instalado; inicie o Docker Desktop (ou o daemon do Docker) e execute novamente',
    }
  }
  const [version, memory] = output.split(' ')
  const bytes = Number(memory)
  if (Number.isFinite(bytes) && bytes > 0 && bytes < BUILD_MEMORY_BYTES)
    return {
      status: 'warn',
      name: 'Docker',
      detail: `em execução (${version}) com ${(bytes / 1024 ** 3).toFixed(1)} GB; o desenvolvimento local funciona, mas aloque ao Docker pelo menos 4 GB antes de compilar a imagem de produção`,
    }
  return { status: 'pass', name: 'Docker', detail: `em execução (${version})` }
}

export function checkSupabaseCli(run, cli = 'supabase') {
  let output
  try {
    output = run(cli, ['--version'])
  } catch {
    return {
      status: 'fail',
      name: 'Supabase CLI',
      detail: 'não encontrada; instale-a: https://supabase.com/docs/guides/local-development/cli/getting-started',
    }
  }
  const version = output.match(/\d+\.\d+\.\d+/)?.[0]
  if (!version)
    return { status: 'warn', name: 'Supabase CLI', detail: `não foi possível ler uma versão de "${output.trim()}"` }
  return compareVersions(version, MIN_SUPABASE_CLI) >= 0
    ? { status: 'pass', name: 'Supabase CLI', detail: `v${version}` }
    : { status: 'fail', name: 'Supabase CLI', detail: `v${version} encontrada; atualize para ${MIN_SUPABASE_CLI} ou mais recente` }
}

function canConnect(port) {
  return new Promise((done) => {
    const socket = connect({ port, host: '127.0.0.1' })
    socket.setTimeout(1000)
    socket.once('connect', () => {
      socket.destroy()
      done(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      done(false)
    })
    socket.once('error', () => done(false))
  })
}

function canListen(port) {
  return new Promise((done) => {
    const server = createServer()
    server.once('error', () => done(false))
    server.listen(port, '127.0.0.1', () => server.close(() => done(true)))
  })
}

/**
 * Uma porta livre não responde a conexões e pode ser associada. A verificação de conexão
 * é importante no macOS, onde associar 127.0.0.1 pode funcionar enquanto o Docker mantém
 * a mesma porta em 0.0.0.0.
 */
export async function portFree(port) {
  if (await canConnect(port)) return false
  return canListen(port)
}

export async function checkPorts({ appPort, dbBase, isFree = portFree, envExists }) {
  const first = dbBase - 1
  const ports = [appPort, ...Array.from({ length: 10 }, (_, i) => first + i)]
  const busy = []
  for (const port of ports) if (!(await isFree(port))) busy.push(port)
  const fixes = []
  if (busy.includes(appPort))
    fixes.push(
      `defina BILLR_LOCAL_APP_PORT para o app (${appPort} está ocupado), por exemplo BILLR_LOCAL_APP_PORT=${appPort + 10} npm run doctor, e use o mesmo prefixo em npm run setup:local`,
    )
  if (busy.some((port) => port !== appPort))
    fixes.push(`defina BILLR_LOCAL_DB_PORT para o banco de dados (ele usa ${first}-${first + 9}; ocupadas: ${busy.filter((port) => port !== appPort).join(', ')})`)
  if (!busy.length)
    return { status: 'pass', name: 'Portas', detail: `${appPort} e ${first}-${first + 9} estão livres` }
  return {
    status: envExists ? 'warn' : 'fail',
    name: 'Portas',
    detail: envExists
      ? `em uso: ${busy.join(', ')}. É esperado se o servidor de desenvolvimento do Faturador ou o banco de dados local já estiver em execução.`
      : `em uso: ${busy.join(', ')}. Pare o processo que as ocupa ou escolha outras portas para setup:local: ${fixes.join('; ')}.`,
  }
}

export function checkEnvFile(envExists) {
  return envExists
    ? {
        status: 'warn',
        name: '.env.local',
        detail: 'já existe, então setup:local se recusará a sobrescrevê-lo. É esperado se você já executou setup:local.',
      }
    : { status: 'pass', name: '.env.local', detail: 'ainda não foi criado; setup:local o criará' }
}

const LABEL = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' }

export function report(results) {
  const ok = !results.some((result) => result.status === 'fail')
  const lines = results.map((result) => `${LABEL[result.status]}  ${result.name}: ${result.detail}`)
  lines.push(ok ? 'Pronto. Em seguida: npm ci e depois npm run setup:local.' : 'Corrija as linhas FAIL acima e execute npm run doctor novamente.')
  return { text: lines.join('\n'), ok }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = fileURLToPath(new URL('../', import.meta.url))
  const run = (command, args) =>
    execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 })
  const envExists = existsSync(resolve(app, '.env.local'))
  const results = [
    checkNode(),
    checkDocker(run),
    checkSupabaseCli(run, process.env.BILLR_SUPABASE_CLI || 'supabase'),
    await checkPorts({
      appPort: Number(process.env.BILLR_LOCAL_APP_PORT || 3000),
      dbBase: Number(process.env.BILLR_LOCAL_DB_PORT || 56421),
      envExists,
    }),
    checkEnvFile(envExists),
  ]
  const { text, ok } = report(results)
  console.log(text)
  process.exitCode = ok ? 0 : 1
}
