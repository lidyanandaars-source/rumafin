import { requireSupabase } from '@/lib/supabase'
import type { DashboardSummary, TransactionType } from '@/types/domain'

export async function getDashboardSummary(householdId: string, from: string, to: string): Promise<DashboardSummary> {
  const client = requireSupabase()
  const { data, error } = await client.rpc('get_financial_dashboard', { p_household_id: householdId, p_from: from, p_to: to })
  if (error) throw error
  return data as DashboardSummary
}

export interface ReportFilters {
  accountId?: string | null
  categoryId?: string | null
  memberId?: string | null
  merchant?: string | null
  transactionType?: TransactionType | null
}

export async function getFilteredReport(
  householdId: string,
  from: string,
  to: string,
  filters: ReportFilters,
): Promise<DashboardSummary> {
  const client = requireSupabase()
  const { data, error } = await client.rpc('get_filtered_financial_report', {
    p_household_id: householdId,
    p_from: from,
    p_to: to,
    p_account_id: filters.accountId || null,
    p_category_id: filters.categoryId || null,
    p_member_id: filters.memberId || null,
    p_merchant: filters.merchant?.trim() || null,
    p_transaction_type: filters.transactionType || null,
  })
  if (error) throw error
  return data as DashboardSummary
}
