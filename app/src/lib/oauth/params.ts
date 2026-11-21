import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Regras puras dos parâmetros de requisição dos endpoints OAuth. Sem banco de dados nem ambiente, então
 * cada rejeição abaixo pode ser testada diretamente e os handlers das rotas permanecem simples.
 */

/** Maior string fornecida pelo cliente que armazenaremos ou devolveremos. */
const MAX_TEXT = 500
const MAX_CLIENT_NAME = 200
const MAX_REDIRECT_URIS = 10

/** Hosts que um redirecionamento http:// pode indicar. `[::1]` é a forma como WHATWG URL representa ::1. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Lista de URIs de redirecionamento permitidas.
 *
 * https:// em qualquer endereço, além de http:// nos nomes de loopback para que uma CLI ou app de desktop
 * possa receber o redirecionamento em uma porta efêmera (RFC 8252). Todo o restante
 * é recusado: não é possível verificar se um esquema personalizado pertence ao cliente,
 * e o uso de http sem TLS para um host remoto transmitiria o código de autorização
 * sem criptografia. Fragmentos são recusados porque o código é enviado na
 * query, e um fragmento seria descartado ou duplicado pelo parser do cliente.
 *
 * As três formas de loopback são aceitas. A seção 7.3 da RFC 8252 recomenda
 * que servidores de autorização aceitem o literal IPv6 `[::1]`, além de
 * `127.0.0.1`, pois uma máquina somente IPv6 não consegue vincular o endereço IPv4
 * de modo algum; `localhost` pode resolver para qualquer um deles e também é aceito. WHATWG
 * `URL` mantém os colchetes em `hostname` para um literal IPv6, portanto a
 * comparação é com `[::1]`, não com `::1`.
 */
export function isAllowedRedirectUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TEXT) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.hash || url.username || url.password) return false
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  return LOOPBACK_HOSTS.has(url.hostname)
}

/**
 * URIs de redirecionamento registradas são comparadas exatamente, byte a byte. Qualquer comparação "começa
 * com" ou apenas pelo host permite que um cliente registrado redirecione o código para um
 * caminho que nunca registrou, a clássica vulnerabilidade de redirecionamento aberto para
 * roubo do código.
 */
export function matchesRegisteredRedirect(
  candidate: string,
  registered: readonly string[]
): boolean {
  return registered.includes(candidate)
}

export function normaliseClientName(value: unknown): string {
  if (typeof value !== 'string') return 'Cliente MCP'
  // Caracteres de controle permitiriam que o nome do cliente inserisse quebras de linha na
  // tela de consentimento ou em uma linha de log.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if (!cleaned) return 'Cliente MCP'
  return cleaned.slice(0, MAX_CLIENT_NAME)
}

export interface RedirectUriCheck {
  ok: boolean
  uris: string[]
  reason?: string
}

export function validateRedirectUris(value: unknown): RedirectUriCheck {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, uris: [], reason: 'redirect_uris deve ser uma lista não vazia' }
  }
  if (value.length > MAX_REDIRECT_URIS) {
    return { ok: false, uris: [], reason: `redirect_uris não pode exceder ${MAX_REDIRECT_URIS} entradas` }
  }
  const uris: string[] = []
  for (const entry of value) {
    if (!isAllowedRedirectUri(entry)) {
      return {
        ok: false,
        uris: [],
        reason:
          'redirect_uris deve conter URLs https:// ou URLs http:// em localhost, 127.0.0.1 ou [::1]',
      }
    }
    if (!uris.includes(entry)) uris.push(entry)
  }
  return { ok: true, uris }
}

// ---------------------------------------------------------------------------
// PKCE (RFC 7636). Apenas S256: "plain" não oferece proteção contra um invasor
// que consiga ver a requisição de autorização.
// ---------------------------------------------------------------------------

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/
const CHALLENGE_RE = /^[A-Za-z0-9\-_]{43}$/

export function isValidCodeChallenge(value: unknown): value is string {
  return typeof value === 'string' && CHALLENGE_RE.test(value)
}

export function isValidCodeVerifier(value: unknown): value is string {
  return typeof value === 'string' && VERIFIER_RE.test(value)
}

export function challengeFromVerifier(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

/** Comparação em tempo constante, para que não seja possível descobrir um verificador incorreto byte a byte. */
export function verifyPkce(verifier: unknown, challenge: string): boolean {
  if (!isValidCodeVerifier(verifier)) return false
  const computed = Buffer.from(challengeFromVerifier(verifier))
  const expected = Buffer.from(challenge)
  if (computed.length !== expected.length) return false
  return timingSafeEqual(computed, expected)
}

// ---------------------------------------------------------------------------
// Segredos
// ---------------------------------------------------------------------------

/** 32 bytes aleatórios, seguros para URL. Usados em códigos e tokens de atualização. */
export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

export function generateClientId(): string {
  return `billr_client_${randomBytes(16).toString('hex')}`
}

// ---------------------------------------------------------------------------
// Indicadores de recurso da RFC 8707
// ---------------------------------------------------------------------------

/**
 * Quando presente, o indicador de recurso deve identificar o servidor MCP desta instalação.
 * Aceitar qualquer outro valor permitiria que um cliente obtivesse um token que acredita estar
 * limitado a um público diferente.
 */
export function resourceMatches(candidate: string | null | undefined, resource: string): boolean {
  if (!candidate) return true
  try {
    const a = new URL(candidate)
    const b = new URL(resource)
    return (
      a.origin === b.origin &&
      a.pathname.replace(/\/+$/, '') === b.pathname.replace(/\/+$/, '') &&
      !a.hash
    )
  } catch {
    return false
  }
}

/** Monta o redirecionamento de volta ao cliente, preservando `state` sem alterações. */
export function buildRedirect(
  redirectUri: string,
  params: Record<string, string | null | undefined>
): string {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') url.searchParams.set(key, value)
  }
  return url.toString()
}

