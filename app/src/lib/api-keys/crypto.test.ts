import { describe, it, expect } from 'vitest'
import {
  generateAccessToken,
  generateApiKey,
  hashApiKey,
  isValidKeyFormat,
} from '@/lib/api-keys/crypto'

describe('criptografia de chaves de API', () => {
  it('gera billr_sk_ seguido de 48 caracteres hexadecimais', () => {
    const { secret } = generateApiKey()
    expect(secret).toMatch(/^billr_sk_[0-9a-f]{48}$/)
  })

  it('gera segredos únicos', () => {
    expect(generateApiKey().secret).not.toBe(generateApiKey().secret)
  })

  it('o hash é o SHA-256 hexadecimal determinístico do segredo', () => {
    const { secret, hash } = generateApiKey()
    expect(hash).toBe(hashApiKey(secret))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('o prefixo corresponde aos 12 primeiros caracteres do segredo', () => {
    const { secret, prefix } = generateApiKey()
    expect(prefix).toBe(secret.slice(0, 12))
    expect(prefix).toMatch(/^billr_sk_[0-9a-f]{3}$/)
  })

  it('corresponde ao hash de referência para uma entrada conhecida', () => {
    expect(hashApiKey('billr_sk_' + 'a'.repeat(48))).toBe(
      'a1dde26e4b0f73d5b4a8f12fe23b19310b9def53437dd11ae97c898c65e04313'
    )
  })

  it('valida o formato da chave', () => {
    expect(isValidKeyFormat('billr_sk_' + 'a'.repeat(48))).toBe(true)
    expect(isValidKeyFormat('billr_sk_short')).toBe(false)
    expect(isValidKeyFormat('sk_' + 'a'.repeat(48))).toBe(false)
  })

  it('gera tokens de acesso OAuth no mesmo formato, com o prefixo billr_at_', () => {
    const { secret, hash, prefix } = generateAccessToken()
    expect(secret).toMatch(/^billr_at_[0-9a-f]{48}$/)
    expect(hash).toBe(hashApiKey(secret))
    expect(prefix).toBe(secret.slice(0, 12))
    // resolveApiKey usa esta validação como barreira, portanto um token OAuth precisa passar.
    expect(isValidKeyFormat(secret)).toBe(true)
  })

  it('continua rejeitando valores que não usam nenhum dos prefixos', () => {
    expect(isValidKeyFormat('billr_rt_' + 'a'.repeat(48))).toBe(false)
    expect(isValidKeyFormat('billr_at_' + 'A'.repeat(48))).toBe(false)
  })
})
