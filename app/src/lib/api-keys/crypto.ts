import { createHash, randomBytes } from 'crypto'

/**
 * Dois prefixos, uma tabela.
 *
 *   billr_sk_  uma chave criada por uma pessoa no painel Agents e colada em algum lugar
 *   billr_at_  um token de acesso gerado pelo fluxo de consentimento OAuth
 *
 * Ambos são linhas de api_keys, ambos são armazenados com hash SHA-256 e
 * resolveApiKey os trata da mesma forma. O prefixo permite rastrear como uma
 * string vazada foi emitida (e deixa claro que um token OAuth não deve ser
 * colado manualmente em um arquivo de configuração).
 */
const KEY_RE = /^billr_(?:sk|at)_[0-9a-f]{48}$/

export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

function mint(prefix: 'sk' | 'at'): { secret: string; hash: string; prefix: string } {
  const secret = `billr_${prefix}_${randomBytes(24).toString('hex')}`
  return { secret, hash: hashApiKey(secret), prefix: secret.slice(0, 12) }
}

export function generateApiKey(): { secret: string; hash: string; prefix: string } {
  return mint('sk')
}

/** Token de acesso OAuth. Mesmo formato e armazenamento de uma chave manual. */
export function generateAccessToken(): { secret: string; hash: string; prefix: string } {
  return mint('at')
}

export function isValidKeyFormat(secret: string): boolean {
  return KEY_RE.test(secret)
}
