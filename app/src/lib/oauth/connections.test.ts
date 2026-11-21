import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from './fake-db'

let db: FakeDb

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => db.client }))

const { listOauthConnections, revokeOauthConnection } = await import('./connections')
const { _setOauthServiceClient } = await import('./store')

const USER = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  db = createFakeDb({
    api_keys: [
      {
        id: 'key-oauth',
        user_id: USER,
        kind: 'oauth',
        label: 'Claude',
        business_id: 'b1',
        permissions: ['read', 'write'],
        created_at: '2026-09-01T00:00:00Z',
        last_used_at: null,
        expires_at: '2026-10-01T00:00:00Z',
        revoked_at: null,
      },
      {
        id: 'key-superseded',
        user_id: USER,
        kind: 'oauth',
        label: 'Claude',
        business_id: 'b1',
        permissions: ['read', 'write'],
        created_at: '2026-08-15T00:00:00Z',
        last_used_at: null,
        expires_at: '2026-09-15T00:00:00Z',
        revoked_at: null,
      },
      {
        id: 'key-manual',
        user_id: USER,
        kind: 'manual',
        label: 'Pasted key',
        business_id: null,
        permissions: ['read'],
        created_at: '2026-08-01T00:00:00Z',
        last_used_at: null,
        expires_at: null,
        revoked_at: null,
      },
    ],
    oauth_refresh_tokens: [
      // Token atual da família que criou key-oauth.
      { id: 'rt-current', family_id: 'fam-1', api_key_id: 'key-oauth', revoked_at: null },
      // Rotação anterior da MESMA família: ainda ativa; por isso, uma revogação que considerasse apenas
      // api_key_id ainda permitiria que o cliente renovasse usando este token.
      { id: 'rt-earlier', family_id: 'fam-1', api_key_id: 'key-superseded', revoked_at: null },
      // Outra conexão; deve permanecer ativa.
      { id: 'rt-other', family_id: 'fam-2', api_key_id: 'key-other', revoked_at: null },
    ],
  })
  _setOauthServiceClient(() => db.client)
})

afterEach(() => {
  _setOauthServiceClient(null)
})

describe('conexões OAuth', () => {
  it('lista somente chaves emitidas por OAuth, com o nome do cliente que concedeu acesso', async () => {
    const connections = await listOauthConnections(USER)
    expect(connections.map((c) => c.id)).toEqual(['key-oauth', 'key-superseded'])
    expect(connections[0]).toMatchObject({
      id: 'key-oauth',
      label: 'Claude',
      clientName: 'Claude',
      permissions: ['read', 'write'],
      businessId: 'b1',
    })
  })

  it('nunca inclui oauth_clients, que não pode ser lida por quem está autenticado', async () => {
    // O schema executa REVOKE ALL ON oauth_clients FROM PUBLIC, anon,
    // authenticated. A inclusão de recursos pelo PostgREST exige SELECT na tabela incluída
    // para a função que faz a consulta, então a antiga
    // consulta `...,oauth_clients(client_name)` falhava em todas as requisições reais, e
    // o erro ignorado deixava o painel de aplicativos conectados permanentemente vazio. O
    // nome vem de api_keys.label, que o endpoint de token define como
    // o nome do cliente ao criar a chave.
    await listOauthConnections(USER)
    const asked = db.selects.filter((entry) => entry.table === 'api_keys')
    expect(asked).not.toHaveLength(0)
    for (const entry of asked) {
      expect(entry.columns).not.toContain('oauth_clients')
      expect(entry.columns).not.toMatch(/\w+\s*\(/)
    }
  })

  it('continua identificando o app quando a linha contém somente colunas de api_keys', async () => {
    db.tables.api_keys = [
      {
        id: 'key-only',
        user_id: USER,
        kind: 'oauth',
        label: 'Some MCP Client',
        business_id: 'b1',
        permissions: ['read'],
        created_at: '2026-09-01T00:00:00Z',
        last_used_at: null,
        expires_at: null,
        revoked_at: null,
      },
    ]
    const [connection] = await listOauthConnections(USER)
    expect(connection.clientName).toBe('Some MCP Client')
  })

  it('revoga uma conexão e informa corretamente uma segunda tentativa', async () => {
    expect(await revokeOauthConnection(USER, 'key-oauth')).toEqual({ success: true })
    expect(db.tables.api_keys.find((row) => row.id === 'key-oauth')?.revoked_at).toBeTruthy()

    const again = await revokeOauthConnection(USER, 'key-oauth')
    expect(again.success).toBe(false)
  })

  it('revoga toda a família de tokens de renovação, impedindo a renovação silenciosa pelo cliente', async () => {
    expect(await revokeOauthConnection(USER, 'key-oauth')).toEqual({ success: true })

    const tokens = db.tables.oauth_refresh_tokens
    const byId = (id: string) => tokens.find((row) => row.id === id)
    expect(byId('rt-current')?.revoked_at).toBeTruthy()
    expect(byId('rt-earlier')?.revoked_at).toBeTruthy()
    expect(byId('rt-other')?.revoked_at).toBeNull()

    // A revogação da família também invalida as chaves de acesso que ela criou anteriormente.
    const keys = db.tables.api_keys
    expect(keys.find((row) => row.id === 'key-superseded')?.revoked_at).toBeTruthy()
    expect(keys.find((row) => row.id === 'key-manual')?.revoked_at).toBeNull()
  })

  it('preserva os tokens de renovação de outras conexões quando a revogação não encontra nenhum da própria conexão', async () => {
    db.tables.oauth_refresh_tokens = db.tables.oauth_refresh_tokens.filter(
      (row) => row.family_id !== 'fam-1'
    )

    expect(await revokeOauthConnection(USER, 'key-oauth')).toEqual({ success: true })
    expect(db.tables.oauth_refresh_tokens[0].revoked_at).toBeNull()
  })

  it('não altera tokens de renovação quando a chave não pertence a quem solicitou a revogação', async () => {
    const result = await revokeOauthConnection('22222222-2222-2222-2222-222222222222', 'key-oauth')
    expect(result.success).toBe(false)
    expect(db.tables.oauth_refresh_tokens.every((row) => row.revoked_at === null)).toBe(true)
  })

  it('não revoga uma chave manual pelo fluxo de conexões', async () => {
    const result = await revokeOauthConnection(USER, 'key-manual')
    expect(result.success).toBe(false)
    expect(db.tables.api_keys.find((row) => row.id === 'key-manual')?.revoked_at).toBeNull()
  })
})
