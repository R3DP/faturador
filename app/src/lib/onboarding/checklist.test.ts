import { describe, it, expect } from 'vitest'
import { deriveChecklist, checklistProgress, type ChecklistFacts } from '@/lib/onboarding/checklist'

const empty: ChecklistFacts = {
  businessName: null, businessEmail: null, businessPhone: null, businessAddress1: null,
  logoUrl: null, primaryColor: '#2563eb', stripeConfigured: false,
  clientCount: 0, invoiceCount: 0, sentInvoiceCount: 0, apiKeyCount: 0, usedApiKeyCount: 0,
}
const byId = (facts: ChecklistFacts) =>
  Object.fromEntries(deriveChecklist(facts).map((s) => [s.id, s]))

describe('geração da lista de configuração', () => {
  it('não marca nenhuma etapa como concluída para uma empresa recém-criada', () => {
    expect(deriveChecklist(empty).every((s) => !s.done)).toBe(true)
  })
  it('a empresa precisa de um nome e pelo menos um campo de contato', () => {
    expect(byId({ ...empty, businessName: 'Acme' }).business.done).toBe(false)
    expect(byId({ ...empty, businessName: 'Acme', businessPhone: '555' }).business.done).toBe(true)
  })
  it('a identidade visual é concluída com um logotipo ou uma cor não padrão', () => {
    expect(byId({ ...empty, logoUrl: 'https://x/logo.png' }).branding.done).toBe(true)
    expect(byId({ ...empty, primaryColor: '#ff0000' }).branding.done).toBe(true)
    expect(byId({ ...empty, primaryColor: '#2563eb' }).branding.done).toBe(false)
  })
  it('a etapa do agente exige uma chave JÁ USADA e dá uma dica quando há uma chave sem uso', () => {
    const created = byId({ ...empty, apiKeyCount: 1, usedApiKeyCount: 0 }).agent
    expect(created.done).toBe(false)
    expect(created.hint).toBeTruthy()
    expect(byId({ ...empty, apiKeyCount: 1, usedApiKeyCount: 1 }).agent.done).toBe(true)
  })
  it('solicita as chaves do Stripe e é concluída quando os pagamentos com cartão estão configurados', () => {
    expect(byId(empty).stripe).toMatchObject({
      label: 'Adicione suas chaves do Stripe',
      href: '/agents?tab=payments',
      done: false,
    })
    expect(byId({ ...empty, stripeConfigured: true }).stripe.done).toBe(true)
  })
  it('as contagens determinam as etapas de cliente, fatura e envio', () => {
    const facts = { ...empty, clientCount: 1, invoiceCount: 2, sentInvoiceCount: 1 }
    const s = byId(facts)
    expect([s.client.done, s.invoice.done, s.send.done]).toEqual([true, true, true])
  })
})

describe('progresso da lista de configuração', () => {
  it('informa as etapas concluídas, o total e o percentual', () => {
    const steps = deriveChecklist({ ...empty, clientCount: 1 })
    expect(checklistProgress(steps)).toEqual({ done: 1, total: 7, percent: 14 })
  })
})
