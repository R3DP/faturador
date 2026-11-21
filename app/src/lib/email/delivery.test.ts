import { describe, it, expect, afterEach } from 'vitest'
import { createFakeSupabase } from '@/lib/mcp/fake-supabase'
import { _setRateLimitStore } from '@/lib/rate-limit'
import { prepareDelivery, finishDelivery } from './delivery'
const request = '10000000-0000-4000-8000-000000000001'
function setup() {
  let row: Record<string, unknown> | null = null
  const db = createFakeSupabase({
    'email_deliveries.select': () => ({ data: row, error: null }),
    'email_deliveries.insert': (q) => {
      row = {
        ...(q.payload as object),
        created_at: new Date().toISOString(),
        sent_at: null,
      }
      return { data: row, error: null }
    },
    'email_deliveries.update': (q) => {
      row = { ...row, ...(q.payload as object) }
      return { data: row, error: null }
    },
  })
  return {
    db: db as never,
    age: () => {
      row!.created_at = new Date(Date.now() - 24 * 3600000).toISOString()
    },
  }
}
describe('entrega durável de e-mails', () => {
  it('reutiliza o conteúdo original mesmo quando a geração do PDF muda em uma nova tentativa', async () => {
    const { db } = setup()
    const a = await prepareDelivery(
      db,
      'b',
      'i',
      'invoice',
      request,
      { to: 'client@example.test' },
      { attachment: 'original' }
    )
    const b = await prepareDelivery(
      db,
      'b',
      'i',
      'invoice',
      request,
      { to: 'client@example.test' },
      { attachment: 'regenerated' }
    )
    expect(a.key).toBe(b.key)
    expect(b.payload.attachment).toBe('original')
  })
  it('retorna a entrega confirmada sem enviar novamente', async () => {
    const { db } = setup()
    await prepareDelivery(db, 'b', 'i', 'invoice', request, {}, {})
    await finishDelivery(db, 'b', request)
    expect(
      (await prepareDelivery(db, 'b', 'i', 'invoice', request, {}, {}))
        .alreadySent
    ).toBe(true)
  })
  it('rejeita a reutilização com destinatários diferentes', async () => {
    const { db } = setup()
    await prepareDelivery(
      db,
      'b',
      'i',
      'invoice',
      request,
      { to: 'a@example.test' },
      {}
    )
    await expect(
      prepareDelivery(
        db,
        'b',
        'i',
        'invoice',
        request,
        { to: 'b@example.test' },
        {}
      )
    ).rejects.toThrow('outro conteúdo de e-mail')
  })
  it('exige revisão após a janela de idempotência do provedor', async () => {
    const { db, age } = setup()
    await prepareDelivery(db, 'b', 'i', 'invoice', request, {}, {})
    age()
    await expect(
      prepareDelivery(db, 'b', 'i', 'invoice', request, {}, {})
    ).rejects.toThrow('precisa ser verificado')
  })
})

/**
 * A cota diária de envios é aplicada dentro de prepareDelivery, cobrindo
 * tanto as server actions quanto as ferramentas de envio do MCP em uma única
 * verificação. O importante é ONDE ela fica: uma cobrança por novo ID de
 * solicitação, nenhuma em nova tentativa de envio em andamento e nenhum
 * registro quando a cota se esgota.
 */
describe('cota diária de e-mails no fluxo de entrega', () => {
  const ORIGINAL = process.env.BILLR_EMAIL_DAILY_LIMIT
  afterEach(() => {
    _setRateLimitStore(null)
    if (ORIGINAL === undefined) delete process.env.BILLR_EMAIL_DAILY_LIMIT
    else process.env.BILLR_EMAIL_DAILY_LIMIT = ORIGINAL
  })
  function limiter(allowed: boolean) {
    const spends: unknown[] = []
    _setRateLimitStore(() => ({
      rpc: async (_fn: string, args: Record<string, unknown>) => {
        spends.push(args)
        return { data: [{ allowed, remaining: 0, retry_after_seconds: 3600 }], error: null }
      },
    }))
    return spends
  }

  it('cobra um envio por novo ID de solicitação e nada em uma nova tentativa', async () => {
    process.env.BILLR_EMAIL_DAILY_LIMIT = '200'
    const spends = limiter(true)
    const { db } = setup()
    await prepareDelivery(db, 'b', 'i', 'invoice', request, {}, {})
    await prepareDelivery(db, 'b', 'i', 'invoice', request, {}, {})
    expect(spends).toHaveLength(1)
  })

  it('recusa o envio sem registrar uma entrega quando a cota se esgota', async () => {
    process.env.BILLR_EMAIL_DAILY_LIMIT = '200'
    limiter(false)
    const { db } = setup()
    const fake = db as unknown as ReturnType<typeof createFakeSupabase>
    await expect(
      prepareDelivery(db, 'b', 'i', 'invoice', request, {}, {})
    ).rejects.toThrow('O limite diário de e-mails desta empresa foi atingido')
    expect(fake.calls.some((c) => c.op === 'insert')).toBe(false)
  })

  it('não consulta o limitador quando não há cota', async () => {
    delete process.env.BILLR_EMAIL_DAILY_LIMIT
    const spends = limiter(true)
    const { db } = setup()
    await prepareDelivery(db, 'b', 'i', 'invoice', request, {}, {})
    expect(spends).toEqual([])
  })
})
