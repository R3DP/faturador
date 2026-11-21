'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Receipt } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { ExpenseForm, type ExpenseFormData } from '@/components/expenses/expense-form'
import { EmptyState } from '@/components/shared/empty-state'
import { useBusiness } from '@/lib/hooks/use-business'
import type { Expense, Client } from '@/types'

import { toast } from 'sonner'
import { toISODate } from '@/lib/dates'
import { updateExpenseAction } from '@/lib/actions/expenses'

export default function EditExpensePage() {
  const params = useParams()
  const router = useRouter()
  const expenseId = params.id as string
  const { currentBusiness } = useBusiness()
  const [expense, setExpense] = useState<Expense | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      if (!currentBusiness) return

      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      const [expenseRes, clientsRes] = await Promise.all([
        supabase.from('expenses').select('*').eq('id', expenseId).single(),
        supabase
          .from('clients')
          .select('*')
          .eq('business_id', currentBusiness.id)
          .eq('is_active', true)
          .order('name'),
      ])

      if (expenseRes.data) setExpense(expenseRes.data as Expense)
      if (clientsRes.data) setClients(clientsRes.data)
      setIsLoading(false)
    }

    fetchData()
  }, [expenseId, currentBusiness])

  async function handleSubmit(data: ExpenseFormData) {
    if (!expense) return
    if (expense.invoice_id) {
      toast.error('Um trabalho faturado não pode ser editado. Crie um lançamento de correção.')
      return
    }

    const result = await updateExpenseAction(expenseId, {
      client_id: data.client_id || null,
      category: data.category,
      description: data.description || null,
      amount: data.amount,
      date: toISODate(data.date),
      vendor: data.vendor || null,
      is_billable: data.is_billable,
    })

    if ('error' in result) {
      toast.error(result.error)
      return
    }
    router.push('/expenses')
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!expense) {
    return (
      <div className="p-6 lg:p-8">
        <EmptyState
          icon={Receipt}
          title="Despesa não encontrada"
          description="A despesa que você procura não existe."
          action={{ label: 'Voltar para despesas', href: '/expenses' }}
        />
      </div>
    )
  }

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Editar despesa"
        description="Atualize esta despesa"
      />

      <div className="mt-6 max-w-2xl">
        <ExpenseForm
          currency={currentBusiness?.default_currency}
          expense={expense}
          clients={clients}
          onSubmit={handleSubmit}
          onCancel={() => router.back()}
        />
      </div>
    </div>
  )
}

