import { requireSupabase } from '@/lib/supabase'
import type { Category } from '@/types/domain'

export async function listCategories(householdId: string, includeArchived = false): Promise<Category[]> {
  const client = requireSupabase()
  let query = client.from('categories').select('*').eq('household_id', householdId).order('name')
  if (!includeArchived) query = query.eq('is_archived', false)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Category[]
}

export async function saveCategory(input: Partial<Category> & Pick<Category, 'household_id' | 'name' | 'transaction_type'>) {
  const client = requireSupabase()
  if (input.id) {
    const { id, created_at: _createdAt, ...changes } = input
    const { data, error } = await client.from('categories').update(changes).eq('id', id).select().single()
    if (error) throw error
    return data
  }
  const { data, error } = await client.from('categories').insert(input).select().single()
  if (error) throw error
  return data
}

export async function archiveCategory(id: string) {
  const client = requireSupabase()
  const { error } = await client.from('categories').update({ is_archived: true }).eq('id', id)
  if (error) throw error
}
