import { z } from 'zod'

export const clientSchema = z.object({
  name: z.string().min(1, 'O nome do cliente é obrigatório'),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
  phone: z.string().optional(),
  website: z.string().url('URL inválida').optional().or(z.literal('')),
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postal_code: z.string().optional(),
  country: z.string().optional(),
  tax_id: z.string().optional(),
  currency: z.string().default('USD'),
  payment_terms: z.number().int().min(0).default(30),
  notes: z.string().optional(),
})

export type ClientFormData = z.infer<typeof clientSchema>

