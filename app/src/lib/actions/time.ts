'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { secondsFromHours, timeAmount } from '@/lib/work/time'
import { failure, type WriteResult } from './result'

/**
 * O registro de horas é feito por server actions que validam os dados antes
 * de qualquer gravação.
 *
 * Cada chamada usa o próprio cliente Supabase de quem a iniciou, então o RLS
 * determina a associação à empresa.
 */

const entryInput = z.object({
  client_id: z.string().uuid().nullish(),
  description: z.string().trim().min(1).max(2000),
  hours: z.number().finite().positive().max(24),
  rate: z.number().finite().min(0).max(999999).nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  is_billable: z.boolean(),
  project_name: z.string().trim().max(200).nullish(),
})

export type TimeEntryInput = z.input<typeof entryInput>

/**
 * A moeda de um lançamento de trabalho nunca vem do navegador: ela acompanha
 * o cliente faturado e, na ausência dele, usa o padrão da empresa.
 */
async function resolveCurrency(
  supabase: Awaited<ReturnType<typeof createClient>>,
  businessId: string,
  clientId: string | null,
): Promise<string> {
  if (clientId) {
    const { data } = await supabase
      .from('clients')
      .select('currency')
      .eq('id', clientId)
      .maybeSingle()
    if (data?.currency) return data.currency
  }
  const { data } = await supabase
    .from('businesses')
    .select('default_currency')
    .eq('id', businessId)
    .maybeSingle()
  return data?.default_currency || 'USD'
}

export async function createTimeEntryAction(
  businessId: string,
  input: TimeEntryInput,
  requestId: string,
): Promise<WriteResult> {
  try {
    const data = entryInput.parse(input)
    const supabase = await createClient()
    const seconds = secondsFromHours(data.hours)
    const clientId = data.client_id || null

    // O request id é criado uma vez por formulário e reutilizado em cada nova
    // tentativa, para que create_work_entry_once retorne o primeiro lançamento
    // em vez de registrar o mesmo trabalho duas vezes.
    const { error } = await supabase.rpc('create_work_entry_once', {
      p_business_id: z.string().uuid().parse(businessId),
      p_kind: 'time',
      p_request_id: z.string().uuid().parse(requestId),
      p_record: {
        business_id: businessId,
        client_id: clientId,
        description: data.description,
        currency: await resolveCurrency(supabase, businessId, clientId),
        duration_seconds: seconds,
        hourly_rate: data.is_billable ? data.rate : 0,
        date: data.date,
        is_billable: data.is_billable,
        project_name: data.project_name || null,
      },
    })
    if (error) return { error: error.message }

    revalidatePath('/time')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (error) {
    return failure(error, 'Não foi possível registrar esse lançamento de horas.')
  }
}

export async function updateTimeEntryAction(
  entryId: string,
  input: TimeEntryInput,
): Promise<WriteResult> {
  try {
    const data = entryInput.parse(input)
    const supabase = await createClient()
    const seconds = secondsFromHours(data.hours)
    const clientId = data.client_id || null

    const { data: entry } = await supabase
      .from('time_entries')
      .select('business_id')
      .eq('id', entryId)
      .maybeSingle()
    if (!entry?.business_id) return { error: 'Lançamento de horas não encontrado.' }

    // Trabalho faturado não pode ser alterado: o filtro `is('invoice_id', null)`
    // é o mesmo usado pelo navegador, e a quantidade de linhas informa se ele foi aplicado.
    const { data: saved, error } = await supabase
      .from('time_entries')
      .update({
        client_id: clientId,
        description: data.description,
        currency: await resolveCurrency(supabase, entry.business_id, clientId),
        duration_seconds: seconds,
        hourly_rate: data.is_billable ? data.rate : 0,
        amount: data.is_billable ? timeAmount(seconds, data.rate) : 0,
        date: data.date,
        is_billable: data.is_billable,
        project_name: data.project_name || null,
      })
      .eq('id', entryId)
      .is('invoice_id', null)
      .select('id')

    if (error) return { error: error.message }
    if (!saved?.length) return { error: 'Trabalho faturado não pode ser editado.' }

    revalidatePath('/time')
    revalidatePath(`/time/${entryId}`)
    return { ok: true }
  } catch (error) {
    return failure(error, 'Não foi possível salvar esse lançamento de horas.')
  }
}

export async function deleteTimeEntryAction(entryId: string): Promise<WriteResult> {
  try {
    const supabase = await createClient()

    const { data: deleted, error } = await supabase
      .from('time_entries')
      .delete()
      .eq('id', entryId)
      .is('invoice_id', null)
      .select('id')

    if (error) return { error: error.message }
    if (!deleted?.length) return { error: 'Trabalho faturado não pode ser excluído.' }

    revalidatePath('/time')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (error) {
    return failure(error, 'Não foi possível excluir esse lançamento de horas.')
  }
}
