import { z } from 'zod'

const lineItemSchema = z.object({
  id: z.string(),
  description: z.string().min(1, 'A descrição é obrigatória').max(2000),
  quantity: z.number().min(0.000001, 'A quantidade deve ser maior que 0').max(99999999).multipleOf(0.000001),
  rate: z.number().min(0, 'O valor unitário deve ser igual ou maior que 0').max(99999999).multipleOf(0.000001),
  amount: z.number(),
  tax_rate: z.number().min(0).max(100).default(0),
  tax_amount: z.number().default(0),
  discount_percent: z.number().min(0).max(100).default(0),
  discount_amount: z.number().default(0),
})

export const invoiceSchema = z.object({
  client_id: z.string().min(1, 'O cliente é obrigatório'),
  invoice_number: z
    .string()
    .min(1, 'O número da fatura é obrigatório')
    .regex(
      /^[A-Za-z0-9\-_/ ]{1,40}$/,
      'O número da fatura pode conter apenas letras, números, espaços e - _ / (máximo de 40 caracteres)'
    ),
  issue_date: z.string(),
  due_date: z.string(),
  po_number: z.string().optional(),
  currency: z.string().default('USD'),
  
  line_items: z.array(lineItemSchema).min(1, 'É necessário informar pelo menos um item na fatura'),
  
  subtotal: z.number(),
  discount_type: z.enum(['percentage', 'fixed']).default('percentage'),
  discount_value: z.number().min(0).default(0),
  discount_amount: z.number().default(0),
  tax_rate: z.number().min(0).max(100).default(0),
  tax_amount: z.number().default(0),
  shipping_amount: z.number().min(0).default(0),
  total: z.number(),
  
  notes: z.string().optional(),
  terms: z.string().optional(),
  footer: z.string().optional(),
  payment_instructions: z.string().optional(),
  
  is_recurring: z.boolean().default(false),
  recurring_interval: z.enum(['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']).optional(),
  recurring_end_date: z.string().optional(),
})

export type LineItemFormData = z.infer<typeof lineItemSchema>
export type InvoiceFormData = z.infer<typeof invoiceSchema>

