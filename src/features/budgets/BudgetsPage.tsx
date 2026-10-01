import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Target } from 'lucide-react'
import { useHousehold } from '@/hooks/useHousehold'
import { listBudgets, saveBudget } from '@/services/budgets'
import { listCategories } from '@/services/categories'
import { formatCurrency } from '@/utils/currency'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState, LoadingState } from '@/components/ui/status'

export function BudgetsPage(){
  const {householdId,role}=useHousehold();const qc=useQueryClient();const canManage=role==='OWNER'||role==='ADMIN';const month=new Date().toISOString().slice(0,7)+'-01'
  const [open,setOpen]=useState(false);const [form,setForm]=useState({category_id:'',amount:''})
  const budgets=useQuery({queryKey:['budgets',householdId,month],queryFn:()=>listBudgets(householdId!,month),enabled:Boolean(householdId)})
  const categories=useQuery({queryKey:['categories',householdId],queryFn:()=>listCategories(householdId!),enabled:Boolean(householdId)})
  const mutation=useMutation({mutationFn:()=>saveBudget({household_id:householdId!,category_id:form.category_id,period_month:month,amount:Number(form.amount)}),onSuccess:async()=>{await Promise.all([qc.invalidateQueries({queryKey:['budgets']}),qc.invalidateQueries({queryKey:['dashboard']})]);setOpen(false)}})
  const submit=(e:FormEvent)=>{e.preventDefault();if(form.category_id&&Number(form.amount)>0)mutation.mutate()}
  return <main className="page"><div className="flex items-end justify-between"><div><h1 className="page-title">Budget</h1><p className="page-subtitle">Batas pengeluaran kategori untuk bulan berjalan.</p></div>{canManage&&<Button onClick={()=>setOpen(true)}><Plus className="h-4 w-4"/>Budget</Button>}</div>
    {budgets.isLoading?<LoadingState/>:<div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{budgets.data?.length?budgets.data.map(b=>{const ratio=Math.min(100,Math.round(((b.actual??0)/b.amount)*100));return <Card key={b.id}><CardContent className="pt-5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100"><Target className="h-5 w-5"/></div><div><p className="font-semibold">{b.category?.name??'Kategori'}</p><p className="text-xs text-slate-400">{ratio}% terpakai</p></div></div><p className="mt-5 text-xl font-bold">{formatCurrency(b.actual??0)} <span className="text-sm font-medium text-slate-400">/ {formatCurrency(b.amount)}</span></p><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${ratio>=100?'bg-red-600':ratio>=90?'bg-amber-500':'bg-slate-900'}`} style={{width:`${ratio}%`}}/></div></CardContent></Card>}):<div className="sm:col-span-2 xl:col-span-3"><EmptyState title="Belum ada budget" description="Tetapkan budget bulanan per kategori."/></div>}</div>}
    <Dialog open={open} onOpenChange={setOpen} title="Atur budget"><form className="space-y-4" onSubmit={submit}><label><span className="field-label">Kategori</span><Select value={form.category_id} onChange={e=>setForm({...form,category_id:e.target.value})} required><option value="">Pilih kategori</option>{categories.data?.filter(c=>c.transaction_type!=='INCOME').map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select></label><label><span className="field-label">Budget bulanan</span><Input type="number" min="1" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} required/></label><div className="flex justify-end gap-2"><Button variant="outline" type="button" onClick={()=>setOpen(false)}>Batal</Button><Button disabled={mutation.isPending}>Simpan</Button></div></form></Dialog>
  </main>
}
