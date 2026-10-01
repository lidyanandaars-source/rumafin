import { createClient } from 'npm:@supabase/supabase-js@2'

export function clients(req: Request) {
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const auth = req.headers.get('Authorization') ?? ''
  const user = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  return { user, admin }
}

export async function requireUser(req: Request) {
  const { user, admin } = clients(req)
  const { data, error } = await user.auth.getUser()
  if (error || !data.user) throw new Error('Authentication required')
  return { userClient: user, admin, authUser: data.user }
}

export async function requireHouseholdAccess(admin: ReturnType<typeof createClient>, userId: string, householdId: string, write = false) {
  const { data, error } = await admin.from('household_members').select('role').eq('household_id', householdId).eq('user_id', userId).maybeSingle()
  if (error || !data) throw new Error('Not authorized for this household')
  if (write && !['OWNER','ADMIN','MEMBER'].includes(data.role)) throw new Error('Not authorized to modify this household')
  return data.role as 'OWNER'|'ADMIN'|'MEMBER'|'VIEWER'
}

export async function rateLimit(admin: ReturnType<typeof createClient>, userId: string, endpoint: string, maxPerMinute: number) {
  const since = new Date(Date.now() - 60_000).toISOString()
  const { count, error } = await admin.from('api_request_log').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('endpoint', endpoint).gte('created_at', since)
  if (error) throw error
  if ((count ?? 0) >= maxPerMinute) throw new Error('Rate limit exceeded. Please try again shortly.')
  const { error: insertError } = await admin.from('api_request_log').insert({ user_id: userId, endpoint })
  if (insertError) throw insertError
  void admin.from('api_request_log').delete().lt('created_at', new Date(Date.now() - 86_400_000).toISOString())
}
