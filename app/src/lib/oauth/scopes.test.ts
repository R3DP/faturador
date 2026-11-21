import { describe, expect, it } from 'vitest'
import {
  CONSENT_CHOICES,
  DEFAULT_PERMISSIONS,
  OAUTH_SCOPES,
  formatScope,
  isSubsetOf,
  narrowPermissions,
  parseScope,
  requestedPermissions,
} from './scopes'

describe('interpretação de escopos', () => {
  it('interpreta escopos separados por espaço e descarta valores desconhecidos', () => {
    expect(parseScope('read write send')).toEqual(['read', 'write', 'send'])
    expect(parseScope('read  payments')).toEqual(['read', 'payments'])
    expect(parseScope('admin root')).toEqual([])
    expect(parseScope(undefined)).toEqual([])
  })

  it('retorna os escopos em ordem estável, independentemente da ordem solicitada', () => {
    expect(parseScope('payments read')).toEqual(['read', 'payments'])
  })
})

describe('seleção inicial da tela de consentimento', () => {
  it('usa leitura e rascunho por padrão quando nenhum escopo é solicitado', () => {
    expect(requestedPermissions(null)).toEqual([...DEFAULT_PERMISSIONS])
  })

  it('pré-seleciona os escopos solicitados e sempre inclui read', () => {
    expect(requestedPermissions('write send')).toEqual(['read', 'write', 'send'])
    expect(requestedPermissions('delete')).toEqual(['read', 'delete'])
  })

  it('respeita uma solicitação mais restrita que o padrão', () => {
    expect(requestedPermissions('read')).toEqual(['read'])
  })

  it('usa o padrão quando os escopos solicitados não incluem nenhum valor conhecido', () => {
    expect(requestedPermissions('openid profile')).toEqual([...DEFAULT_PERMISSIONS])
  })
})

describe('restrição de escopos', () => {
  it('mantém somente escopos conhecidos', () => {
    expect(narrowPermissions(['read', 'write', 'root'])).toEqual(['read', 'write'])
  })

  it('nunca concede permissões acima do limite, impedindo que uma renovação amplie os acessos', () => {
    expect(narrowPermissions(['read', 'write', 'send'], ['read', 'write'])).toEqual([
      'read',
      'write',
    ])
  })

  it('permite que a pessoa restrinja o que o cliente solicitou', () => {
    const asked = requestedPermissions('write send payments delete')
    expect(asked).toEqual(['read', 'write', 'send', 'delete', 'payments'])
    // A tela de consentimento deixou send, payments e delete desmarcados.
    expect(narrowPermissions(['read', 'write'], asked)).toEqual(['read', 'write'])
  })

  it('sempre mantém read em uma concessão', () => {
    expect(narrowPermissions([])).toEqual(['read'])
    expect(narrowPermissions(['write'])).toEqual(['read', 'write'])
  })

  it('verifica subconjuntos para a concessão de renovação', () => {
    expect(isSubsetOf(['read'], ['read', 'write'])).toBe(true)
    expect(isSubsetOf(['read', 'send'], ['read', 'write'])).toBe(false)
  })

  it('formata novamente a string de escopos para a resposta do token', () => {
    expect(formatScope(['read', 'write'])).toBe('read write')
  })
})

describe('texto de consentimento', () => {
  it('exibe exatamente uma linha por permissão e mantém read fixo', () => {
    // A ordem é a da tela (maior risco por último), não a da lista de escopos.
    expect([...CONSENT_CHOICES.map((c) => c.permission)].sort()).toEqual([...OAUTH_SCOPES].sort())
    expect(CONSENT_CHOICES.filter((c) => c.fixed).map((c) => c.permission)).toEqual(['read'])
    for (const choice of CONSENT_CHOICES) {
      expect(choice.consequence.length).toBeGreaterThan(20)
    }
  })
})
