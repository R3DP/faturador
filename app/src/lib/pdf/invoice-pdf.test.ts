import { afterEach, describe, it, expect, vi } from 'vitest'

// Um endereço público, portanto a lista de bloqueio contra SSRF não é o que
// recusa os casos abaixo: é a restrição à origem. Sem o mock, um host inventado
// simplesmente não seria resolvido e o teste passaria pelo motivo errado.
vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
}))

import { fetchLogo, isBlockedLogoAddress } from './invoice-pdf'

describe('isBlockedLogoAddress (proteção contra SSRF)', () => {
  it('permite endereços IPv4 públicos', () => {
    expect(isBlockedLogoAddress('8.8.8.8')).toBe(false)
    expect(isBlockedLogoAddress('1.1.1.1')).toBe(false)
    expect(isBlockedLogoAddress('93.184.216.34')).toBe(false)
  })

  it('permite endereços IPv6 públicos', () => {
    expect(isBlockedLogoAddress('2606:4700:4700::1111')).toBe(false)
  })

  it('recusa endereços de loopback 127/8', () => {
    expect(isBlockedLogoAddress('127.0.0.1')).toBe(true)
    expect(isBlockedLogoAddress('127.1.2.3')).toBe(true)
  })

  it('recusa endereços privados 10/8', () => {
    expect(isBlockedLogoAddress('10.0.0.1')).toBe(true)
    expect(isBlockedLogoAddress('10.255.255.255')).toBe(true)
  })

  it('recusa endereços privados 172.16/12', () => {
    expect(isBlockedLogoAddress('172.16.0.1')).toBe(true)
    expect(isBlockedLogoAddress('172.31.255.255')).toBe(true)
    // o endereço logo fora da faixa continua permitido
    expect(isBlockedLogoAddress('172.15.0.1')).toBe(false)
    expect(isBlockedLogoAddress('172.32.0.1')).toBe(false)
  })

  it('recusa endereços privados 192.168/16', () => {
    expect(isBlockedLogoAddress('192.168.0.1')).toBe(true)
    expect(isBlockedLogoAddress('192.168.1.100')).toBe(true)
  })

  it('recusa endereços link-local e metadados de nuvem 169.254/16', () => {
    expect(isBlockedLogoAddress('169.254.169.254')).toBe(true)
  })

  it('recusa 0.0.0.0', () => {
    expect(isBlockedLogoAddress('0.0.0.0')).toBe(true)
  })

  it('recusa loopback IPv6 e endereços unique-local/link-local', () => {
    expect(isBlockedLogoAddress('::1')).toBe(true)
    expect(isBlockedLogoAddress('fc00::1')).toBe(true)
    expect(isBlockedLogoAddress('fd12:3456::1')).toBe(true)
    expect(isBlockedLogoAddress('fe80::1')).toBe(true)
  })

  it('recusa loopback IPv6 mapeado para IPv4', () => {
    expect(isBlockedLogoAddress('::ffff:127.0.0.1')).toBe(true)
  })
})

/**
 * A rota pública do PDF chama fetchLogo sem sessão, e a URL vem de
 * businesses.logo_url. Qualquer endereço que não seja a origem de armazenamento
 * desta instalação deve ser recusado antes que um pacote saia do servidor, para
 * impedir que a rota seja usada para buscar conteúdo de um host arbitrário.
 */
describe('restrição de origem de fetchLogo', () => {
  const SUPABASE = 'https://example-install.supabase.co'
  const good = `${SUPABASE}/storage/v1/object/public/logos/b1/logo.png`

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  function stubFetch() {
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it.each([
    'https://evil.example/logo.png',
    'https://example-install.supabase.co.evil.example/logo.png',
    'https://example-install.supabase.co/rest/v1/businesses?select=*',
    'http://169.254.169.254/latest/meta-data/',
    'javascript:alert(1)',
  ])('never fetches %s', async (url) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE)
    const fetchMock = stubFetch()

    expect(await fetchLogo(url)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('busca um logotipo na origem de armazenamento desta instalação', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE)
    const fetchMock = stubFetch()

    const logo = await fetchLogo(good)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(logo?.format).toBe('png')
  })

  it('recusa tudo quando nenhuma URL do Supabase está configurada', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    const fetchMock = stubFetch()

    expect(await fetchLogo(good)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
