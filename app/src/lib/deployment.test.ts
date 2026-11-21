import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_DOCS_URL, DOCS_URL, appOrigin, mcpUrl } from './deployment'
afterEach(() => vi.unstubAllEnvs())
describe('isolamento da instalação', () => {
  it('usa serviços locais por padrão', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    expect(appOrigin()).toBe('http://localhost:3000')
    expect(mcpUrl()).toBe('http://localhost:3000/api/mcp')
  })
  it('gera links para esta instalação', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://invoices.example.org')
    expect(mcpUrl()).toBe('https://invoices.example.org/api/mcp')
  })
  it.each([
    'https://user:password@example.org',
    'https://example.org/subpath',
    'https://example.org?token=x',
    'javascript:alert(1)',
  ])('rejeita uma URL base ambígua %s', (value) => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', value)
    expect(() => appOrigin()).toThrow()
  })
  it('direciona os links de ajuda para a documentação pública', () => {
    expect(DOCS_URL).toBe('https://github.com/R3DP/faturador/tree/pt-br/docs')
    expect(AGENT_DOCS_URL).toBe('https://github.com/R3DP/faturador/blob/pt-br/plugins/README.md#instalações-auto-hospedadas')
  })
})
