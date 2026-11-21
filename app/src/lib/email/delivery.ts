import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Json } from '@/types/database'
import type { Database } from '@/types/database'
import { consumeEmailQuota } from '@/lib/email/quota'
/**
 * Único ponto de passagem de todos os e-mails de faturas e orçamentos,
 * tanto pelas server actions quanto pelas ferramentas de envio do MCP. Por
 * isso, a cota diária é aplicada aqui, e não em cada ponto de chamada:
 * nenhuma das interfaces pode contornar essa verificação.
 */
export async function prepareDelivery<T>(
  db: SupabaseClient<Database>,
  businessId: string,
  documentId: string,
  kind: 'invoice' | 'estimate',
  requestId: string,
  input: unknown,
  payload: T
) {
  z.uuid().parse(requestId)
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
  const read = () =>
    db
      .from('email_deliveries')
      .select('*')
      .eq('business_id', businessId)
      .eq('request_id', requestId)
      .maybeSingle()
  const initial = await read()
  let row = initial.data
  const error = initial.error
  if (error) throw new Error('Não foi possível verificar a entrega do e-mail')
  if (!row) {
    // Cobrada uma vez por novo ID de solicitação, antes de existir a linha de entrega.
    // Os dois pontos importam: uma nova tentativa reutiliza o ID do envio em
    // andamento e não deve ser cobrada novamente; um envio recusado não pode
    // deixar uma linha parcial que atrapalhe outra tentativa.
    await consumeEmailQuota(businessId)
    const inserted = await db
      .from('email_deliveries')
      .insert({
        business_id: businessId,
        document_id: documentId,
        kind,
        request_id: requestId,
        input_hash: hash,
        payload: payload as Json,
      })
      .select('*')
      .single()
    if (inserted.error && inserted.error.code !== '23505')
      throw new Error('Não foi possível preparar a entrega do e-mail')
    row = inserted.data
    if (!row) {
      const replay = await read()
      if (replay.error) throw new Error('Não foi possível verificar a entrega do e-mail')
      row = replay.data
    }
  }
  if (
    !row ||
    row.document_id !== documentId ||
    row.kind !== kind ||
    row.input_hash !== hash
  )
    throw new Error(
      'Este ID de solicitação já foi usado para outro conteúdo de e-mail. Revise e use um novo ID de solicitação.'
    )
  if (row.sent_at)
    return {
      payload: row.payload as T,
      alreadySent: true,
      key: `billr:${businessId}:${requestId}`,
    }
  // O Resend mantém chaves de idempotência por 24 horas. Nunca reenvie sem verificar um resultado antigo desconhecido.
  if (Date.now() - Date.parse(row.created_at) > 23 * 3600000)
    throw new Error(
      'O resultado da entrega precisa ser verificado no provedor de e-mail antes de enviar novamente.'
    )
  return {
    payload: row.payload as T,
    alreadySent: false,
    key: `billr:${businessId}:${requestId}`,
  }
}
export async function finishDelivery(
  db: SupabaseClient<Database>,
  businessId: string,
  requestId: string
) {
  const { error } = await db
    .from('email_deliveries')
    .update({ sent_at: new Date().toISOString() })
    .eq('business_id', businessId)
    .eq('request_id', requestId)
  if (error)
    throw new Error(
      'E-mail aceito, mas não foi possível salvar o status da entrega. Tente novamente usando o mesmo ID de solicitação.'
    )
}
