import { createServiceClient } from '@/lib/supabase/service'
import type { Database } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'

type ClientRow = Database['public']['Tables']['clients']['Row']
type InvoiceRow = Database['public']['Tables']['invoices']['Row']
type EstimateRow = Database['public']['Tables']['estimates']['Row']
type TimeEntryRow = Database['public']['Tables']['time_entries']['Row']
type ExpenseRow = Database['public']['Tables']['expenses']['Row']
type PaymentRow = Database['public']['Tables']['payments']['Row']

export interface Scope {
  userId: string
  businessIds: string[]
}

export class ScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScopeError'
  }
}

export interface ScopedDb {
  scope: Scope
  svc: SupabaseClient<Database>
  resolveBusinessId(input?: string): string
  assertClientAccess(clientId: string): Promise<ClientRow>
  assertInvoiceAccess(invoiceId: string): Promise<InvoiceRow>
  assertEstimateAccess(estimateId: string): Promise<EstimateRow>
  assertTimeEntryAccess(timeEntryId: string): Promise<TimeEntryRow>
  assertExpenseAccess(expenseId: string): Promise<ExpenseRow>
  assertPaymentAccess(paymentId: string): Promise<PaymentRow>
}

export function createScopedDb(
  scope: Scope,
  svc: SupabaseClient<Database> = createServiceClient()
): ScopedDb {
  function resolveBusinessId(input?: string): string {
    if (input !== undefined) {
      if (!scope.businessIds.includes(input)) {
        throw new ScopeError(
          `Você não tem acesso à empresa ${input}. Disponíveis: ${scope.businessIds.join(', ')}`
        )
      }
      return input
    }
    if (scope.businessIds.length === 1) {
      return scope.businessIds[0]
    }
    throw new ScopeError(
      `Há várias empresas no escopo (${scope.businessIds.join(', ')}); informe business_id para especificar qual delas.`
    )
  }

  /**
   * Implementação única usada por todos os helpers assert*Access: busca o registro pelo
   * ID e só o permite se business_id estiver dentro do escopo da chave.
   *
   * "Ausente" e "fora do escopo" produzem deliberadamente a MESMA mensagem,
   * para que quem chama não possa descobrir a existência de registros de outro locatário
   * comparando o texto dos erros. scoped-db.test.ts verifica essa equivalência.
   */
  async function assertRowAccess<T extends { business_id: string }>(
    table: 'clients' | 'invoices' | 'estimates' | 'time_entries' | 'expenses' | 'payments',
    label: string,
    id: string
  ): Promise<T> {
    const { data, error } = await svc.from(table).select('*').eq('id', id).maybeSingle()
    if (error) {
      console.error(`scoped-db assert${label}Access:`, error)
    }
    const row = data as T | null
    if (error || !row || !scope.businessIds.includes(row.business_id)) {
      const genderedNotFound = label === 'Fatura' || label === 'Despesa' ? 'não encontrada' : 'não encontrado'
      throw new ScopeError(`${label} ${genderedNotFound}`)
    }
    return row
  }

  const assertClientAccess = (clientId: string) => assertRowAccess<ClientRow>('clients', 'Cliente', clientId)
  const assertInvoiceAccess = (invoiceId: string) => assertRowAccess<InvoiceRow>('invoices', 'Fatura', invoiceId)
  const assertEstimateAccess = (estimateId: string) =>
    assertRowAccess<EstimateRow>('estimates', 'Orçamento', estimateId)
  const assertTimeEntryAccess = (timeEntryId: string) =>
    assertRowAccess<TimeEntryRow>('time_entries', 'Lançamento de horas', timeEntryId)
  const assertExpenseAccess = (expenseId: string) => assertRowAccess<ExpenseRow>('expenses', 'Despesa', expenseId)
  const assertPaymentAccess = (paymentId: string) => assertRowAccess<PaymentRow>('payments', 'Pagamento', paymentId)

  return {
    scope,
    svc,
    resolveBusinessId,
    assertClientAccess,
    assertInvoiceAccess,
    assertEstimateAccess,
    assertTimeEntryAccess,
    assertExpenseAccess,
    assertPaymentAccess,
  }
}
