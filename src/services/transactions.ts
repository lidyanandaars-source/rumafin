import { requireSupabase } from '@/lib/supabase'
import type { Transaction, TransactionSource, TransactionType } from '@/types/domain'

export interface TransactionWriteInput {
  id?: string
  household_id: string
  transaction_type: TransactionType
  transaction_at: string
  timezone: string
  merchant_name?: string | null
  description?: string | null
  notes?: string | null
  total_amount: number
  currency: string
  source: TransactionSource
  splits: Array<{ category_id: string | null; amount: number; description?: string | null }>
  movements: Array<{ account_id: string; amount: number }>
  idempotency_key?: string
}

export interface TransactionFilters {
  search?: string
  type?: TransactionType | ''
  from?: string
  to?: string
  accountId?: string
  categoryId?: string
  includeDeleted?: boolean
}

export async function listTransactions(householdId: string, filters: TransactionFilters = {}): Promise<Transaction[]> {
  const client = requireSupabase()
  let query = client
    .from('transactions')
    .select('*,splits:transaction_splits(*,category:categories(id,name,color,icon)),movements:account_movements(*,account:accounts(id,name,account_type))')
    .eq('household_id', householdId)
    .order('transaction_at', { ascending: false })
    .limit(250)

  if (!filters.includeDeleted) query = query.is('deleted_at', null)
  if (filters.type) query = query.eq('transaction_type', filters.type)
  if (filters.from) query = query.gte('transaction_at', `${filters.from}T00:00:00`)
  if (filters.to) query = query.lte('transaction_at', `${filters.to}T23:59:59.999`)
  if (filters.search) {
    const safe = filters.search.replace(/[,%()]/g, ' ')
    query = query.or(`merchant_name.ilike.%${safe}%,description.ilike.%${safe}%`)
  }

  const { data, error } = await query
  if (error) throw error
  let rows = (data ?? []) as unknown as Transaction[]
  if (filters.accountId) rows = rows.filter((t) => t.movements?.some((m) => m.account_id === filters.accountId))
  if (filters.categoryId) rows = rows.filter((t) => t.splits?.some((s) => s.category_id === filters.categoryId))
  return rows
}


export async function getTransactionById(id: string): Promise<Transaction> {
  const client = requireSupabase()
  const { data, error } = await client
    .from('transactions')
    .select('*,splits:transaction_splits(*,category:categories(id,name,color,icon)),movements:account_movements(*,account:accounts(id,name,account_type))')
    .eq('id', id)
    .single()
  if (error) throw error
  return data as unknown as Transaction
}

export async function createTransaction(input: TransactionWriteInput): Promise<Transaction> {
  const client = requireSupabase()
  const { data, error } = await client.rpc('create_financial_transaction', {
    p_payload: {
      ...input,
      idempotency_key: input.idempotency_key ?? crypto.randomUUID(),
    },
  })
  if (error) throw error
  return data as Transaction
}

export async function updateTransaction(input: TransactionWriteInput & { id: string }): Promise<Transaction> {
  const client = requireSupabase()
  const { data, error } = await client.rpc('update_financial_transaction', { p_transaction_id: input.id, p_payload: input })
  if (error) throw error
  return data as Transaction
}

export async function softDeleteTransaction(id: string) {
  const client = requireSupabase()
  const { error } = await client.rpc('soft_delete_transaction', { p_transaction_id: id })
  if (error) throw error
}

export async function restoreTransaction(id: string) {
  const client = requireSupabase()
  const { error } = await client.rpc('restore_transaction', { p_transaction_id: id })
  if (error) throw error
}
