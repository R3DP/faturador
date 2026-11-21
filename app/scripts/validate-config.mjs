import { pathToFileURL } from 'node:url'
import dotenv from 'dotenv'

// Hosts que significam "esta máquina". Dentro de um contêiner, cada um deles é o
// próprio contêiner.
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]', '0.0.0.0']

export function validateConfig(env) {
  const required = [
    'NEXT_PUBLIC_APP_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]
  for (const key of required) {
    if (
      !env[key]?.trim() ||
      /replace-with|your_supabase|your-project/.test(env[key])
    )
      throw Error(`Configure ${key} para sua instalação`)
  }
  const origin = (value, name) => {
    const url = new URL(value)
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw Error(`${name} deve ser uma origem HTTP(S)`)
    if (
      url.protocol !== 'https:' &&
      !LOOPBACK.includes(url.hostname)
    )
      throw Error(`${name} deve usar HTTPS fora de localhost`)
    return url
  }
  const app = origin(env.NEXT_PUBLIC_APP_URL, 'NEXT_PUBLIC_APP_URL')
  const db = origin(env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL')
  // A origem entre servidores pode usar HTTP puro: geralmente é um nome de rede Docker
  // ou o gateway do host, nunca algo visível para o navegador.
  const internal = env.SUPABASE_INTERNAL_URL?.trim()
  if (internal) {
    let url
    try {
      url = new URL(internal)
    } catch {
      throw Error('SUPABASE_INTERNAL_URL deve ser uma origem HTTP(S)')
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw Error('SUPABASE_INTERNAL_URL deve ser uma origem HTTP(S)')
  }
  if (
    env.BILLR_CONTAINER === 'true' &&
    !internal &&
    LOOPBACK.includes(db.hostname)
  )
    throw Error(
      `Dentro do contêiner, ${db.hostname} é o próprio contêiner, não a sua máquina. Defina SUPABASE_INTERNAL_URL com um endereço que o contêiner possa alcançar; para o banco de dados de desenvolvimento local, use http://host.docker.internal:${db.port || '80'} (consulte docs/self-hosting.md)`,
    )
  if (env.NEXT_PUBLIC_SUPABASE_ANON_KEY === env.SUPABASE_SERVICE_ROLE_KEY)
    throw Error('As chaves pública e de função de serviço devem ser diferentes')
  const publicKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (publicKey.startsWith('sb_secret_'))
    throw Error('Um segredo do Supabase não pode ser usado como chave do navegador')
  if (publicKey.split('.').length === 3) {
    let payload
    try {
      payload = JSON.parse(
        Buffer.from(publicKey.split('.')[1], 'base64url').toString(),
      )
    } catch {
      throw Error('Chave pública do Supabase inválida')
    }
    if (payload.role !== 'anon')
      throw Error('O JWT do navegador deve ter a função anon')
  }
  if (
    env.RESEND_API_KEY &&
    !env.RESEND_INVOICE_FROM
  )
    throw Error('Configure seu próprio remetente verificado de e-mail de faturas')
  const openSignup = env.BILLR_OPEN_SIGNUP?.trim().toLowerCase()
  if (openSignup && !['true', 'false'].includes(openSignup))
    throw Error('BILLR_OPEN_SIGNUP deve ser true, false ou vazio')
  // Pagamentos com cartão: os três valores do Stripe devem vir juntos e do mesmo modo.
  const stripe = ['STRIPE_SECRET_KEY', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET']
  const stripeSet = stripe.filter((key) => env[key]?.trim())
  if (stripeSet.length && stripeSet.length < stripe.length)
    throw Error(
      `Pagamentos com cartão exigem os três valores de ${stripe.join(', ')}; faltam ${stripe
        .filter((key) => !env[key]?.trim())
        .join(', ')}`,
    )
  if (stripeSet.length) {
    const mode = (value, prefixes) => {
      for (const prefix of prefixes) {
        if (value.startsWith(`${prefix}_test_`)) return 'test'
        if (value.startsWith(`${prefix}_live_`)) return 'live'
      }
      return null
    }
    const secret = mode(env.STRIPE_SECRET_KEY.trim(), ['sk', 'rk'])
    const publishable = mode(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.trim(), ['pk'])
    if (!secret)
      throw Error('STRIPE_SECRET_KEY deve começar com sk_test_, sk_live_, rk_test_ ou rk_live_')
    if (!publishable)
      throw Error('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY deve começar com pk_test_ ou pk_live_')
    if (secret !== publishable)
      throw Error('As chaves secreta e publicável do Stripe são de modos diferentes (uma de teste e outra ativa)')
    if (!env.STRIPE_WEBHOOK_SECRET.trim().startsWith('whsec_'))
      throw Error('STRIPE_WEBHOOK_SECRET deve começar com whsec_')
  }
  return { app: app.origin }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  dotenv.config({ path: '.env.local', quiet: true })
  try {
    validateConfig(process.env)
    console.log(
      'Configuração da instalação validada (nenhum valor secreto foi exibido).',
    )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
