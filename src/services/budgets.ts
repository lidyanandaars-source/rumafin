import { requireSupabase } from '@/lib/supabase'
import type { Budget } from '@/types/domain'

export async function listBudgets(householdId: string, month: string): Promise<Budget[]> {
  const client = requireSupabase()
  const { data, error } = await client.rpc('get_budget_progress', { p_household_id: householdId, p_month: month })
  if (error) throw error
  return (data ?? []) as Budget[]
}

export async function saveBudget(input: { household_id: string; category_id: string; period_month: string; amount: number; alert_thresholds?: number[] }) {
  const client = requireSupabase()
  const { data, error } = await client.from('budgets').upsert({ ...input, alert_thresholds: input.alert_thresholds ?? [75, 90, 100] }, { onConflict: 'household_id,category_id,period_month' }).select().single()
  if (error) throw error
  return data
}
