'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  CONSENT_CHOICES,
  CONSENT_FOOTNOTE,
  type OauthScope,
} from '@/lib/oauth/scopes'
import {
  approveAuthorizationAction,
  denyAuthorizationAction,
} from './actions'

interface BusinessOption {
  id: string
  name: string
}

/**
 * A tela de consentimento.
 *
 * Ela concede MENOS do que o aplicativo pediu sempre que a pessoa escolher assim:
 * o escopo solicitado apenas deixa algumas opções pré-selecionadas. Cada explicação ao lado de uma caixa
 * descreve em linguagem simples o efeito daquela permissão ("Envia faturas aos seus clientes"),
 * pois "escopo de escrita" não significa nada para quem está sendo consultado.
 */
export function ConsentForm({
  clientName,
  clientId,
  redirectUri,
  codeChallenge,
  state,
  resource,
  resourceLabel,
  businesses,
  preselected,
}: {
  clientName: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  state: string
  resource: string
  resourceLabel: string
  businesses: BusinessOption[]
  preselected: OauthScope[]
}) {
  const [businessId, setBusinessId] = useState(businesses[0]?.id ?? '')
  const [granted, setGranted] = useState<OauthScope[]>(preselected)
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)

  function toggle(permission: OauthScope, on: boolean) {
    setGranted((current) =>
      on ? [...new Set([...current, permission])] : current.filter((p) => p !== permission)
    )
  }

  function leave(url: string) {
    // O retorno é entre origens, então usamos navegação completa em vez do roteador.
    window.location.replace(url)
  }

  async function approve() {
    setError(null)
    setBusy('approve')
    try {
      const result = await approveAuthorizationAction({
        clientId,
        redirectUri,
        codeChallenge,
        state,
        resource,
        businessId,
        permissions: granted,
      })
      if ('error' in result) {
        setError(result.error)
        setBusy(null)
        return
      }
      leave(result.redirect)
    } catch {
      setError('Não foi possível concluir a conexão. Tente novamente.')
      setBusy(null)
    }
  }

  async function deny() {
    setError(null)
    setBusy('deny')
    try {
      const result = await denyAuthorizationAction({ clientId, redirectUri, state })
      if ('error' in result) {
        setError(result.error)
        setBusy(null)
        return
      }
      leave(result.redirect)
    } catch {
      setError('Não foi possível enviar sua resposta de volta ao aplicativo.')
      setBusy(null)
    }
  }

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight text-foreground">
        Conectar {clientName} ao Faturador
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {clientName} está solicitando acesso à sua conta Faturador por meio de{' '}
        <span className="font-mono text-xs">{resourceLabel}</span>. Escolha o que ele poderá fazer. Você
        pode revogar esse acesso a qualquer momento em Agentes.
      </p>

      {error && (
        <div role="alert" className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="mt-6 space-y-2">
        <Label htmlFor="consent-business">Empresa</Label>
        <select
          id="consent-business"
          className="w-full rounded border bg-background p-2 text-sm"
          value={businessId}
          onChange={(event) => setBusinessId(event.target.value)}
        >
          {businesses.map((business) => (
            <option key={business.id} value={business.id}>
              {business.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          A conexão só poderá visualizar e alterar esta empresa.
        </p>
      </div>

      <fieldset className="mt-6 space-y-3">
        <legend className="text-sm font-medium text-foreground">Permissões</legend>
        {CONSENT_CHOICES.map((choice) => {
          const checked = choice.fixed || granted.includes(choice.permission)
          return (
            <label
              key={choice.permission}
              className="flex items-start gap-3 rounded-lg border p-3 text-sm"
            >
              <Checkbox
                className="mt-0.5"
                checked={checked}
                disabled={choice.fixed || busy !== null}
                onCheckedChange={(value) => toggle(choice.permission, value === true)}
                aria-label={choice.label}
              />
              <span>
                <span className="font-medium text-foreground">{choice.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {choice.consequence}
                </span>
              </span>
            </label>
          )
        })}
      </fieldset>

      <p className="mt-4 text-xs text-muted-foreground">{CONSENT_FOOTNOTE}</p>

      <div className="mt-6 flex gap-3">
        <Button variant="outline" className="flex-1" onClick={deny} disabled={busy !== null}>
          {busy === 'deny' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Negar
        </Button>
        <Button className="flex-1" onClick={approve} disabled={busy !== null || !businessId}>
          {busy === 'approve' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Permitir acesso
        </Button>
      </div>
    </div>
  )
}
