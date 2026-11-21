'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import type { Database } from '@/types/database'
type Call = Database['public']['Tables']['agent_tool_calls']['Row']
export function AuditPanel() {
  const [calls, setCalls] = useState<Call[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true)
  async function load() {
    const { data, error } = await createClient()
      .from('agent_tool_calls')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) setError('Não foi possível carregar seu histórico de auditoria')
    else {
      setCalls(data || [])
      setError('')
    }
    setLoading(false)
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Busca o log de auditoria externo ao montar.
    void load()
  }, [])
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Histórico de auditoria de ferramentas</h2>
        <Button variant="outline" onClick={load}>
          Atualizar
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Suas 100 chamadas de agente mais recentes. Uma chamada iniciada ainda não tem
        resultado confirmado; confira os registros antes de tentar novamente. Argumentos e segredos de API
        não são incluídos.
      </p>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p>Carregando…</p>
      ) : calls.length === 0 ? (
        <p>Nenhuma chamada de ferramenta ainda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-2">Data e hora</th>
                <th className="p-2">Ferramenta</th>
                <th className="p-2">Resultado</th>
                <th className="p-2">ID da chave</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id} className="border-b">
                  <td className="p-2">
                    {new Date(c.created_at).toLocaleString()}
                  </td>
                  <td className="p-2 font-mono">{c.tool_name}</td>
                  <td className="p-2">{c.status}</td>
                  <td className="p-2 font-mono">{c.key_id || 'Chave excluída'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
