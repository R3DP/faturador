import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8')
const compose = readFileSync(new URL('../compose.yaml', import.meta.url), 'utf8')

test('a compilação da imagem oferece ao Next.js pelo menos 3 GB de heap por padrão', () => {
  const heap = dockerfile.match(/^ARG BILLR_BUILD_HEAP_MB=(\d+)$/m)
  assert(heap, 'falta o argumento de compilação BILLR_BUILD_HEAP_MB')
  assert(Number(heap[1]) >= 3072, `o heap padrão de compilação é ${heap[1]} MB`)
  assert.match(dockerfile, /--max-old-space-size=\$\{BILLR_BUILD_HEAP_MB\} npm run build/)
})

test('nenhuma etapa de compilação fixa um heap menor', () => {
  assert.doesNotMatch(dockerfile, /--max-old-space-size=\d+ npm run build/)
})

test('o contêiner em execução sabe que está em um contêiner', () => {
  assert.match(dockerfile, /^ENV .*\bBILLR_CONTAINER=true\b/m)
})

test('o Compose encaminha o heap de compilação', () => {
  assert.match(compose, /BILLR_BUILD_HEAP_MB: \$\{BILLR_BUILD_HEAP_MB:-3072\}/)
})

test('o Compose permite que o contêiner alcance o host, inclusive no Linux', () => {
  assert.match(compose, /- 'host\.docker\.internal:host-gateway'/)
})

test('o Compose obtém SUPABASE_INTERNAL_URL do shell ou do arquivo de ambiente', () => {
  assert.match(compose, /SUPABASE_INTERNAL_URL: \$\{SUPABASE_INTERNAL_URL:-\}/)
})
