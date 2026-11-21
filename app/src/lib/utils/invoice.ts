import { nanoid } from 'nanoid'
import type { LineItemFormData } from '@/lib/validations/invoice'

export function generatePublicId(): string {
  return nanoid(10) // ID curto e seguro para URL
}

const roundMoney=(n:number)=>Math.round((n+Number.EPSILON)*100)/100

export function calculateLineItemAmount(item: LineItemFormData): LineItemFormData {
  const baseAmount = item.quantity * item.rate
  const discountAmount = (baseAmount * item.discount_percent) / 100
  const afterDiscount = baseAmount - discountAmount

  // Observação: o editor não tem campos de imposto por item, então o imposto
  // por item é intencionalmente mantido em 0. O imposto é aplicado à fatura
  // inteira em calculateInvoiceTotals para manter valores e totais consistentes.
  return {
    ...item,
    discount_amount: roundMoney(discountAmount),
    tax_amount: 0,
    amount: roundMoney(afterDiscount),
  }
}

export function calculateInvoiceTotals(
  lineItems: LineItemFormData[],
  discountType: 'percentage' | 'fixed',
  discountValue: number,
  taxRate: number,
  shippingAmount: number
) {
  // Calcula o subtotal dos itens da linha
  const subtotal = roundMoney(lineItems.reduce((sum, item) => sum + calculateLineItemAmount(item).amount, 0))
  
  // Calcula o desconto (descontos fixos são limitados para evitar totais negativos)
  const discountAmount = discountType === 'percentage'
    ? roundMoney((subtotal * discountValue) / 100)
    : roundMoney(Math.min(discountValue, subtotal))

  const afterDiscount = subtotal - discountAmount
  
  // Calcula o imposto sobre o valor com desconto
  const taxAmount = roundMoney((afterDiscount * taxRate) / 100)
  
  // Calcula o total
  const total = roundMoney(afterDiscount + taxAmount + shippingAmount)

  return {
    subtotal,
    discount_amount: roundMoney(discountAmount),
    tax_amount: taxAmount,
    total,
  }
}

export function createEmptyLineItem(): LineItemFormData {
  return {
    id: nanoid(),
    description: '',
    quantity: 1,
    rate: 0,
    amount: 0,
    tax_rate: 0,
    tax_amount: 0,
    discount_percent: 0,
    discount_amount: 0,
  }
}

export function formatInvoiceNumber(prefix: string, number: number): string {
  return `${prefix}-${number.toString().padStart(4, '0')}`
}

