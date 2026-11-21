import { describe, expect, it } from 'vitest'
import { safeAuthRedirect } from './redirect'

describe('caminhos de retorno da autenticação', () => {
  it.each(['/invoices/new', '/agents?tab=keys', '/reset-password'])(
    'preserva o destino local %s',
    (path) => {
      expect(safeAuthRedirect(path)).toBe(path)
    },
  )
  it.each([
    null,
    '',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/%5cevil.example',
    '/%2fexample.com',
    '/%0a/evil.example',
    'javascript:alert(1)',
    '/%zz',
  ])('rejeita o destino inseguro %s', (path) => {
    expect(safeAuthRedirect(path)).toBe('/dashboard')
  })
})
