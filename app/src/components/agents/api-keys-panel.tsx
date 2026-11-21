'use client'

import type { KeyProfile } from '@/lib/mcp/permissions'
import { useEffect, useState } from 'react'
import { Loader2, Copy, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useBusiness } from '@/lib/hooks/use-business'
import {
  createApiKeyAction,
  revokeApiKeyAction,
  listApiKeysAction,
  listOauthConnectionsAction,
  revokeOauthConnectionAction,
} from '@/lib/actions/api-keys'

type ApiKey = Awaited<ReturnType<typeof listApiKeysAction>>[number]
type Connection = Awaited<ReturnType<typeof listOauthConnectionsAction>>[number]

const ALL_BUSINESSES_VALUE = '__all__'

function PermissionBadges({ permissions }: { permissions: readonly string[] }) {
  if (permissions.length === 0) {
    return <span className="text-xs text-muted-foreground">Sem permissões</span>
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      {permissions.map((permission) => (
        <Badge key={permission} variant="secondary" className="font-normal">
          {permission}
        </Badge>
      ))}
    </span>
  )
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : null
}

export function ApiKeysPanel() {
  const { businesses } = useBusiness()
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [checkedAt, setCheckedAt] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [permissionProfile, setPermissionProfile] = useState<KeyProfile>('draft')
  const [businessId, setBusinessId] = useState<string>(ALL_BUSINESSES_VALUE)
  const [isCreating, setIsCreating] = useState(false)

  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [revokingId, setRevokingId] = useState<string | null>(null)

  const [connections, setConnections] = useState<Connection[]>([])
  const [pendingRevoke, setPendingRevoke] = useState<Connection | null>(null)
  const [isRevokingConnection, setIsRevokingConnection] = useState(false)

  async function loadKeys() {
    const data = await listApiKeysAction()
    setKeys(data)
    setCheckedAt(Date.now())
    setIsLoading(false)
  }

  async function loadConnections() {
    setConnections(await listOauthConnectionsAction())
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Busca a lista externa de chaves ao montar este painel.
    loadKeys()
    loadConnections()
  }, [])

  function businessName(id: string | null) {
    if (!id) return 'Todas as empresas'
    return businesses.find((b) => b.id === id)?.name ?? 'Empresa desconhecida'
  }

  async function handleCreate() {
    if (!label.trim()) {
      toast.error('O nome é obrigatório')
      return
    }

    setIsCreating(true)
    const result = await createApiKeyAction(
      label.trim(),
      businessId === ALL_BUSINESSES_VALUE ? null : businessId,
      permissionProfile
    )
    setIsCreating(false)

    if ('error' in result) {
      toast.error(result.error)
      return
    }

    setIsCreateOpen(false)
    setLabel('')
    setBusinessId(ALL_BUSINESSES_VALUE)
    setNewSecret(result.secret)
    await loadKeys()
  }

  async function handleRevoke(id: string) {
    if (!confirm('Revogar esta chave de API? Qualquer integração que a utilize deixará de funcionar.')) {
      return
    }

    setRevokingId(id)
    const result = await revokeApiKeyAction(id)
    setRevokingId(null)

    if (!result.success) {
      toast.error(result.error ?? 'Não foi possível revogar a chave')
      return
    }

    toast.success('Chave de API revogada')
    await loadKeys()
  }

  async function handleRevokeConnection() {
    if (!pendingRevoke) return

    setIsRevokingConnection(true)
    const result = await revokeOauthConnectionAction(pendingRevoke.id)
    setIsRevokingConnection(false)

    if (!result.success) {
      toast.error(result.error ?? 'Não foi possível revogar esta conexão')
      return
    }

    setPendingRevoke(null)
    toast.success('Conexão revogada')
    await loadConnections()
  }

  async function handleCopy() {
    if (!newSecret) return
    try {
      await navigator.clipboard.writeText(newSecret)
      setCopied(true)
      toast.success('Copiado para a área de transferência')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Não foi possível copiar. Selecione o texto da chave e copie manualmente')
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Chaves de API</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Conecte agentes e integrações à sua conta do Faturador
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>Criar chave</Button>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Suas chaves de API</CardTitle>
            <CardDescription>
              As chaves permitem que ferramentas externas e agentes ajam em seu nome pela API do Faturador
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : keys.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center text-center">
                <p className="text-sm text-muted-foreground">
                  Você ainda não tem chaves de API. Crie uma para conectar um agente ou integração.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {keys.map((key) => {
                  const isRevoked = !!key.revoked_at || !!(key.expires_at && Date.parse(key.expires_at) <= checkedAt)
                  return (
                    <div
                      key={key.id}
                      className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{key.label}</span>
                          <PermissionBadges permissions={key.permissions} />
                          <span className="text-xs text-muted-foreground">
                            Expira em {formatDate(key.expires_at) ?? 'nunca'}
                          </span>
                          {key.key_prefix && (
                            <span className="font-mono text-xs text-muted-foreground">
                              {key.key_prefix}&hellip;
                            </span>
                          )}
                          <Badge variant={isRevoked ? 'outline' : 'default'}>
                            {isRevoked ? 'Inativa' : 'Ativa'}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {businessName(key.business_id)} &middot; Criada em{' '}
                          {new Date(key.created_at).toLocaleDateString()} &middot; Usada pela última vez{' '}
                          {key.last_used_at
                            ? new Date(key.last_used_at).toLocaleDateString()
                            : 'Nunca'}
                        </p>
                      </div>
                      {!isRevoked && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={revokingId === key.id}
                          onClick={() => handleRevoke(key.id)}
                        >
                          {revokingId === key.id && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          )}
                          Revogar
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Aplicativos conectados</CardTitle>
            <CardDescription>
              Aplicativos que você autorizou na tela de consentimento ao conectar por URL
            </CardDescription>
          </CardHeader>
          <CardContent>
            {connections.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Você ainda não tem aplicativos conectados. Use a aba Conectar para vincular Claude, Codex, Cursor ou
                ChatGPT por URL.
              </p>
            ) : (
              <div className="space-y-3">
                {connections.map((connection) => {
                  const isRevoked =
                    !!connection.revokedAt ||
                    !!(connection.expiresAt && Date.parse(connection.expiresAt) <= checkedAt)
                  return (
                    <div
                      key={connection.id}
                      className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">
                            {connection.clientName ?? connection.label}
                          </span>
                          <PermissionBadges permissions={connection.permissions} />
                          <Badge variant={isRevoked ? 'outline' : 'default'}>
                            {isRevoked ? 'Revogada' : 'Ativa'}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {businessName(connection.businessId)} &middot; Conectado em{' '}
                          {formatDate(connection.createdAt)} &middot; Usada pela última vez{' '}
                          {formatDate(connection.lastUsedAt) ?? 'Nunca'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {isRevoked
                            ? connection.revokedAt
                              ? `Revogada em ${formatDate(connection.revokedAt)}`
                              : 'Acesso expirado'
                            : connection.expiresAt
                              ? `O acesso expira em ${formatDate(connection.expiresAt)} e renova automaticamente`
                              : 'Renova automaticamente'}
                        </p>
                      </div>
                      {!isRevoked && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPendingRevoke(connection)}
                        >
                          Revogar
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Confirmar revogação de um aplicativo conectado */}
      <Dialog
        open={!!pendingRevoke}
        onOpenChange={(open) => !open && !isRevokingConnection && setPendingRevoke(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Revogar {pendingRevoke?.clientName ?? pendingRevoke?.label ?? 'este aplicativo'}?
            </DialogTitle>
            <DialogDescription>
              O aplicativo perderá imediatamente o acesso a {businessName(pendingRevoke?.businessId ?? null)} e
              não poderá renová-lo. Se mudar de ideia, conecte-o novamente pela aba Conectar.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingRevoke(null)}
              disabled={isRevokingConnection}
            >
              Cancelar
            </Button>
            <Button onClick={handleRevokeConnection} disabled={isRevokingConnection}>
              {isRevokingConnection && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Revogar acesso
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo de criação de chave */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criar chave de API</DialogTitle>
            <DialogDescription>
              Dê um nome à chave para reconhecê-la depois.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="key-label">Nome</Label>
              <Input
                id="key-label"
                placeholder="ex.: Meu agente"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="key-business">Empresa</Label>
              <Select value={businessId} onValueChange={setBusinessId}>
                <SelectTrigger id="key-business" className="w-full">
                  <SelectValue placeholder="Todas as empresas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_BUSINESSES_VALUE}>Todas as empresas</SelectItem>
                  {businesses.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2 mb-4"><Label htmlFor="key-permissions">Permissões do agente</Label><select id="key-permissions" className="w-full rounded border p-2 bg-background" value={permissionProfile} onChange={e=>setPermissionProfile(e.target.value as KeyProfile)}><option value="draft">Leitura e rascunho (recomendado)</option><option value="readonly">Somente leitura</option><option value="billing">Faturamento: criar rascunhos, enviar e registrar pagamentos</option><option value="full">Completa: faturamento e exclusão de trabalho não faturado</option></select><p className="text-xs text-muted-foreground">Expira em 90 dias. A definição de preços de tarefas e a aprovação de cobranças sempre exigem uma pessoa.</p></div>
            <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={isCreating}>
              {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar chave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo de chave exibida uma única vez */}
      <Dialog open={!!newSecret} onOpenChange={(open) => !open && setNewSecret(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chave de API criada</DialogTitle>
            <DialogDescription>
              Copie esta chave agora. Você não poderá vê-la novamente.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2">
            <Input readOnly value={newSecret ?? ''} className="font-mono text-sm" />
            <Button type="button" variant="outline" size="icon" onClick={handleCopy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              <span className="sr-only">Copiar</span>
            </Button>
          </div>

          <DialogFooter>
            <Button onClick={() => setNewSecret(null)}>Concluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
