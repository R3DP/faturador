import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_LOGO_URL_LENGTH,
  isAllowedLogoUrl,
  supabaseStorageOrigin,
} from './logo-url'

const SUPABASE = 'https://example-install.supabase.co'
const good = `${SUPABASE}/storage/v1/object/public/logos/b1/logo-1.png`

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isAllowedLogoUrl', () => {
  it('aceita um envio na origem de armazenamento desta instalação', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE)
    expect(isAllowedLogoUrl(good)).toBe(true)
  })

  it.each([
    // Low-2: zod 4 `z.string().url()` aceita todos estes quatro valores.
    'javascript:alert(1)',
    'data:image/png;base64,iVBORw0KGgo=',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
  ])('recusa o esquema em %s', (value) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE)
    expect(isAllowedLogoUrl(value)).toBe(false)
  })

  it.each([
    // Low-3: qualquer um destes seria buscado no servidor pela rota pública de PDF.
    'https://evil.example/logo.png',
    'https://example-install.supabase.co.evil.example/storage/v1/object/public/logos/b1/x.png',
    'http://example-install.supabase.co/storage/v1/object/public/logos/b1/x.png',
    'https://example-install.supabase.co:8443/storage/v1/object/public/logos/b1/x.png',
    'https://user:pw@example-install.supabase.co/storage/v1/object/public/logos/b1/x.png',
  ])('recusa a origem em %s', (value) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE)
    expect(isAllowedLogoUrl(value)).toBe(false)
  })

  it.each([
    `${SUPABASE}/storage/v1/object/public/receipts/b1/x.png`,
    `${SUPABASE}/rest/v1/businesses?select=*`,
    `${SUPABASE}/storage/v1/object/public/logos`,
    `${SUPABASE}/`,
  ])('recusa o caminho em %s', (value) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE)
    expect(isAllowedLogoUrl(value)).toBe(false)
  })

  it('recusa tudo quando nenhuma URL do Supabase está configurada', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    expect(isAllowedLogoUrl(good)).toBe(false)
    expect(supabaseStorageOrigin()).toBeNull()
  })

  it('valida usando a origem de armazenamento configurada', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://storage.example.org')
    expect(isAllowedLogoUrl(good)).toBe(false)
    expect(
      isAllowedLogoUrl('https://storage.example.org/storage/v1/object/public/logos/b1/l.png'),
    ).toBe(true)
  })

  it('permite a pilha local da CLI, que usa http em loopback', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:56421')
    expect(
      isAllowedLogoUrl('http://127.0.0.1:56421/storage/v1/object/public/logos/b1/l.png'),
    ).toBe(true)
  })

  it('recusa um valor que não seja string, uma string vazia e um valor longo demais', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE)
    expect(isAllowedLogoUrl(undefined)).toBe(false)
    expect(isAllowedLogoUrl('')).toBe(false)
    expect(isAllowedLogoUrl(good + 'x'.repeat(MAX_LOGO_URL_LENGTH))).toBe(false)
  })
})
