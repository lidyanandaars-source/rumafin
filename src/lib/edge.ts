import { requireSupabase } from './supabase'

export async function invokeEdge<T>(name: string, body?: unknown, options?: { headers?: Record<string, string> }) {
  const client = requireSupabase()
  const { data, error } = await client.functions.invoke<T>(name, {
    body,
    headers: options?.headers,
  })
  if (error) throw error
  return data as T
}
