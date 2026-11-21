'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { engagementErrorMessage } from '@/lib/engagements/errors'
import { BILLING_MODES, DUE_RULES, MAX_ENTRIES } from '@/lib/engagements/schedule'
import { failure } from './result'

/**
 * Gravações de contratos iniciadas pelo navegador.
 *
 * Cada uma é um wrapper fino em torno de uma RPC SECURITY DEFINER. As regras
 * ficam lá, não aqui: a agenda é expandida em SQL para que os lançamentos sempre
 * fechem, request_id faz uma nova tentativa reproduzir a operação em vez de
 * gravá-la de novo, e o banco recusa valores já faturados independentemente
 * do que este arquivo faça.
 *
 * Este arquivo acrescenta validação de entrada e uma mensagem compreensível.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const entryInput = z.object({
  label: z.string().trim().max(200).optional(),
  amount: z.number().finite().positive().optional(),
  percent: z.number().finite().positive().max(100).optional(),
  due_rule: z.enum(DUE_RULES).optional(),
  due_on: DATE.nullish(),
})

const engagementInput = z.object({
  client_id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  total: z.number().finite().positive().max(99999999),
  currency: z.string().trim().length(3).optional(),
  billing_mode: z.enum(BILLING_MODES),
  entries: z.array(entryInput).max(MAX_ENTRIES).optional(),
  installments: z.number().int().min(1).max(MAX_ENTRIES).optional(),
  start_now: z.boolean().optional(),
  starts_on: DATE.nullish(),
  target_end: DATE.nullish(),
  notes: z.string().trim().max(2000).nullish(),
  source_estimate_id: z.string().uuid().nullish(),
})

export type EngagementInput = z.input<typeof engagementInput>

export type EngagementWriteResult =
  | { ok: true; engagementId: string; warning?: string | null }
  | { error: string }

/** Formato da resposta de cada RPC de contrato. */
interface EngagementRpcResult {
  engagement: { id: string }
  warning?: string | null
}

function rpcFailure(error: { message?: string } | null, fallback: string): { error: string } {
  const message = engagementErrorMessage(error?.message)
  if (!message) console.error('engagement action:', error)
  return { error: message ?? fallback }
}

/** Converte uma falha lançada (como uma recusa do zod) em algo que possa ser exibido. */
function thrown(error: unknown, fallback: string): { error: string } {
  const result = failure(error, fallback)
  return 'error' in result ? result : { error: fallback }
}

function revalidateEngagement(engagementId: string) {
  revalidatePath('/engagements')
  revalidatePath(`/engagements/${engagementId}`)
}

export async function createEngagementAction(
  businessId: string,
  input: EngagementInput,
  requestId: string,
): Promise<EngagementWriteResult> {
  try {
    const data = engagementInput.parse(input)
    const supabase = await createClient()

    const { data: result, error } = await supabase.rpc('create_engagement_with_schedule', {
      p_request_id: z.string().uuid().parse(requestId),
      p_business_id: z.string().uuid().parse(businessId),
      p_client_id: data.client_id,
      p_name: data.name,
      p_total: data.total,
      p_currency: data.currency ?? '',
      p_billing_mode: data.billing_mode,
      p_entries: (data.entries ?? []) as never,
      p_installments: data.installments,
      p_status: data.start_now ? 'active' : 'draft',
      p_starts_on: data.starts_on ?? undefined,
      p_target_end: data.target_end ?? undefined,
      p_notes: data.notes ?? undefined,
      p_source_estimate_id: data.source_estimate_id ?? undefined,
    })

    if (error || !result) return rpcFailure(error, 'Não foi possível criar esse contrato.')

    const created = result as unknown as EngagementRpcResult
    revalidateEngagement(created.engagement.id)
    return { ok: true, engagementId: created.engagement.id }
  } catch (error) {
    return thrown(error, 'Não foi possível criar esse contrato.')
  }
}

/**
 * Iniciar, pausar, concluir ou cancelar. É permitido concluir um contrato
 * com valores ainda não faturados; a ação retorna o aviso do banco para que a
 * página informe quanto falta, em vez de encerrá-lo sem aviso.
 */
export async function setEngagementStatusAction(
  engagementId: string,
  status: 'draft' | 'active' | 'paused' | 'completed' | 'cancelled',
  requestId: string,
): Promise<EngagementWriteResult> {
  try {
    const supabase = await createClient()

    const { data: result, error } = await supabase.rpc('set_engagement_status', {
      p_request_id: z.string().uuid().parse(requestId),
      p_engagement_id: z.string().uuid().parse(engagementId),
      p_status: status,
    })

    if (error || !result) return rpcFailure(error, 'Não foi possível alterar esse contrato.')

    revalidateEngagement(engagementId)
    return {
      ok: true,
      engagementId,
      warning: (result as unknown as EngagementRpcResult).warning ?? null,
    }
  } catch (error) {
    return thrown(error, 'Não foi possível alterar esse contrato.')
  }
}

export async function markEntryCompleteAction(
  entryId: string,
  requestId: string,
): Promise<EngagementWriteResult> {
  try {
    const supabase = await createClient()

    const { data: result, error } = await supabase.rpc('mark_entry_complete', {
      p_request_id: z.string().uuid().parse(requestId),
      p_entry_id: z.string().uuid().parse(entryId),
    })

    if (error || !result) return rpcFailure(error, 'Não foi possível marcar esse lançamento como concluído.')

    const done = result as unknown as EngagementRpcResult
    revalidateEngagement(done.engagement.id)
    return { ok: true, engagementId: done.engagement.id }
  } catch (error) {
    return thrown(error, 'Não foi possível marcar esse lançamento como concluído.')
  }
}

export async function waiveEntryAction(
  entryId: string,
  reason: string,
  requestId: string,
): Promise<EngagementWriteResult> {
  try {
    const supabase = await createClient()

    const { data: result, error } = await supabase.rpc('waive_entry', {
      p_request_id: z.string().uuid().parse(requestId),
      p_entry_id: z.string().uuid().parse(entryId),
      p_reason: z.string().trim().min(1).max(2000).parse(reason),
    })

    if (error || !result) return rpcFailure(error, 'Não foi possível dispensar esse lançamento.')

    const done = result as unknown as EngagementRpcResult
    revalidateEngagement(done.engagement.id)
    return { ok: true, engagementId: done.engagement.id }
  } catch (error) {
    return thrown(error, 'Não foi possível dispensar esse lançamento.')
  }
}

const conversionInput = z.object({
  billing_mode: z.enum(BILLING_MODES),
  entries: z.array(entryInput).max(MAX_ENTRIES).optional(),
  installments: z.number().int().min(1).max(MAX_ENTRIES).optional(),
})

export type EngagementConversionInput = z.input<typeof conversionInput>

/**
 * Converte um orçamento aceito no contrato que ele descrevia.
 *
 * O cliente, o total e a moeda são obtidos do orçamento dentro da RPC e, de
 * propósito, não são parâmetros desta action: a conversão nunca deve permitir
 * que um preço mude sem aviso. Ela envia somente o FORMATO da agenda.
 *
 * O novo contrato começa como rascunho. Aceitar um orçamento não é o mesmo
 * que iniciar o trabalho; é iniciar o contrato que torna a entrada faturável.
 * Por isso, essa etapa exige um clique separado e intencional.
 */
export async function convertEstimateToEngagementAction(
  estimateId: string,
  input: EngagementConversionInput,
  requestId: string,
): Promise<EngagementWriteResult> {
  try {
    const data = conversionInput.parse(input)
    const supabase = await createClient()

    const { data: result, error } = await supabase.rpc('convert_estimate_to_engagement', {
      p_request_id: z.string().uuid().parse(requestId),
      p_estimate_id: z.string().uuid().parse(estimateId),
      p_billing_mode: data.billing_mode,
      p_entries: (data.entries ?? []) as never,
      p_installments: data.installments,
    })

    if (error || !result) return rpcFailure(error, 'Não foi possível converter esse orçamento em contrato.')

    const created = result as unknown as EngagementRpcResult
    revalidateEngagement(created.engagement.id)
    revalidatePath('/estimates')
    revalidatePath(`/estimates/${estimateId}`)
    return { ok: true, engagementId: created.engagement.id }
  } catch (error) {
    return thrown(error, 'Não foi possível converter esse orçamento em contrato.')
  }
}
