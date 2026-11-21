'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { ChevronDown, Plus, Timer } from 'lucide-react'
import { TaskUsageReview } from '@/components/time/task-usage-review'
import { toast } from 'sonner'
import { useBusiness } from '@/lib/hooks/use-business'
import { createClient } from '@/lib/supabase/client'
import { approvePricingPolicy, reviewTaskInvoice } from '@/lib/actions/tasks'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
const formatCurrency = (amount: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
import type { Database } from '@/types/database'

type Policy = Database['public']['Tables']['billing_policies']['Row']
type Task = Database['public']['Tables']['work_tasks']['Row'] & {
  pricing: Policy
}
export default function TasksPage() {
  const { currentBusiness } = useBusiness()
  const [policies, setPolicies] = useState<Policy[]>([]),
    [tasks, setTasks] = useState<Task[]>([])
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [loadError, setLoadError] = useState('')
  const requests = useRef(new Map<string, string>())
  const refresh = useCallback(async () => {
    if (!currentBusiness) return
    const db = createClient(),
      id = currentBusiness.id
    const results = await Promise.all([
      db
        .from('billing_policies')
        .select('*')
        .eq('business_id', id)
        .order('created_at', { ascending: false })
        .limit(100),
      db
        .from('work_tasks')
        .select('*, pricing:billing_policies(*)')
        .eq('business_id', id)
        .order('created_at', { ascending: false })
        .limit(100),
      db
        .from('clients')
        .select('id,name')
        .eq('business_id', id)
        .eq('is_active', true)
        .order('name'),
    ])
    if (results.some((r) => r.error)) {
      setLoadError('Não foi possível carregar o faturamento das tarefas. Tente novamente.')
    } else {
      setPolicies(results[0].data || [])
      setTasks(results[1].data || [])
      setClients(results[2].data || [])
      setLoadError('')
    }
    setLoading(false)
  }, [currentBusiness])
  useEffect(() => {
    void refresh()
  }, [refresh])
  async function approve(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!currentBusiness) return
    const form = event.currentTarget,
      f = new FormData(form)
    setBusy(true)
    try {
      await approvePricingPolicy({
        business_id: currentBusiness.id,
        client_id: String(f.get('client')),
        name: String(f.get('name')),
        currency: String(f.get('currency')),
        hourly_rate: String(f.get('rate')),
        usage_multiplier: String(f.get('multiplier')),
        budget: String(f.get('budget')),
      })
      form.reset()
      toast.success('Preço aprovado para novas tarefas')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível aprovar o preço')
    } finally {
      setBusy(false)
    }
  }
  async function invoice(task: Task) {
    if (!currentBusiness) return
    setBusy(true)
    try {
      let id = requests.current.get(task.id)
      if (!id) {
        id = crypto.randomUUID()
        requests.current.set(task.id, id)
      }
      await reviewTaskInvoice(currentBusiness.id, task.id, id)
      requests.current.delete(task.id)
      toast.success('Rascunho da fatura criado')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível criar o rascunho')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Faturamento de tarefas"
        description="Defina preços, acompanhe o trabalho dos agentes e confira os custos antes de faturar."
      />
      {loadError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {loadError}
          <Button variant="outline" size="sm" onClick={refresh}>
            Tentar novamente
          </Button>
        </div>
      )}
      <details
        className="task-surface group"
        open={!loading && policies.length === 0}
      >
        <summary className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-3">
            <Plus size={17} className="text-primary" />
            <span>
              <span className="block text-sm font-semibold">
                Aprovar preços
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Defina o valor por hora do cliente, o multiplicador de uso e o orçamento por tarefa.
              </span>
            </span>
          </span>
          <ChevronDown
            size={15}
            className="shrink-0 text-zinc-400 group-open:rotate-180"
          />
        </summary>
        <p className="text-sm text-muted-foreground">
          Cada tarefa que usar esta política terá o orçamento abaixo. A aprovação é restrita a proprietários e administradores da empresa. Para alterar os preços, crie uma nova política; as tarefas existentes mantêm os valores originais.
        </p>
        <form
          onSubmit={approve}
          className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <div className="space-y-2">
            <Label htmlFor="policy-name">Nome da política</Label>
            <Input
              id="policy-name"
              name="name"
              required
              maxLength={200}
              placeholder="Trabalho de desenvolvimento"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="policy-client">Cliente</Label>
            <select
              className="w-full rounded-md border p-2 text-sm bg-background"
              id="policy-client"
              name="client"
              required
              defaultValue=""
            >
              <option value="" disabled>
                Selecione um cliente
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="policy-currency">Moeda</Label>
            <Input
              id="policy-currency"
              name="currency"
              required
              pattern="[A-Z]{3}"
              maxLength={3}
              defaultValue={currentBusiness?.default_currency || 'USD'}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="policy-rate">Valor por hora</Label>
            <Input
              id="policy-rate"
              name="rate"
              type="number"
              required
              min="0"
              max="999999"
              step="0.0001"
              placeholder="Valor explícito, inclusive 0"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="policy-multiplier">Multiplicador do custo de uso</Label>
            <Input
              id="policy-multiplier"
              name="multiplier"
              type="number"
              required
              min="0"
              max="100"
              step="0.0001"
              placeholder="1 = repassar o custo"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="policy-budget">Orçamento por tarefa</Label>
            <Input
              id="policy-budget"
              name="budget"
              type="number"
              required
              min="0.01"
              max="99999999"
              step="0.01"
            />
          </div>
          <Button disabled={busy || !clients.length} type="submit">
            Aprovar preços para agentes
          </Button>
        </form>
      </details>
      <details className="task-surface group">
        <summary className="flex items-center justify-between text-sm font-semibold">
          Políticas aprovadas{' '}
          <span className="flex items-center gap-3 text-xs font-normal text-zinc-400">
            {policies.length} políticas
            <ChevronDown size={15} className="group-open:rotate-180" />
          </span>
        </summary>
        <div className="grid gap-3 sm:grid-cols-2">
          {policies.map((p) => (
            <div
              key={p.id}
              className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-4 text-sm"
            >
              <strong>{p.name}</strong>
              <p>
                {formatCurrency(p.hourly_rate, p.currency)}/hora + uso ×{' '}
                {p.usage_multiplier}; orçamento{' '}
                {formatCurrency(p.budget, p.currency)} por tarefa.
              </p>
              <details className="mt-3">
                <summary className="text-xs text-zinc-400">
                  Referência da política
                </summary>
                <p className="mt-2 break-all font-mono text-[11px] text-zinc-500">
                  {p.id}
                </p>
              </details>
            </div>
          ))}
        </div>
        {!loading && !policies.length && (
          <p className="text-muted-foreground">
            Aprove uma política acima e peça ao seu agente para listar as políticas de cobrança e criar uma tarefa.
          </p>
        )}
      </details>
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Tarefas recentes</h2>
          <Button variant="outline" onClick={refresh}>
            Atualizar
          </Button>
        </div>
        {loading && <p>Carregando tarefas…</p>}
        {tasks.map((t) => {
          const p = t.pricing
          if (!p)
            return (
              <p key={t.id}>
                Preços indisponíveis para {t.title}. Atualize a página antes de revisar.
              </p>
            )
          const time =
              Math.round(((t.active_seconds * p.hourly_rate) / 3600) * 100) /
              100,
            usageAmount =
              Math.round(t.usage_cost * p.usage_multiplier * 100) / 100
          return (
            <article key={t.id} className="task-surface space-y-4">
              <div>
                <h3 className="font-semibold">{t.title}</h3>
                <p className="text-sm text-muted-foreground">
                  {t.status} · {Math.floor(t.active_seconds / 60)}m{' '}
                  {t.active_seconds % 60}s ativos · {p.name}
                </p>
              </div>
              <p className="rounded-lg bg-zinc-50 px-4 py-3 text-sm">
                Tempo {formatCurrency(time, p.currency)} + uso informado{' '}
                {formatCurrency(usageAmount, p.currency)} ={' '}
                <strong>
                  {formatCurrency(time + usageAmount, p.currency)}
                </strong>
              </p>
              <TaskUsageReview taskId={t.id} />
              {t.status === 'completed' && (
                <Button disabled={busy} onClick={() => invoice(t)}>
                  Aprovar custos e criar fatura em rascunho
                </Button>
              )}
              {t.invoice_id && (
                <Button asChild variant="outline">
                  <Link href={`/invoices/${t.invoice_id}`}>
                    Ver fatura em rascunho
                  </Link>
                </Button>
              )}
            </article>
          )
        })}
        {!loading && !tasks.length && (
          <div className="task-surface flex flex-col items-center py-14 text-center">
            <Timer size={24} strokeWidth={1.5} className="mb-4 text-zinc-400" />
            <h3 className="text-sm font-semibold">
              O trabalho do seu agente, contabilizado
            </h3>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-500">
              Aprove uma política de preços e conecte um agente para começar a acompanhar o trabalho.
            </p>
            <Button asChild variant="outline" className="mt-5">
              <Link href="/agents">Conectar um agente</Link>
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Exibindo as 100 tarefas e políticas mais recentes. O tempo ativo e o uso são cobrados separadamente. Os custos do provedor são informados pelo agente e precisam ser revisados por você.
        </p>
      </section>
    </div>
  )
}
