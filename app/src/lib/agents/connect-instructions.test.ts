import { describe, it, expect } from 'vitest'
import {
  connectClients,
  CONSENT_SUMMARY,
  FIRST_PROMPT,
  type ConnectStep,
} from './connect-instructions'

const URL = 'https://mcp.example.test/api/mcp'
const clients = connectClients(URL)

function allSteps(): ConnectStep[] {
  return clients.flatMap((c) => [...c.steps, ...(c.fallback?.steps ?? [])])
}

function everyString(): string[] {
  const out: string[] = [CONSENT_SUMMARY, FIRST_PROMPT]
  for (const client of clients) {
    out.push(client.name, client.title, client.requirements, client.verify)
    if (client.source) out.push(client.source)
    if (client.fallback) out.push(client.fallback.summary, client.fallback.detail)
  }
  for (const step of allSteps()) {
    out.push(step.title)
    if (step.detail) out.push(step.detail)
    if (step.code) out.push(step.code.label, step.code.text)
  }
  return out
}

describe('instruções de conexão', () => {
  it('inclui todos os clientes anunciados no painel Connect', () => {
    expect(clients.map((c) => c.id)).toEqual([
      'claude',
      'claude-code',
      'codex',
      'cursor',
      'chatgpt',
      'other',
    ])
  })

  it('usa faturador como alias local nos exemplos e mantém os rótulos traduzidos', () => {
    const clientCode = (id: string) => {
      const client = clients.find((entry) => entry.id === id)
      expect(client, id).toBeDefined()
      return [...client!.steps, ...(client!.fallback?.steps ?? [])]
        .map((step) => step.code?.text ?? '')
        .join('\n')
    }

    expect(clientCode('claude-code')).toContain('claude mcp add --transport http faturador ')
    expect(clientCode('claude-code')).not.toMatch(/\bbillr\b/i)
    expect(clientCode('codex')).toContain('codex mcp add faturador --url ')
    expect(clientCode('codex')).toContain('codex mcp login faturador')
    expect(clientCode('codex')).toContain('[mcp_servers.faturador]')
    expect(clientCode('codex')).toContain('BILLR_API_KEY')
    expect(clientCode('cursor')).toContain('"faturador": {')
    expect(clientCode('cursor')).toContain('BILLR_API_KEY')
    expect(everyString().join('\n')).not.toContain('Agents → API Keys')
    expect(everyString().join('\n')).not.toMatch(/\bbillr\b/i)
    expect(CONSENT_SUMMARY).toContain('Agentes → Chaves de API')
  })

  it('fornece de três a seis etapas numeradas e uma instrução de verificação para cada cliente', () => {
    for (const client of clients) {
      expect(client.steps.length, client.id).toBeGreaterThanOrEqual(3)
      expect(client.steps.length, client.id).toBeLessThanOrEqual(6)
      expect(client.requirements.trim(), client.id).not.toBe('')
      expect(client.verify, client.id).toContain(FIRST_PROMPT)
      for (const step of client.steps) {
        expect(step.title.trim(), `${client.id}: título da etapa`).not.toBe('')
      }
    }
  })

  it('mostra a URL MCP para cada cliente e nunca uma URL de servidor diferente', () => {
    for (const client of clients) {
      const blocks = [...client.steps, ...(client.fallback?.steps ?? [])]
        .map((s) => s.code?.text)
        .filter((text): text is string => !!text)
      expect(blocks.length, client.id).toBeGreaterThan(0)
      expect(blocks.some((text) => text.includes(URL)), client.id).toBe(true)
      for (const text of blocks) {
        for (const found of text.match(/https?:\/\/[^\s"']+/g) ?? []) {
          expect(found, client.id).toBe(URL)
        }
      }
    }
  })

  it('oferece a alternativa de chave de API somente quando o cliente não consegue autenticar', () => {
    const withFallback = clients.filter((c) => c.fallback).map((c) => c.id)
    expect(withFallback).toEqual(['claude-code', 'codex', 'cursor', 'other'])
    for (const client of clients) {
      if (!client.fallback) continue
      expect(client.fallback.summary, client.id).toBe('Use uma chave de API')
      expect(client.fallback.steps.length, client.id).toBeGreaterThan(0)
    }
  })

  it('identifica todos os blocos copiáveis', () => {
    for (const step of allSteps()) {
      if (!step.code) continue
      expect(step.code.label.trim()).not.toBe('')
      expect(step.code.text.trim()).not.toBe('')
    }
  })

  it('registra a página do fornecedor consultada para cada conjunto de etapas', () => {
    for (const client of clients) {
      if (client.id === 'other') continue
      expect(client.source, client.id).toMatch(/^https:\/\//)
      expect(client.verifiedOn, client.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('não usa travessão nem meia-risca em nenhum texto', () => {
    for (const value of everyString()) {
      expect(value).not.toMatch(/[\u2013\u2014]/)
    }
  })
})
