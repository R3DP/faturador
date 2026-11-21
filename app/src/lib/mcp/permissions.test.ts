import { describe, it, expect } from 'vitest'
import { canUseTool, KEY_PROFILES, toolPermission } from './permissions'
import { TOOL_NAMES } from './tool-catalog'
describe('permissões do agente', () => {
  it('classifica explicitamente todas as ferramentas expostas', () => {
    for (const name of TOOL_NAMES)
      expect(toolPermission(name), name).not.toBeNull()
  })
  it('bloqueia ferramentas desconhecidas mesmo com permissões completas', () =>
    expect(canUseTool('transfer_money', KEY_PROFILES.full)).toBe(false))
  it('impede que chaves padrão enviem, excluam ou registrem pagamentos', () => {
    for (const name of [
      'send_invoice',
      'send_estimate',
      'delete_expense',
      'record_payment',
      'update_payment',
      'void_payment',
    ])
      expect(canUseTool(name, KEY_PROFILES.draft)).toBe(false)
  })
  it('exige para corrigir ou anular um pagamento a mesma permissão usada para registrá-lo', () => {
    for (const name of ['record_payment', 'update_payment', 'void_payment']) {
      expect(toolPermission(name), name).toBe('payments')
      expect(canUseTool(name, KEY_PROFILES.billing), name).toBe(true)
    }
  })
  it('permite o acompanhamento com uma chave de rascunho e o bloqueia com uma chave somente de leitura', () => {
    expect(canUseTool('heartbeat_task', KEY_PROFILES.draft)).toBe(true)
    expect(canUseTool('heartbeat_task', KEY_PROFILES.readonly)).toBe(false)
  })
})
