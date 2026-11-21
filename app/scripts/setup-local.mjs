import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const app = fileURLToPath(new URL('../', import.meta.url))
const target = resolve(app, '.env.local')
if (existsSync(target))
  throw Error(
    'Recusando-se a sobrescrever .env.local. Use a instalação existente ou mova o arquivo manualmente.',
  )
const port = Number(process.env.BILLR_LOCAL_APP_PORT || 3000)
const base = Number(process.env.BILLR_LOCAL_DB_PORT || 56421)
if (![port, base].every((n) => Number.isInteger(n) && n >= 1024 && n < 65000))
  throw Error('As portas locais devem ser números inteiros de 1024 a 64999')
const project = `billr-local-${base}`
const work = resolve(app, '.self-host', project)
mkdirSync(resolve(work, 'supabase'), { recursive: true })
let config = readFileSync(resolve(app, 'supabase/config.toml'), 'utf8')
config = config.replace(
  'project_id = "billr"',
  `project_id = "${project}"`,
)
config = config.replace(/554(\d\d)/g, (_, tail) =>
  String(base + Number(tail) - 21),
)
config = config.replace(
  /(\[analytics\]\s*\n)enabled = true/,
  '$1enabled = false',
)
config = config.replace('sql_paths = ["./seed.sql"]', 'sql_paths = []')
config = config
  .replaceAll('http://127.0.0.1:3000', `http://localhost:${port}`)
  .replaceAll('http://localhost:3000', `http://localhost:${port}`)
writeFileSync(resolve(work, 'supabase/config.toml'), config)
cpSync(
  resolve(app, 'supabase/migrations'),
  resolve(work, 'supabase/migrations'),
  { recursive: true },
)
const cli = process.env.BILLR_SUPABASE_CLI || 'supabase'
console.log(
  'Iniciando um banco de dados isolado de DESENVOLVIMENTO LOCAL. O Docker precisa estar em execução; a primeira inicialização pode levar vários minutos.',
)
try {
  execFileSync(
    cli,
    [
      'start',
      '--workdir',
      work,
      '-x',
      'studio,realtime,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 },
  )
} catch (error) {
  // Nunca exiba a saída da CLI: ela pode conter chaves de API/administrador.
  throw Error(
    `Falha ao iniciar o banco de dados local (código ${error.status}). Verifique o Docker e execute supabase start --workdir ${work} no seu terminal.`,
  )
}
const status = JSON.parse(
  execFileSync(cli, ['status', '--workdir', work, '-o', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }),
)
for (const key of ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY'])
  if (!status[key]) throw Error(`O Supabase local não retornou ${key}`)
const env = {
  NEXT_PUBLIC_APP_URL: `http://localhost:${port}`,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
}
writeFileSync(
  target,
  Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n',
  { mode: 0o600, flag: 'wx' },
)
console.log(
  `Arquivo .env.local privado criado. Inicie o Faturador: npm run dev -- --port ${port} --hostname 127.0.0.1`,
)
console.log(
  `Projeto do banco de dados: ${project}. Para parar sem excluir os dados: supabase stop --workdir .self-host/${project}`,
)
console.log(
  'Apenas para desenvolvimento local: não exponha esta pilha da CLI nem suas credenciais de desenvolvimento à internet. Instruções de produção: ../docs/self-hosting.md',
)
