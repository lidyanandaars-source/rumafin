import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const hasSupabaseConfig = Boolean(url && key && url.startsWith('https://'))
export const supabase: SupabaseClient | null = hasSupabaseConfig ? createClient(url!, key!, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
}) : null

export function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase belum dikonfigurasi. Isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY.')
  }
  return supabase
}
