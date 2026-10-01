import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Landmark, Plus, Archive } from 'lucide-react'
import { useHousehold } from '@/hooks/useHousehold'
import { archiveAccount, listAccounts, saveAccount } from '@/services/accounts'
import type { AccountType } from '@/types/domain'
import { formatCurrency } from '@/utils/currency'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { EmptyState, LoadingState } from '@/components/ui/status'

export function AccountsPage() {
  const { householdId, household, role } = useHousehold(); const qc = useQueryClient(); const canManage = role === 'OWNER' || role === 'ADMIN'
  const [open, setOpen] = useState(false); const [form, setForm] = useState({ name: '', account_type: 'CASH' as AccountType, opening_balance: '0' }); const [error, setError] = useState<string | null>(null)
  const query = useQuery({ queryKey: ['accounts', householdId], queryFn: () => listAccounts(householdId!), enabled: Boolean(householdId) })
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['accounts'] }), qc.invalidateQueries({ queryKey: ['dashboard'] })])
  const create = useMutation({ mutationFn: () => saveAccount({ household_id: householdId!, name: form.name.trim(), account_type: form.account_type, currency: household?.default_currency ?? 'IDR', opening_balance: Number(form.opening_balance) || 0 }), onSuccess: async () => { await refresh(); setOpen(false); setForm({ name: '', account_type: 'CASH', opening_balance: '0' }) } })
  const archive = useMutation({ mutationFn: archiveAccount, onSuccess: refresh })
  const submit = (e: FormEvent) => { e.preventDefault(); setError(null); if (!form.name.trim()) return; if (!Number.isFinite(Number(form.opening_balance))) { setError('Saldo awal tidak valid.'); return } create.mutate() }

  return <main className="page"><div className="flex items-end justify-between"><div><h1 className="page-title">Akun</h1><p className="page-subtitle">Cash, bank, e-wallet, kartu kredit, dan tabungan.</p></div>{canManage && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4"/>Akun</Button>}</div>
    {query.isLoading ? <LoadingState/> : <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{query.data?.length ? query.data.map(a => <Card key={a.id} className={!a.is_active ? 'opacity-50' : ''}><CardContent className="pt-5"><div className="flex items-start justify-between"><div className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100"><Landmark className="h-5 w-5"/></div><span className="text-xs font-semibold text-slate-400">{a.account_type}</span></div><p className="mt-5 font-semibold">{a.name}</p><p className="mt-1 text-2xl font-bold">{formatCurrency(a.current_balance ?? a.opening_balance, a.currency)}</p><p className="mt-2 text-xs text-slate-400">Saldo awal {formatCurrency(a.opening_balance, a.currency)}</p>{canManage && a.is_active && <Button className="mt-4" size="sm" variant="ghost" onClick={() => { if(window.confirm('Arsipkan akun? Riwayat transaksi tetap dipertahankan.')) archive.mutate(a.id) }}><Archive className="h-4 w-4"/>Arsipkan</Button>}</CardContent></Card>) : <div className="sm:col-span-2 xl:col-span-3"><EmptyState title="Belum ada akun" description="Tambahkan Cash atau rekening pertama."/></div>}</div>}
    <Dialog open={open} onOpenChange={setOpen} title="Tambah akun"><form className="space-y-4" onSubmit={submit}><label><span className="field-label">Nama</span><Input value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} placeholder="BCA, Cash Hendra, GoPay" required/></label><label><span className="field-label">Tipe</span><Select value={form.account_type} onChange={(e)=>setForm({...form,account_type:e.target.value as AccountType})}>{['CASH','BANK','EWALLET','CREDIT_CARD','SAVINGS','OTHER'].map(t=><option key={t}>{t}</option>)}</Select></label><label><span className="field-label">Saldo awal</span><Input type="number" value={form.opening_balance} onChange={(e)=>setForm({...form,opening_balance:e.target.value})}/></label>{error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={()=>setOpen(false)}>Batal</Button><Button disabled={create.isPending}>Simpan</Button></div></form></Dialog>
  </main>
}
