import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '@/lib/mcp/fake-supabase'
import { BUSINESS_ID } from './action-fixture'

/**
 * Gravações das configurações: perfil, padrões de fatura e identidade visual;
 * cada operação altera somente as colunas que declara.
 */

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import {
  updateBrandingAction,
  updateBusinessProfileAction,
  updateInvoiceDefaultsAction,
} from './business'

const profile = { name: 'Fieldstone Digital', email: '', website: '' }
const defaults = {
  default_currency: 'usd',
  default_payment_terms: 30,
  invoice_prefix: 'INV',
  estimate_prefix: 'EST',
  invoice_notes: '',
  invoice_footer: '',
}

let db: FakeSupabase

function setup() {
  db = createFakeSupabase({
    'businesses.update': { data: [{ id: BUSINESS_ID }], error: null },
  })
  createClientMock.mockResolvedValue(db)
}

beforeEach(() => {
  vi.unstubAllEnvs()
  createClientMock.mockReset()
  setup()
})

describe('gravações das configurações da empresa', () => {
  it('salva apenas as colunas indicadas', async () => {
    expect(await updateBusinessProfileAction(BUSINESS_ID, profile)).toEqual({ ok: true })
    expect(await updateInvoiceDefaultsAction(BUSINESS_ID, defaults)).toEqual({ ok: true })
    expect(await updateBrandingAction(BUSINESS_ID, { primary_color: '#2563eb' })).toEqual({
      ok: true,
    })

    const updates = db.calls.filter((call) => call.op === 'update')
    expect(updates).toHaveLength(3)
    // Campos opcionais vazios viram NULL, e a moeda é normalizada.
    expect(updates[0].payload).toMatchObject({ email: null, website: null })
    expect(updates[1].payload).toMatchObject({ default_currency: 'USD' })
    expect(updates[2].payload).toEqual({ primary_color: '#2563eb' })
  })

  it('informa a recusa em vez de aparentar sucesso quando o RLS retorna zero linhas', async () => {
    db = createFakeSupabase({
      'businesses.update': { data: [], error: null },
    })
    createClientMock.mockResolvedValue(db)

    expect(await updateBusinessProfileAction(BUSINESS_ID, profile)).toEqual({
      error: 'Você não pode alterar essa empresa.',
    })
  })

  it('recusa uma chamada de identidade visual sem alterações', async () => {
    expect(await updateBrandingAction(BUSINESS_ID, {})).toEqual({ error: 'Nada para atualizar.' })
  })
})

/**
 * O esquema anterior era z.string().url(), que no zod 4 aceita
 * javascript:, data:, file:, vbscript: e qualquer host externo. O valor é
 * exibido como <img src> nas páginas públicas dos documentos e buscado no
 * servidor pela rota pública de PDF, sem autenticação; por isso, fica restrito
 * ao armazenamento desta instalação.
 */
describe('logo_url da identidade visual', () => {
  const STORAGE = 'https://example-install.supabase.co'
  const uploaded = `${STORAGE}/storage/v1/object/public/logos/${BUSINESS_ID}/logo-1.png`

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', STORAGE)
  })

  it('aceita um arquivo enviado para a origem de armazenamento desta instalação', async () => {
    expect(await updateBrandingAction(BUSINESS_ID, { logo_url: uploaded })).toEqual({ ok: true })
    const update = db.calls.find((call) => call.op === 'update')
    expect(update?.payload).toEqual({ logo_url: uploaded })
  })

  it.each([
    'javascript:alert(1)',
    'data:image/png;base64,iVBORw0KGgo=',
    'file:///etc/passwd',
    'https://evil.example/logo.png',
    `${STORAGE}/rest/v1/businesses?select=*`,
  ])('refuses %s and writes nothing', async (logo_url) => {
    const result = await updateBrandingAction(BUSINESS_ID, { logo_url })

    expect(result).not.toEqual({ ok: true })
    expect(db.calls.some((call) => call.op === 'update')).toBe(false)
  })

  it('limpa o logotipo para NULL em vez de armazenar uma string vazia', async () => {
    expect(await updateBrandingAction(BUSINESS_ID, { logo_url: '' })).toEqual({ ok: true })
    const update = db.calls.find((call) => call.op === 'update')
    expect(update?.payload).toEqual({ logo_url: null })
  })
})
