type StepId = 'business' | 'branding' | 'stripe' | 'client' | 'invoice' | 'send' | 'agent'

export interface ChecklistFacts {
  businessName: string | null
  businessEmail: string | null
  businessPhone: string | null
  businessAddress1: string | null
  logoUrl: string | null
  primaryColor: string | null
  stripeConfigured: boolean
  clientCount: number
  invoiceCount: number
  sentInvoiceCount: number
  apiKeyCount: number
  usedApiKeyCount: number
}

export interface ChecklistStep {
  id: StepId
  label: string
  href: string
  done: boolean
  hint?: string
}

const DEFAULT_PRIMARY_COLOR = '#2563eb'

function isNonEmpty(value: string | null): boolean {
  return value !== null && value.trim().length > 0
}

export function deriveChecklist(facts: ChecklistFacts): ChecklistStep[] {
  const businessDone =
    isNonEmpty(facts.businessName) &&
    (isNonEmpty(facts.businessEmail) || isNonEmpty(facts.businessPhone) || isNonEmpty(facts.businessAddress1))

  const brandingDone =
    facts.logoUrl !== null ||
    (isNonEmpty(facts.primaryColor) && facts.primaryColor !== DEFAULT_PRIMARY_COLOR)

  const stripeDone = facts.stripeConfigured === true

  const clientDone = facts.clientCount > 0

  const invoiceDone = facts.invoiceCount > 0

  const sendDone = facts.sentInvoiceCount > 0

  const agentDone = facts.usedApiKeyCount > 0
  const agentHint =
    !agentDone && facts.apiKeyCount > 0 && facts.usedApiKeyCount === 0
      ? 'Chave criada. Conecte seu agente para concluir.'
      : undefined

  const steps: ChecklistStep[] = [
    { id: 'business', label: 'Adicione os dados da sua empresa', href: '/settings/business', done: businessDone },
    { id: 'branding', label: 'Adicione seu logotipo e sua cor', href: '/settings/branding', done: brandingDone },
    { id: 'stripe', label: 'Adicione suas chaves do Stripe', href: '/agents?tab=payments', done: stripeDone },
    { id: 'client', label: 'Adicione seu primeiro cliente', href: '/clients/new', done: clientDone },
    { id: 'invoice', label: 'Crie sua primeira fatura', href: '/invoices/new', done: invoiceDone },
    { id: 'send', label: 'Envie uma fatura', href: '/invoices', done: sendDone },
    { id: 'agent', label: 'Conecte seu agente', href: '/agents?tab=connect', done: agentDone, ...(agentHint ? { hint: agentHint } : {}) },
  ]

  return steps
}

export function checklistProgress(steps: ChecklistStep[]): { done: number; total: number; percent: number } {
  const total = steps.length
  const done = steps.filter((s) => s.done).length
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)
  return { done, total, percent }
}
