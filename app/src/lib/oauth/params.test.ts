import { describe, expect, it } from 'vitest'
import {
  buildRedirect,
  challengeFromVerifier,
  generateSecret,
  isAllowedRedirectUri,
  isValidCodeChallenge,
  isValidCodeVerifier,
  matchesRegisteredRedirect,
  normaliseClientName,
  resourceMatches,
  validateRedirectUris,
  verifyPkce,
} from './params'

describe('regras de URI de redirecionamento', () => {
  it.each([
    'https://claude.ai/api/mcp/auth_callback',
    'https://example.org/cb?x=1',
    'http://localhost:33418/callback',
    'http://127.0.0.1:8976/oauth',
    'http://localhost/cb',
    // RFC 8252 s7.3: o literal de loopback IPv6, único endereço ao qual uma máquina
    // somente IPv6 pode vincular um cliente nativo.
    'http://[::1]:33418/callback',
    'http://[::1]/cb',
  ])('aceita %s', (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(true)
  })

  it('também aceita um redirecionamento de loopback IPv6 durante o registro', () => {
    const result = validateRedirectUris([
      'http://[::1]:33418/callback',
      'http://127.0.0.1:33418/callback',
    ])
    expect(result.ok).toBe(true)
    expect(result.uris).toHaveLength(2)
  })

  it.each([
    // Somente o próprio endereço de loopback. ::2 e a forma mapeada de IPv4
    // são roteáveis ou ambíguos, e nenhum deles é recomendado pela RFC 8252.
    'http://[::2]/cb',
    'http://[::ffff:127.0.0.1]/cb',
    'http://[2001:db8::1]/cb',
  ])('rejeita o literal IPv6 que não é de loopback %s', (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(false)
  })

  it.each([
    'http://example.org/cb',
    'http://localhost.evil.com/cb',
    'ftp://example.org/cb',
    'cursor://anysphere.cursor-deeplink/mcp/callback',
    'https://example.org/cb#frag',
    'https://user:pass@example.org/cb',
    'not a url',
    '',
  ])('rejeita %s', (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(false)
  })

  it('exige uma lista limitada e não vazia durante o registro', () => {
    expect(validateRedirectUris(['https://a.example/cb']).ok).toBe(true)
    expect(validateRedirectUris([]).ok).toBe(false)
    expect(validateRedirectUris('https://a.example/cb').ok).toBe(false)
    expect(validateRedirectUris(undefined).ok).toBe(false)
    expect(validateRedirectUris(Array(11).fill('https://a.example/cb')).ok).toBe(false)
  })

  it('rejeita todo o registro quando alguma entrada não é permitida', () => {
    const result = validateRedirectUris(['https://a.example/cb', 'http://evil.example/cb'])
    expect(result.ok).toBe(false)
    expect(result.uris).toEqual([])
  })

  it('remove duplicatas', () => {
    const result = validateRedirectUris(['https://a.example/cb', 'https://a.example/cb'])
    expect(result.uris).toEqual(['https://a.example/cb'])
  })

  it('compara URIs registradas exatamente, nunca por prefixo', () => {
    const registered = ['https://a.example/cb']
    expect(matchesRegisteredRedirect('https://a.example/cb', registered)).toBe(true)
    expect(matchesRegisteredRedirect('https://a.example/cb/../evil', registered)).toBe(false)
    expect(matchesRegisteredRedirect('https://a.example/cb?x=1', registered)).toBe(false)
    expect(matchesRegisteredRedirect('https://a.example', registered)).toBe(false)
  })
})

describe('nome do cliente', () => {
  it('usa um valor padrão, remove caracteres de controle e limita o comprimento', () => {
    expect(normaliseClientName(undefined)).toBe('Cliente MCP')
    expect(normaliseClientName('   ')).toBe('Cliente MCP')
    expect(normaliseClientName('Claude\nCode')).toBe('Claude Code')
    expect(normaliseClientName('x'.repeat(500))).toHaveLength(200)
  })
})

describe('PKCE', () => {
  it('aceita um verificador cujo hash corresponde ao desafio armazenado', () => {
    const verifier = generateSecret(48)
    expect(isValidCodeVerifier(verifier)).toBe(true)
    const challenge = challengeFromVerifier(verifier)
    expect(isValidCodeChallenge(challenge)).toBe(true)
    expect(verifyPkce(verifier, challenge)).toBe(true)
  })

  it('rejeita um verificador incorreto, malformado ou ausente', () => {
    const challenge = challengeFromVerifier(generateSecret(48))
    expect(verifyPkce(generateSecret(48), challenge)).toBe(false)
    expect(verifyPkce('short', challenge)).toBe(false)
    expect(verifyPkce(undefined, challenge)).toBe(false)
  })

  it('rejeita um desafio que não seja um resumo SHA-256 em base64url', () => {
    expect(isValidCodeChallenge('plain-challenge')).toBe(false)
    expect(isValidCodeChallenge('a'.repeat(42))).toBe(false)
    expect(isValidCodeChallenge('a/b+c'.padEnd(43, 'a'))).toBe(false)
  })
})

describe('indicador de recurso', () => {
  const resource = 'https://mcp.example.org'
  it('é opcional', () => {
    expect(resourceMatches(undefined, resource)).toBe(true)
    expect(resourceMatches(null, resource)).toBe(true)
  })
  it('aceita esta instalação com ou sem barra final', () => {
    expect(resourceMatches('https://mcp.example.org', resource)).toBe(true)
    expect(resourceMatches('https://mcp.example.org/', resource)).toBe(true)
  })
  it('rejeita outro público', () => {
    expect(resourceMatches('https://evil.example', resource)).toBe(false)
    expect(resourceMatches('https://mcp.example.org/other', resource)).toBe(false)
    expect(resourceMatches('nonsense', resource)).toBe(false)
  })
  it('compara um recurso que inclui caminho', () => {
    expect(resourceMatches('https://x.example/api/mcp/', 'https://x.example/api/mcp')).toBe(true)
    expect(resourceMatches('https://x.example/api', 'https://x.example/api/mcp')).toBe(false)
  })
})

describe('montagem do redirecionamento', () => {
  it('preserva a consulta do cliente e descarta valores vazios', () => {
    const url = buildRedirect('https://a.example/cb?keep=1', {
      code: 'abc',
      state: '',
      iss: 'https://invoices.example.org',
    })
    expect(url).toBe('https://a.example/cb?keep=1&code=abc&iss=https%3A%2F%2Finvoices.example.org')
  })
})
