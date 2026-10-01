import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MailPlus, UserRound, UserMinus } from 'lucide-react'
import { useHousehold } from '@/hooks/useHousehold'
import { requireSupabase } from '@/lib/supabase'
import { invokeEdge } from '@/lib/edge'
import type { HouseholdRole } from '@/types/domain'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { LoadingState } from '@/components/ui/status'

interface MemberRow{user_id:string;role:HouseholdRole;created_at:string;profile:{display_name:string|null;email:string|null}|null}
export function MembersPage(){
  const{householdId,role}=useHousehold();const qc=useQueryClient();const canManage=role==='OWNER'||role==='ADMIN';const[open,setOpen]=useState(false);const[email,setEmail]=useState('');const[inviteRole,setInviteRole]=useState<Exclude<HouseholdRole,'OWNER'>>('MEMBER');const[message,setMessage]=useState<string|null>(null)
  const remove=useMutation({mutationFn:async(userId:string)=>{const{error}=await requireSupabase().rpc('remove_household_member',{p_household_id:householdId,p_user_id:userId});if(error)throw error},onSuccess:()=>qc.invalidateQueries({queryKey:['members']})})
  const query=useQuery({queryKey:['members',householdId],queryFn:async()=>{const{data,error}=await requireSupabase().from('household_members').select('user_id,role,created_at,profile:profiles(display_name,email)').eq('household_id',householdId!).order('created_at');if(error)throw error;return(data??[]) as unknown as MemberRow[]},enabled:Boolean(householdId)})
  const invite=useMutation({mutationFn:()=>invokeEdge<{message:string}>('invite-member',{household_id:householdId,email,role:inviteRole}),onSuccess:async(d)=>{setMessage(d.message);await qc.invalidateQueries({queryKey:['members']});setEmail('')}})
  const submit=(e:FormEvent)=>{e.preventDefault();setMessage(null);if(email)invite.mutate()}
  return <main className="page"><div className="flex items-end justify-between"><div><h1 className="page-title">Anggota household</h1><p className="page-subtitle">OWNER, ADMIN, MEMBER, dan VIEWER memiliki izin berbeda.</p></div>{canManage&&<Button onClick={()=>setOpen(true)}><MailPlus className="h-4 w-4"/>Undang</Button>}</div>
    {query.isLoading?<LoadingState/>:<div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">{query.data?.map(m=><div key={m.user_id} className="flex items-center gap-3 border-b border-slate-100 p-4 last:border-0"><div className="grid h-11 w-11 place-items-center rounded-full bg-slate-100"><UserRound className="h-5 w-5"/></div><div className="min-w-0 flex-1"><p className="truncate font-semibold">{m.profile?.display_name||m.profile?.email||m.user_id}</p><p className="truncate text-xs text-slate-400">{m.profile?.email}</p></div><Badge>{m.role}</Badge>{role==='OWNER'&&m.role!=='OWNER'&&<Button size="icon" variant="ghost" title="Hapus anggota" onClick={()=>{if(window.confirm('Hapus anggota ini dari household?'))remove.mutate(m.user_id)}}><UserMinus className="h-4 w-4 text-red-600"/></Button>}</div>)}</div>}
    <Dialog open={open} onOpenChange={setOpen} title="Undang anggota" description="Jika email belum terdaftar, Supabase Auth akan mengirim invitation email."><form className="space-y-4" onSubmit={submit}><label><span className="field-label">Email</span><Input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label><span className="field-label">Role</span><Select value={inviteRole} onChange={e=>setInviteRole(e.target.value as typeof inviteRole)}><option>ADMIN</option><option>MEMBER</option><option>VIEWER</option></Select></label>{invite.error&&<p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{invite.error.message}</p>}{message&&<p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={()=>setOpen(false)}>Tutup</Button><Button disabled={invite.isPending}>Kirim undangan</Button></div></form></Dialog>
  </main>
}
