import 'server-only'
import { consumeRateLimit, rateLimitKey, type RateLimitPolicy } from '@/lib/rate-limit'

/**
 * Limite opcional de envios de e-mail por empresa, definido por BILLR_EMAIL_DAILY_LIMIT.
 * Os e-mails são enviados pela sua própria conta e domínio do Resend; por isso, não há limite
 * a menos que você defina um.
 *
 * FORMATO DA JANELA: o limitador persistente usa janelas fixas, alinhadas
 * pelo início da época Unix e arredondadas para baixo conforme a duração da janela, limitada a no máximo 24 horas.
 * Portanto, esta janela de 24 horas reinicia em um limite fixo, não é deslizante:
 * a indicação de renovação em cerca de N horas é exata, e um pico que
 * atravesse o limite pode atingir até o dobro da cota nesse intervalo.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Lançado quando uma empresa esgota sua cota diária. */
export class EmailQuotaError extends Error {
  /** Horas inteiras até a renovação da janela, com mínimo de 1. */
  readonly resetsInHours: number
  constructor(resetsInHours: number) {
    super(
      `O limite diário de e-mails desta empresa foi atingido. A cota será renovada em cerca de ${resetsInHours} ${
        resetsInHours === 1 ? 'hora' : 'horas'
      }.`
    )
    this.name = 'EmailQuotaError'
    this.resetsInHours = resetsInHours
  }
}

/**
 * Determina o limite vigente ou retorna null quando não há limite.
 *
 * BILLR_EMAIL_DAILY_LIMIT é aplicado quando contém um número inteiro
 * positivo. Qualquer outro valor (vazio, zero, negativo, fracionário ou não numérico)
 * é ignorado com um aviso: um erro de digitação como "0" ou "abc" não deve
 * desativar todos os envios silenciosamente, o que seria muito pior do que
 * enviar sem limite.
 */
export function emailDailyLimit(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.BILLR_EMAIL_DAILY_LIMIT?.trim()
  if (raw) {
    const parsed = Number(raw)
    if (Number.isInteger(parsed) && parsed > 0) return parsed
    console.error(
      `cota de e-mail: ignorando BILLR_EMAIL_DAILY_LIMIT=${raw} (esperado um número inteiro positivo de envios por dia)`
    )
  }
  return null
}

/**
 * Política do limitador para a cota diária de uma empresa. Definida aqui, em vez
 * de ser adicionada a RATE_LIMITS, porque o limite não é constante: depende
 * da variável de ambiente do operador.
 *
 * BLOQUEIA EM CASO DE FALHA, como as outras políticas do produto. O custo é baixo:
 * o fluxo de envio não pode terminar sem o PostgreSQL (prepareDelivery lê
 * e grava em email_deliveries), então a indisponibilidade do armazenamento já impediria o envio
 * de qualquer forma. Permitir envios sem limite nesse momento entregaria uma cota ilimitada
 * justamente quando o banco de dados está com problemas.
 */
function emailQuotaPolicy(limit: number): RateLimitPolicy {
  return { limit, windowMs: DAY_MS }
}

/** Chave do bucket. O ID da empresa é transformado em hash por rateLimitKey, como nos demais buckets. */
export function emailQuotaBucket(businessId: string): string {
  return rateLimitKey('email:send', businessId)
}

/**
 * Consome um envio da cota diária da empresa ou lança
 * EmailQuotaError. Não faz nada (nem uma ida e volta ao banco) quando não há limite, que é
 * o comportamento padrão.
 */
export async function consumeEmailQuota(businessId: string): Promise<void> {
  const limit = emailDailyLimit()
  if (limit === null) return
  const decision = await consumeRateLimit(emailQuotaBucket(businessId), emailQuotaPolicy(limit))
  if (decision.allowed) return
  throw new EmailQuotaError(Math.max(1, Math.round(decision.retryAfterSeconds / 3600)))
}
