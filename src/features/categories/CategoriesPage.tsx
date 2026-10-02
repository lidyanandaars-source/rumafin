import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Archive, FolderTree } from 'lucide-react'
import { useHousehold } from '@/hooks/useHousehold'
import { archiveCategory, listCategories, saveCategory } from '@/services/categories'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { EmptyState, LoadingState } from '@/components/ui/status'

export function CategoriesPage() {
  const { householdId, role } = useHousehold(); const qc = useQueryClient(); const canManage = role === 'OWNER' || role === 'ADMIN'
  const [open,setOpen]=useState(false); const [form,setForm]=useState({name:'',transaction_type:'EXPENSE' as 'EXPENSE'|'INCOME'|'BOTH',parent_id:''})
  const query=useQuery({queryKey:['categories',householdId,'all'],queryFn:()=>listCategories(householdId!,true),enabled:Boolean(householdId)})
  const roots=useMemo(()=>query.data?.filter(c=>!c.parent_id)??[],[query.data])
  const create=useMutation({mutationFn:()=>saveCategory({household_id:householdId!,name:form.name.trim(),transaction_type:form.transaction_type,parent_id:form.parent_id||null,is_archived:false}),onSuccess:async()=>{await qc.invalidateQueries({queryKey:['categories']});setOpen(false);setForm({name:'',transaction_type:'EXPENSE',parent_id:''})}})
  const archive=useMutation({mutationFn:archiveCategory,onSuccess:()=>qc.invalidateQueries({queryKey:['categories']})})
  const submit=(e:FormEvent)=>{e.preventDefault();if(form.name.trim())create.mutate()}
  return <main className="page"><div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="page-title">Kategori</h1><p className="page-subtitle">Kategori dan subkategori dapat dikustomisasi; kategori bersejarah diarsipkan, bukan dihapus.</p></div>{canManage&&<Button className="w-full sm:w-auto" onClick={()=>setOpen(true)}><Plus className="h-4 w-4"/>Kategori</Button>}</div>
    {query.isLoading?<LoadingState/>:<div className="mt-6 space-y-3">{roots.length?roots.map(root=><Card key={root.id} className={root.is_archived?'opacity-50':''}><CardContent className="pt-5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100"><FolderTree className="h-5 w-5"/></div><div className="flex-1"><p className="font-semibold">{root.name}</p><p className="text-xs text-slate-400">{root.transaction_type}</p></div>{canManage&&!root.is_archived&&<Button size="icon" variant="ghost" onClick={()=>{if(window.confirm('Arsipkan kategori ini?'))archive.mutate(root.id)}}><Archive className="h-4 w-4"/></Button>}</div><div className="mt-3 flex flex-wrap gap-2">{query.data?.filter(c=>c.parent_id===root.id).map(c=><span key={c.id} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium">{c.name}{c.is_archived?' · archived':''}</span>)}</div></CardContent></Card>):<EmptyState title="Belum ada kategori" description="Kategori default biasanya dibuat saat onboarding."/>}</div>}
    <Dialog open={open} onOpenChange={setOpen} title="Tambah kategori"><form className="space-y-4" onSubmit={submit}><label><span className="field-label">Nama</span><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required/></label><label><span className="field-label">Tipe</span><Select value={form.transaction_type} onChange={e=>setForm({...form,transaction_type:e.target.value as typeof form.transaction_type})}><option>EXPENSE</option><option>INCOME</option><option>BOTH</option></Select></label><label><span className="field-label">Parent category</span><Select value={form.parent_id} onChange={e=>setForm({...form,parent_id:e.target.value})}><option value="">Tidak ada (kategori utama)</option>{query.data?.filter(c=>!c.parent_id&&!c.is_archived).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select></label><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={()=>setOpen(false)}>Batal</Button><Button disabled={create.isPending}>Simpan</Button></div></form></Dialog>
  </main>
}
