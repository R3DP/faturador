'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'
import { failure, type WriteResult } from './result'
import {
  LOGO_URL_MESSAGE,
  MAX_LOGO_URL_LENGTH,
  isAllowedLogoUrl,
} from '@/lib/branding/logo-url'

/**
 * Gravações das configurações da empresa: perfil, padrões de fatura e identidade visual.
 *
 * São três actions específicas, e não uma action genérica de atualização: um
 * `update(businesses, patch)` exposto por uma server action daria ao navegador
 * controle para escolher colunas. Cada action declara as colunas que pode gravar.
 */

const profileInput = z.object({
  name: z.string().trim().min(1).max(200),
  legal_name: z.string().trim().max(200).nullish(),
  email: z.string().trim().max(320).nullish(),
  phone: z.string().trim().max(50).nullish(),
  website: z.string().trim().max(500).nullish(),
  address_line1: z.string().trim().max(200).nullish(),
  address_line2: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(100).nullish(),
  state: z.string().trim().max(100).nullish(),
  postal_code: z.string().trim().max(30).nullish(),
  country: z.string().trim().max(100).optional(),
  tax_id: z.string().trim().max(100).nullish(),
})

const invoiceDefaultsInput = z.object({
  default_currency: z.string().trim().regex(/^[A-Za-z]{3}$/),
  default_payment_terms: z.number().int().min(0).max(365),
  invoice_prefix: z.string().trim().min(1).max(20),
  estimate_prefix: z.string().trim().min(1).max(20),
  invoice_notes: z.string().max(5000).nullish(),
  invoice_footer: z.string().max(5000).nullish(),
})

// logo_url NÃO usa `z.string().url()`. No zod 4, essa validação aceita javascript:,
// data:, file: e vbscript:, e o valor depois é buscado no servidor pela
// rota pública de PDF sem autenticação. O valor deve ser um objeto no
// armazenamento Supabase desta instalação ou vazio para remover o logotipo. Consulte
// src/lib/branding/logo-url.ts.
const brandingInput = z.object({
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  logo_url: z
    .string()
    .max(MAX_LOGO_URL_LENGTH)
    .refine((value) => value === '' || isAllowedLogoUrl(value), LOGO_URL_MESSAGE)
    .optional(),
})

export type BusinessProfileInput = z.input<typeof profileInput>
export type InvoiceDefaultsInput = z.input<typeof invoiceDefaultsInput>
export type BrandingInput = z.input<typeof brandingInput>

async function patchBusiness(
  businessId: string,
  patch: Database['public']['Tables']['businesses']['Update'],
): Promise<WriteResult> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('businesses')
    .update(patch)
    .eq('id', z.string().uuid().parse(businessId))
    .select('id')

  if (error) return { error: error.message }
  // O RLS responde a uma atualização na empresa de outra pessoa com zero linhas,
  // não com um erro; por isso, um resultado vazio significa recusa, não sucesso.
  if (!data?.length) return { error: 'Você não pode alterar essa empresa.' }

  revalidatePath('/settings')
  return { ok: true }
}

export async function updateBusinessProfileAction(
  businessId: string,
  input: BusinessProfileInput,
): Promise<WriteResult> {
  try {
    const data = profileInput.parse(input)
    return await patchBusiness(businessId, {
      ...data,
      email: data.email || null,
      website: data.website || null,
    })
  } catch (error) {
    return failure(error, 'Não foi possível salvar essas configurações.')
  }
}

export async function updateInvoiceDefaultsAction(
  businessId: string,
  input: InvoiceDefaultsInput,
): Promise<WriteResult> {
  try {
    const data = invoiceDefaultsInput.parse(input)
    return await patchBusiness(businessId, {
      ...data,
      default_currency: data.default_currency.toUpperCase(),
      invoice_notes: data.invoice_notes || null,
      invoice_footer: data.invoice_footer || null,
    })
  } catch (error) {
    return failure(error, 'Não foi possível salvar essas configurações.')
  }
}

export async function updateBrandingAction(
  businessId: string,
  input: BrandingInput,
): Promise<WriteResult> {
  try {
    const data = brandingInput.parse(input)
    if (data.primary_color === undefined && data.logo_url === undefined) {
      return { error: 'Nada para atualizar.' }
    }
    // Um logotipo vazio limpa a coluna em vez de armazenar '', para que todos
    // os leitores vejam o mesmo valor "sem logotipo" definido como padrão pelo esquema.
    return await patchBusiness(businessId, {
      ...data,
      ...(data.logo_url === '' ? { logo_url: null } : {}),
    })
  } catch (error) {
    return failure(error, 'Não foi possível salvar a identidade visual.')
  }
}
