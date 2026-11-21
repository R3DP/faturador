'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import type { Database } from '@/types/database'
type Usage = Database['public']['Tables']['task_usage']['Row']
export function TaskUsageReview({ taskId }: { taskId: string }) {
  const [rows, setRows] = useState<Usage[]>([]),
    [page, setPage] = useState(0),
    [count, setCount] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('')
  async function load(index: number) {
    setLoading(true)
    const { data, error, count } = await createClient()
      .from('task_usage')
      .select('*', { count: 'exact' })
      .eq('task_id', taskId)
      .order('created_at')
      .order('id')
      .range(index * 50, index * 50 + 49)
    if (error) setError('Não foi possível carregar o uso. Tente novamente antes de aprovar a cobrança.')
    else {
      setRows(data || [])
      setCount(count || 0)
      setPage(index)
      setError('')
    }
    setLoading(false)
  }
  return (
    <details
      onToggle={(event) => {
        if (event.currentTarget.open) void load(0)
      }}
    >
      <summary className="cursor-pointer text-sm">
        Revisar fontes de uso informadas
      </summary>
      {error && (
        <p role="alert" className="text-sm mt-2">
          {error}
        </p>
      )}
      {loading ? (
        <p>Carregando uso…</p>
      ) : (
        <>
          <ul className="mt-2 space-y-2 text-sm">
            {rows.map((u) => (
              <li key={u.id} className="break-words">
                {u.provider} {u.model}: {u.cost} {u.currency} ·{' '}
                {u.provider_request_id}
                <p className="text-muted-foreground">Origem: {u.source}</p>
              </li>
            ))}
          </ul>
          <div className="flex gap-3 items-center mt-3 text-xs">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => load(page - 1)}
            >
              Voltar
            </Button>
            <span>
              {count === 0
                ? 'Nenhum uso informado'
                : `${page * 50 + 1}–${Math.min((page + 1) * 50, count)} de ${count}`}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={(page + 1) * 50 >= count}
              onClick={() => load(page + 1)}
            >
              Próximo
            </Button>
            {error && (
              <Button variant="outline" size="sm" onClick={() => load(page)}>
                Tentar novamente
              </Button>
            )}
          </div>
        </>
      )}
    </details>
  )
}
