import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// O Faturador é um software auto-hospedado. Esta verificação impede que arquivos próprios
// do serviço hospedado e quaisquer rastros privados entrem no repositório.
// Os metadados de plugins distribuídos podem mencionar o serviço público hospedado.
const root = fileURLToPath(new URL('../../', import.meta.url))
const SELF = 'app/scripts/repo-clean.test.mjs'
const isExcludedRepositoryPath = (file) => file === 'arquivos' || file.startsWith('arquivos/')
const BINARY = /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|otf|pdf)$/i
const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', '.self-host', 'dist', 'coverage', '.temp', '.branches'])

function repositoryFiles() {
  try {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', '.', ':(exclude)arquivos/**'], {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((file) => Boolean(file) && !isExcludedRepositoryPath(file))
  } catch {
    // Sem Git (arquivo baixado): percorre a árvore de diretórios.
    const files = []
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (dir === root && name === 'arquivos') continue
        if (SKIP_DIRS.has(name) || /^\.env/.test(name) && name !== '.env.example') continue
        const path = resolve(dir, name)
        if (lstatSync(path).isDirectory()) walk(path)
        else files.push(relative(root, path))
      }
    }
    walk(root)
    return files
  }
}

const files = repositoryFiles()
  .filter((file) => !isExcludedRepositoryPath(file))
  .filter((file) => file !== SELF && existsSync(resolve(root, file)))

const CONTENT_RULES = [
  ['seletor de edição', /isBillrHosted|BILLR_EDITION/],
  ['planos hospedados', /\bplan_status\b|trial_ends_at|start_hosted_trial|billing_events|billing_state|STRIPE_BILLING|\bpaywall\b|free trial|trial notice/i],
  ['billr.cc fora do README', /billr\.cc/, ['README.md']],
  ['análise ou rastreamento de erros hospedados', /@sentry\/|SENTRY_|posthog|googletagmanager|@vercel\/analytics|signup_attribution/i],
  ['caminho pessoal do diretório home', /\/(?:Users|home)\/[^/\s]+\//],
  ['material de planejamento', /agent-work|superpowers|\.agents\/|\borcha\b|\.playwright-mcp/i],
  ['plataforma de pagamentos', /STRIPE_CONNECT|application_fee|PLATFORM_FEE|stripe_account_id|stripe_connected|stripe_payments_enabled|deauthorize|stripe_checkout_session_id/],
  ['central de suporte', /turnstile|support_request|SUPPORT_EMAIL|help@/i],
  ['etapa de aceite dos termos', /accept-terms|acceptedTerms|terms_version|privacy_version/i],
  ['desafio do diretório de plugins', /openai-apps-challenge|OPENAI_APPS_CHALLENGE/],
  ['sandbox de pagamentos', /sandbox_test_payments|billr_sandbox/],
  ['travessão longo', /\u2014/],
  ['segredo do Stripe', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/],
  ['token do GitHub', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['credencial do Faturador', /\bbillr_(?:sk|at)_[0-9a-f]{40,}\b/],
  ['JWT do Supabase', /eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}/],
  ['chave privada', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
]

const PATH_RULES = [
  /(^|\/)\(marketing\)\//,
  /(^|\/)(components|lib)\/(billing|support|analytics|observability|marketing|blog|guides|seo|content)\//,
  /accept-terms|\/legal\/|openai-apps-challenge|sentry/i,
  /(^|\/)(AGENTS|CLAUDE|PUBLICATION|IMPLEMENTATION|HANDOFF|PLAN|NOTES|TODO)\.md$/,
  /(^|\/)(\.agents|docs\/superpowers|docs\/agent-work|distribution)\//,
  /release-manifest\.json$|(^|\/)supabase\/\.temp\//,
]

test('nenhum arquivo contém conteúdo hospedado, privado ou credencial', () => {
  const issues = []
  for (const file of files) {
    if (BINARY.test(file)) continue
    let text = readFileSync(resolve(root, file), 'utf8')
    // O AGENTS do projeto precisa apontar para estas fontes locais; aceite somente os caminhos canônicos declarados.
    if (file === 'AGENTS.md')
      text = text
        .replaceAll('/home/r3po/.openclaw/workspace/docs/protocolo-orquestracao-agentes.md', '/protocol')
        .replaceAll('/home/r3po/.openclaw/workspace/repositorio/', '/backup-dir/')
        .replaceAll('/home/r3po/.openclaw/workspace/AGENTS.md', '/agent-policy')
        .replaceAll('/home/r3po/projetos/DIRETRIZES.md', '/project-policy')
        .replaceAll('/home/r3po/projetos/faturador', '/project-root')
    if (['app/src/lib/deployment.ts', 'app/src/lib/deployment.test.ts'].includes(file))
      text = text.replace(/https:\/\/billr\.cc\/docs(?:\/connect)?(?=[\x22\x27])/g, 'https://docs.example')
    // Permite apenas literais públicos de endpoint/contato nos arquivos de distribuição.
    // Todas as regras sobre credenciais, sessões, planejamento e código hospedado continuam valendo.
    if (file.startsWith('plugins/') || file.startsWith('.claude-plugin/') || file.startsWith('.cursor-plugin/'))
      text = text.replace(/https:\/\/(?:mcp\.)?billr\.cc(?=[/\s\x22\x27`),]|$)/g, 'https://service.example').replaceAll('help@billr.cc', 'support@example.test')
    for (const [label, pattern, exempt] of CONTENT_RULES)
      if (!exempt?.includes(file) && pattern.test(text)) issues.push(`${file}: ${label}`)
  }
  assert.deepEqual(issues, [])
})

test('nenhum arquivo está em um caminho hospedado ou privado', () => {
  assert.deepEqual(files.filter(hasPathViolation), [])
})

function hasPathViolation(file) {
  return file !== 'AGENTS.md' && PATH_RULES.some((rule) => rule.test(file))
}

test('somente o AGENTS.md da raiz é isento da regra de caminho', () => {
  assert.equal(hasPathViolation('AGENTS.md'), false)
  assert.equal(hasPathViolation('docs/AGENTS.md'), true)
  assert.equal(hasPathViolation('subdir/AGENTS.md'), true)
})

test('o README identifica o fork e documenta a conexão com o Faturador', () => {
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8')
  assert.match(readme, /fork do \[Billr\]\(https:\/\/github\.com\/ethanplusai\/billr\)/)
  assert.match(readme, /git clone --branch pt-br https:\/\/github\.com\/R3DP\/faturador\.git/)
  assert.match(readme, /claude mcp add --transport http faturador/)
  assert.match(readme, /codex mcp add faturador/)
  assert.match(readme, /\[plugins\/README\.md\]/)
})

test('o README informa a quantidade de ferramentas geradas', () => {
  const reference = readFileSync(resolve(root, 'plugins/shared/skill/references/tools.md'), 'utf8')
  const count = (reference.match(/^### `/gm) || []).length
  const claimed = readFileSync(resolve(root, 'README.md'), 'utf8').match(/\*\*(\d+) ferramentas\*\*/)
  assert(claimed, 'README.md não informa a quantidade de ferramentas')
  assert.equal(Number(claimed[1]), count)
})

test('o repositório contém os arquivos que as pessoas procuram primeiro', () => {
  for (const file of [
    'LICENSE', 'NOTICE', 'README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'SUPPORT.md',
    'CHANGELOG.md', '.gitignore', '.editorconfig', '.nvmrc', '.github/workflows/ci.yml', '.github/dependabot.yml',
    '.github/ISSUE_TEMPLATE/bug_report.yml', '.github/ISSUE_TEMPLATE/feature_request.yml',
    '.github/ISSUE_TEMPLATE/config.yml', '.github/PULL_REQUEST_TEMPLATE.md', '.github/CODEOWNERS',
    'docs/self-hosting.md', 'docs/fresh-machine-test.md',
    'docs/images/dashboard.png', 'docs/images/wordmark.png', 'docs/images/faturador-wordmark.svg', 'app/Dockerfile', 'app/compose.yaml',
    'app/.env.example', 'app/supabase/migrations/00001_baseline.sql', 'plugins/README.md',
  ])
    assert.ok(existsSync(resolve(root, file)), `arquivo ausente: ${file}`)
})
