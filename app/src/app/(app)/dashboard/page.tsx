'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { DollarSign, Clock, Users, AlertCircle, Plus, Handshake } from 'lucide-react'
import { StatsCard } from '@/components/dashboard/stats-card'
import { RecentInvoices } from '@/components/dashboard/recent-invoices'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { PageHeader } from '@/components/shared/page-header'
import { useBusiness } from '@/lib/hooks/use-business'
import type { Invoice, Client } from '@/types'

interface DashboardStats {
  totalRevenue: number
  outstanding: number
  overdueCount: number
  activeClients: number
}

/**
 * Trabalho acordado que já pode ser faturado, mas ainda não foi incluído em uma fatura.
 *
 * Este é o motivo da existência dos contratos: a segunda metade de um trabalho que
 * foi entregue há quatro meses é justamente a fatura que as pessoas esquecem. O dado vem de
 * engagement_summary, em vez de ser contado aqui, e apenas a moeda padrão da empresa
 * é somada, pois o Faturador não faz conversão de moeda.
 */
interface ReadyToBill {
  count: number
  amount: number
  otherCurrencies: boolean
}

export default function DashboardPage() {
  const { currentBusiness, isLoading: businessLoading } = useBusiness()
  const [stats, setStats] = useState<DashboardStats>({
    totalRevenue: 0,
    outstanding: 0,
    overdueCount: 0,
    activeClients: 0,
  })
  const [readyToBill, setReadyToBill] = useState<ReadyToBill>({
    count: 0,
    amount: 0,
    otherCurrencies: false,
  })
  const [recentInvoices, setRecentInvoices] = useState<
    (Invoice & { client: Client })[]
  >([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function fetchDashboardData() {
      if (!currentBusiness) return

      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      const { data: invoices } = await supabase
        .from('invoices')
        .select('*, client:clients(*)')
        .eq('business_id', currentBusiness.id)
        .order('created_at', { ascending: false })
        .limit(5)

      if (invoices) {
        setRecentInvoices(invoices as (Invoice & { client: Client })[])
      }

      const { data: summary, error } = await supabase.rpc('dashboard_summary', {
        p_business_id: currentBusiness.id,
        p_currency: currentBusiness.default_currency,
      })
      if (!error && summary) setStats(summary as unknown as DashboardStats)

      // A verificação de vencimentos do cronograma ocorre nas consultas, não por cron;
      // então é ao abrir o painel que um lançamento
      // com data vencida passa a ser considerado pronto.
      await supabase.rpc('promote_due_entries', { p_business_id: currentBusiness.id })
      const { data: engagements } = await supabase
        .from('engagement_summary')
        .select('currency, ready_count, ready_amount')
        .eq('business_id', currentBusiness.id)
        .gt('ready_count', 0)

      if (engagements) {
        setReadyToBill({
          count: engagements.reduce((sum, row) => sum + (row.ready_count ?? 0), 0),
          amount: engagements
            .filter((row) => row.currency === currentBusiness.default_currency)
            .reduce((sum, row) => sum + Number(row.ready_amount ?? 0), 0),
          otherCurrencies: engagements.some(
            (row) => row.currency !== currentBusiness.default_currency,
          ),
        })
      }

      setIsLoading(false)
    }

    if (currentBusiness) {
      fetchDashboardData()
    }
  }, [currentBusiness])

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currentBusiness?.default_currency || 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  }

  if (businessLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!currentBusiness) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <h2 className="text-xl font-semibold">Boas-vindas ao Faturador!</h2>
        <p className="mt-2 text-center text-muted-foreground">
          Comece criando sua primeira empresa.
        </p>
        <a
          href="/onboarding"
          className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Criar empresa
        </a>
      </div>
    )
  }

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Visão geral"
        description={`Visão clara de ${currentBusiness.name}.`}
      >
        <Button asChild>
          <Link href="/invoices/new">
            <Plus size={14} className="mr-2" />
            Nova fatura
          </Link>
        </Button>
      </PageHeader>
      {/* Estatísticas */}
      <div className="mt-6 grid grid-cols-2 divide-x divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 lg:grid-cols-5">
        <StatsCard
          title="Pagamentos recebidos"
          value={isLoading ? '…' : formatCurrency(stats.totalRevenue)}
          icon={DollarSign}
        />
        <StatsCard
          title="Em aberto"
          value={isLoading ? '…' : formatCurrency(stats.outstanding)}
          icon={Clock}
        />
        <StatsCard
          title="Clientes ativos"
          value={isLoading ? '…' : stats.activeClients.toString()}
          icon={Users}
        />
        <StatsCard
          title="Faturas atrasadas"
          value={isLoading ? '…' : stats.overdueCount.toString()}
          icon={AlertCircle}
        />
        <Link href="/engagements?ready=1" className="block hover:bg-zinc-50">
          <StatsCard
            title="Pronto para faturar"
            value={
              isLoading
                ? '…'
                : readyToBill.count === 0
                  ? '0'
                  : `${readyToBill.count} · ${formatCurrency(readyToBill.amount)}`
            }
            icon={Handshake}
          />
        </Link>
      </div>

      {!isLoading && readyToBill.count > 0 && (
        <p className="mt-3 text-[11px] text-zinc-500">
          {readyToBill.count === 1
            ? 'Um lançamento do cronograma acordado está pronto para faturar.'
            : `${readyToBill.count} lançamentos do cronograma acordado estão prontos para faturar.`}{' '}
          {readyToBill.otherCurrencies && 'Alguns estão em outra moeda. '}
          <Link href="/engagements?ready=1" className="underline">
            Revisar
          </Link>
          .
        </p>
      )}

      <p className="mt-3 text-[11px] text-zinc-400">
        Totais financeiros em {currentBusiness.default_currency}. Veja outras
        moedas em Relatórios.
      </p>

      {/* Grade de conteúdo */}
      <div className="mt-9 grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_280px]">
        <RecentInvoices invoices={recentInvoices} />
        <QuickActions />
      </div>
    </div>
  )
}
