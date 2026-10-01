import { requireSupabase } from '@/lib/supabase'
import type { Account, AccountType } from '@/types/domain'

export async function listAccounts(householdId: string): Promise<Account[]> {
  const client = requireSupabase()
  const { data, error } = await client.from('account_balances').select('*').eq('household_id', householdId).order('name')
  if (error) throw error
  return (data ?? []) as Account[]
}

export async function saveAccount(input: {
  household_id: string
  id?: string
  name: string
  account_type: AccountType
  currency: string
  opening_balance: number
  icon?: string | null
  color?: string | null
}) {
  const client = requireSupabase()
  if (input.id) {
    const { id, household_id: _householdId, ...changes } = input
    const { data, error } = await client.from('accounts').update(changes).eq('id', id).select().single()
    if (error) throw error
    return data
  }
  const { data, error } = await client.from('accounts').insert(input).select().single()
  if (error) throw error
  return data
}

export async function archiveAccount(id: string) {
  const client = requireSupabase()
  const { error } = await client.from('accounts').update({ is_active: false }).eq('id', id)
  if (error) throw error
}
