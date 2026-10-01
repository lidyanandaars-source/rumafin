import { requireSupabase } from '@/lib/supabase'
import type { Account, AccountTypeDefinition } from '@/types/domain'

export async function listAccounts(householdId: string): Promise<Account[]> {
  const client = requireSupabase()
  const { data, error } = await client
    .from('account_balances')
    .select('*')
    .eq('household_id', householdId)
    .order('name')
  if (error) throw error
  return (data ?? []).map((row: any) => ({
    ...row,
    account_type: row.account_type_name ?? row.account_type,
  })) as Account[]
}

export async function listAccountTypes(householdId: string): Promise<AccountTypeDefinition[]> {
  const client = requireSupabase()
  const { data, error } = await client
    .from('account_types')
    .select('*')
    .eq('household_id', householdId)
    .is('deleted_at', null)
    .order('is_system', { ascending: false })
    .order('name')
  if (error) throw error
  return (data ?? []) as AccountTypeDefinition[]
}

export async function createAccountType(input: {
  household_id: string
  name: string
  icon?: string | null
  color?: string | null
}) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('create_account_type', {
    p_household_id: input.household_id,
    p_name: input.name,
    p_icon: input.icon ?? null,
    p_color: input.color ?? null,
    p_source: 'MANUAL',
  })
  if (error) throw error
  return data as AccountTypeDefinition
}

export async function updateAccountType(input: {
  id: string
  name: string
  icon?: string | null
  color?: string | null
}) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('update_account_type', {
    p_account_type_id: input.id,
    p_name: input.name,
    p_icon: input.icon ?? null,
    p_color: input.color ?? null,
    p_source: 'MANUAL',
  })
  if (error) throw error
  return data as AccountTypeDefinition
}

export async function deleteAccountType(id: string) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('delete_account_type', {
    p_account_type_id: id,
    p_source: 'MANUAL',
  })
  if (error) throw error
  return data
}

export async function saveAccount(input: {
  household_id: string
  name: string
  account_type_id: string
  currency: string
  opening_balance: number
}) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('create_account_with_type', {
    p_household_id: input.household_id,
    p_name: input.name,
    p_account_type_id: input.account_type_id,
    p_currency: input.currency,
    p_opening_balance: input.opening_balance,
    p_source: 'MANUAL',
  })
  if (error) throw error
  return data
}

export async function archiveAccount(id: string) {
  const client = requireSupabase()
  const { error } = await client.from('accounts').update({ is_active: false }).eq('id', id)
  if (error) throw error
}
