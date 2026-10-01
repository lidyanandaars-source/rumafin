import { requireSupabase } from '@/lib/supabase'
import type { Household, Membership } from '@/types/domain'

export async function listMemberships(): Promise<Membership[]> {
  const client = requireSupabase()
  const { data, error } = await client
    .from('household_members')
    .select('household_id,user_id,role,household:households(id,name,default_currency,timezone,created_at)')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as Membership[]
}

export async function createHousehold(input: { name: string; currency: string; timezone: string }): Promise<Household> {
  const client = requireSupabase()
  const { data, error } = await client.rpc('create_household_with_defaults', {
    p_name: input.name,
    p_currency: input.currency,
    p_timezone: input.timezone,
  })
  if (error) throw error
  return data as Household
}
