'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { ClientFormData } from '@/lib/validations/client'

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Gravações de clientes.
 *
 * Uma server action é um endpoint POST público; portanto, `data` pode conter qualquer valor
 * enviado por quem chama, não apenas os dados produzidos pelo formulário. Antes, estas três
 * ações espalhavam o argumento recebido no insert e no update, depois de `business_id`. Com
 * isso, um `business_id` fornecido pelo chamador prevalecia, e também era possível gravar `id`,
 * `created_at`, `created_via` e `created_by_key_id`, sem limite de tamanho (auditoria da
 * aplicação, Medium-3).
 *
 * Agora há duas regras, iguais às usadas nos demais arquivos de actions
 * (`business.ts`, `invoices.ts`, `payments.ts`, ...):
 *
 *   1. analisar com um esquema do servidor que use `.strict()`, recusando chaves desconhecidas
 *      em vez de incluí-las na gravação;
 *   2. indicar uma a uma as colunas gravadas. Nada é espalhado. Assim, adicionar
 *      uma nova coluna em `clients` não se torna gravável pelo navegador em silêncio.
 *
 * `clientSchema` em src/lib/validations/client.ts permanece igual: ele controla
 * as mensagens junto aos campos do formulário e não tem limites `.max()`, pois
 * um campo de texto não precisa deles. Este esquema decide o que será armazenado.
 */
const clientInput = z
  .object({
    name: z.string().trim().min(1, 'O nome do cliente é obrigatório').max(200),
    email: z.union([z.literal(''), z.string().trim().email().max(320)]).optional(),
    phone: z.string().trim().max(50).optional(),
    // A página de detalhes do cliente exibe isso como <a href>; por isso, o esquema
    // é verificado aqui, em vez de usar url() do zod, que aceita javascript:.
    website: z
      .union([
        z.literal(''),
        z
          .string()
          .trim()
          .max(500)
          .refine(isHttpUrl, 'O site deve usar um endereço http:// ou https://'),
      ])
      .optional(),
    address_line1: z.string().trim().max(200).optional(),
    address_line2: z.string().trim().max(200).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    postal_code: z.string().trim().max(30).optional(),
    country: z.string().trim().max(100).optional(),
    tax_id: z.string().trim().max(100).optional(),
    currency: z.string().trim().regex(/^[A-Za-z]{3}$/).default('USD'),
    payment_terms: z.number().int().min(0).max(365).default(30),
    notes: z.string().max(5000).optional(),
  })
  .strict()

type ClientInput = z.infer<typeof clientInput>

/**
 * Lista exata de colunas que uma chamada do navegador pode gravar, montada
 * manualmente a partir do valor analisado. Campos opcionais vazios viram NULL
 * para representar valores não definidos, em vez de armazenar uma string vazia,
 * como em updateBusinessProfileAction.
 */
function clientColumns(data: ClientInput) {
  const orNull = (value: string | undefined) => (value ? value : null)
  return {
    name: data.name,
    email: orNull(data.email),
    phone: orNull(data.phone),
    website: orNull(data.website),
    address_line1: orNull(data.address_line1),
    address_line2: orNull(data.address_line2),
    city: orNull(data.city),
    state: orNull(data.state),
    postal_code: orNull(data.postal_code),
    country: orNull(data.country),
    tax_id: orNull(data.tax_id),
    currency: data.currency.toUpperCase(),
    payment_terms: data.payment_terms,
    notes: orNull(data.notes),
  }
}

export async function createClientAction(businessId: string, data: ClientFormData) {
  const business = z.string().uuid().parse(businessId)
  const parsed = clientInput.parse(data)
  const supabase = await createClient()

  const { data: client, error } = await supabase
    .from('clients')
    // business_id vem do argumento e é gravado por último, para que nenhum campo
    // analisado possa substituí-lo. O RLS também o verifica; assim, a action fica alinhada.
    .insert({ ...clientColumns(parsed), business_id: business })
    .select()
    .single()

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/clients')
  return client
}

export async function updateClientAction(clientId: string, data: ClientFormData) {
  const id = z.string().uuid().parse(clientId)
  const parsed = clientInput.parse(data)
  const supabase = await createClient()

  const { data: client, error } = await supabase
    .from('clients')
    // business_id foi omitido de propósito: uma edição nunca transfere um cliente
    // entre empresas, nem mesmo entre duas às quais a pessoa tenha acesso.
    .update(clientColumns(parsed))
    .eq('id', id)
    .select()
    .single()

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/clients')
  revalidatePath(`/clients/${id}`)
  return client
}

export async function deleteClientAction(clientId: string) {
  const id = z.string().uuid().parse(clientId)
  const supabase = await createClient()

  const { error } = await supabase
    .from('clients')
    .update({ is_active: false })
    .eq('id', id)

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/clients')
}
