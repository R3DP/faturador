import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateConfig } from './validate-config.mjs'
const base = {
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55421',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_example',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_example',
}
test('uma instalação independente não exige credenciais do Stripe nem de e-mail', () =>
  assert.equal(validateConfig(base).app, 'http://localhost:3000'))
for (const [name, overrides] of Object.entries({
  'banco de dados ausente': { NEXT_PUBLIC_SUPABASE_URL: '' },
  'chaves iguais': { NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_example' },
  'segredo na chave pública': { NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_another' },
  'JWT público com função de serviço': {
    NEXT_PUBLIC_SUPABASE_ANON_KEY: `x.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.x`,
  },
  'HTTP fora da máquina local': { NEXT_PUBLIC_APP_URL: 'http://example.org' },
  'credenciais na URL': { NEXT_PUBLIC_APP_URL: 'https://user:pass@example.org' },
}))
  test(`rejeita ${name}`, () =>
    assert.throws(() => validateConfig({ ...base, ...overrides })))
const stripeTest = {
  STRIPE_SECRET_KEY: 'sk_test_example',
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_example',
  STRIPE_WEBHOOK_SECRET: 'whsec_example',
}
test('pagamentos com cartão aceitam um par de teste correspondente', () =>
  assert.equal(validateConfig({ ...base, ...stripeTest }).app, 'http://localhost:3000'))
for (const [name, overrides, message] of [
  ['configuração parcial do Stripe', { STRIPE_SECRET_KEY: 'sk_test_example' }, /os três valores/],
  ['modos diferentes do Stripe', { ...stripeTest, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_example' }, /modos diferentes/],
  ['segredo de webhook inválido', { ...stripeTest, STRIPE_WEBHOOK_SECRET: 'sk_test_example' }, /whsec_/],
  ['chave publicável no campo de segredo', { ...stripeTest, STRIPE_SECRET_KEY: 'pk_test_example' }, /STRIPE_SECRET_KEY deve começar/],
])
  test(`rejeita ${name}`, () => assert.throws(() => validateConfig({ ...base, ...overrides }), message))
for (const value of ['true', 'false', ''])
  test(`aceita BILLR_OPEN_SIGNUP=${value || '(vazio)'}`, () =>
    assert.equal(validateConfig({ ...base, BILLR_OPEN_SIGNUP: value }).app, 'http://localhost:3000'))
test('rejeita um valor de BILLR_OPEN_SIGNUP que fecharia a inscrição sem aviso', () =>
  assert.throws(() => validateConfig({ ...base, BILLR_OPEN_SIGNUP: 'yes' }), /BILLR_OPEN_SIGNUP/))

test('um contêiner não alcança um Supabase em loopback sem uma URL interna', () =>
  assert.throws(
    () => validateConfig({ ...base, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:56421', BILLR_CONTAINER: 'true' }),
    /SUPABASE_INTERNAL_URL.*http:\/\/host\.docker\.internal:56421/,
  ))
test('um contêiner também trata 0.0.0.0 como loopback', () =>
  assert.throws(
    () => validateConfig({ ...base, NEXT_PUBLIC_SUPABASE_URL: 'http://0.0.0.0:56421', BILLR_CONTAINER: 'true' }),
    /Dentro do contêiner, 0\.0\.0\.0 é o próprio contêiner.*http:\/\/host\.docker\.internal:56421/,
  ))
test('um contêiner com URL interna para o banco de dados local é aceito', () =>
  assert.equal(
    validateConfig({
      ...base,
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:56421',
      SUPABASE_INTERNAL_URL: 'http://host.docker.internal:56421',
      BILLR_CONTAINER: 'true',
    }).app,
    'http://localhost:3000',
  ))
test('um contêiner conectado a um Supabase público não precisa de URL interna', () =>
  assert.equal(
    validateConfig({
      ...base,
      NEXT_PUBLIC_APP_URL: 'https://invoices.example.org',
      NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.org',
      BILLR_CONTAINER: 'true',
    }).app,
    'https://invoices.example.org',
  ))
test('fora de um contêiner, um Supabase em loopback não precisa de URL interna', () =>
  assert.equal(validateConfig({ ...base, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:56421' }).app, 'http://localhost:3000'))
for (const value of ['host.docker.internal:56421', 'http://host.docker.internal:56421/rest', 'ftp://db.example.org'])
  test(`rejeita SUPABASE_INTERNAL_URL ${value}`, () =>
    assert.throws(() => validateConfig({ ...base, SUPABASE_INTERNAL_URL: value }), /SUPABASE_INTERNAL_URL deve ser uma origem HTTP\(S\)/))
