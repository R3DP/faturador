'use client'

/**
 * Busca os dados do relatório da empresa ATIVA.
 *
 * Escopo: a empresa vem de useBusiness() (o mesmo contexto usado pelas demais
 * páginas em (app)) e é enviada à chamada RPC, que verifica novamente a associação
 * no servidor antes de ler os dados. Nenhuma consulta aqui cruza empresas.
 *
 * Agregação: uma única chamada a get_report_summary. As somas mais pesadas, a série temporal
 * e os agrupamentos são processados no Postgres; somente as faturas em aberto retornam
 * sem agregação, pois o relatório de vencimentos precisa delas para detalhar os dados.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useBusiness } from '@/lib/hooks/use-business'
import { parseReportPayload, type ReportData } from '@/lib/reports/types'
import type { BucketUnit, ReportRange } from '@/lib/reports/date-ranges'

export interface UseReportDataArgs {
  range: ReportRange
  previousRange: ReportRange | null
  bucket: BucketUnit
  /** Nulo permite que o servidor use a moeda padrão da empresa. */
  currency: string | null
}

export interface UseReportDataResult {
  data: ReportData | null
  isLoading: boolean
  /** Verdadeiro durante uma nova busca com dados já exibidos, para manter os gráficos estáveis. */
  isRefreshing: boolean
  error: string | null
  refresh: () => void
}

export function useReportData({
  range,
  previousRange,
  bucket,
  currency,
}: UseReportDataArgs): UseReportDataResult {
  const { currentBusiness } = useBusiness()
  const [data, setData] = useState<ReportData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const hasData = useRef(false)

  const businessId = currentBusiness?.id ?? null
  const key = `${businessId}|${range.start}|${range.end}|${previousRange?.start ?? ''}|${previousRange?.end ?? ''}|${bucket}|${currency ?? ''}|${nonce}`

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!businessId) {
        setData(null)
        setIsLoading(false)
        return
      }

      if (hasData.current) setIsRefreshing(true)
      else setIsLoading(true)
      setError(null)

      try {
        const { createClient } = await import('@/lib/supabase/client')
        const supabase = createClient()
        const { data: payload, error: rpcError } = await supabase.rpc(
          'get_report_summary',
          {
            p_business_id: businessId,
            p_start: range.start,
            p_end: range.end,
            p_prev_start: previousRange?.start,
            p_prev_end: previousRange?.end,
            p_bucket: bucket,
            p_currency: currency ?? undefined,
            p_aging_limit: 500,
          },
        )

        if (cancelled) return
        if (rpcError) {
          console.error('useReportData:', rpcError)
          // Exiba o motivo original. Uma mensagem genérica aqui impedia
          // diagnosticar a falha sem acessar o banco de dados, o que não é adequado
          // para uma pessoa que está consultando a própria conta.
          setError(
            rpcError.message
              ? `Não foi possível carregar os relatórios: ${rpcError.message}`
              : 'Não foi possível carregar os relatórios. Tente novamente em instantes.',
          )
          return
        }

        setData(parseReportPayload(payload, range))
        hasData.current = true
      } catch (caught) {
        if (cancelled) return
        console.error('useReportData:', caught)
        const detail = caught instanceof Error ? caught.message : ''
        setError(
          detail
            ? `Não foi possível carregar os relatórios: ${detail}`
            : 'Não foi possível carregar os relatórios. Tente novamente em instantes.',
        )
      } finally {
        if (!cancelled) {
          setIsLoading(false)
          setIsRefreshing(false)
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
    // `key` reúne todas as entradas que devem iniciar uma nova busca. O intervalo e
    // o objeto previousRange são recriados a cada renderização; depender deles
    // diretamente causaria um loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  return { data, isLoading, isRefreshing, error, refresh }
}
