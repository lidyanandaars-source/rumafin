import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, LoaderCircle, WifiOff, Plus, Trash2 } from 'lucide-react'
import { useHousehold } from '@/hooks/useHousehold'
import { listAccounts } from '@/services/accounts'
import { listCategories } from '@/services/categories'
import { createTransaction, updateTransaction, type TransactionWriteInput } from '@/services/transactions'
import { queueOfflineDraft } from '@/services/offline'
import { requireSupabase } from '@/lib/supabase'
import { transactionFormSchema } from '@/schemas/transaction'
import { currentTimeLocal, dateTimeInputParts, todayLocal } from '@/utils/date'
import { formatCurrency } from '@/utils/currency'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'

interface FormState { transaction_type: 'EXPENSE' | 'INCOME' | 'TRANSFER'; total_amount: string; transaction_date: string; transaction_time: string; account_id: string; destination_account_id: string; category_id: string; merchant_name: string; description: string; notes: string }
const initial: FormState = { transaction_type: 'EXPENSE', total_amount: '', transaction_date: todayLocal(), transaction_time: currentTimeLocal(), account_id: '', destination_account_id: '', category_id: '', merchant_name: '', description: '', notes: '' }

export function TransactionFormPage() {
  const { id } = useParams(); const editing = Boolean(id); const navigate = useNavigate(); const qc = useQueryClient(); const { householdId, household } = useHousehold()
  const [form, setForm] = useState<FormState>(initial); const [error, setError] = useState<string | null>(null)
  const [splitMode, setSplitMode] = useState(false)
  const [splits, setSplits] = useState<Array<{ category_id: string; amount: string; description: string }>>([])
  const accounts = useQuery({ queryKey: ['accounts', householdId], queryFn: () => listAccounts(householdId!), enabled: Boolean(householdId) })
  const categories = useQuery({ queryKey: ['categories', householdId], queryFn: () => listCategories(householdId!), enabled: Boolean(householdId) })
  const tx = useQuery({ queryKey: ['transaction', id], queryFn: async () => { const { data, error: e } = await requireSupabase().from('transactions').select('*,splits:transaction_splits(*),movements:account_movements(*)').eq('id', id!).single(); if (e) throw e; return data }, enabled: editing })

  useEffect(() => {
    if (!tx.data) return
    const t = tx.data as any
    const dt = dateTimeInputParts(t.transaction_at, t.timezone ?? household?.timezone ?? 'Asia/Jakarta')
    const movements = t.movements as Array<{ account_id: string; amount: number }>
    const debit = movements.find(m => Number(m.amount) < 0); const credit = movements.find(m => Number(m.amount) > 0)
    setForm({ transaction_type: t.transaction_type, total_amount: String(t.total_amount), transaction_date: dt.date, transaction_time: dt.time, account_id: t.transaction_type === 'INCOME' ? (credit?.account_id ?? '') : (debit?.account_id ?? ''), destination_account_id: t.transaction_type === 'TRANSFER' ? (credit?.account_id ?? '') : '', category_id: t.splits?.[0]?.category_id ?? '', merchant_name: t.merchant_name ?? '', description: t.description ?? '', notes: t.notes ?? '' })
    const existingSplits = (t.splits ?? []).map((sp: any) => ({ category_id: sp.category_id ?? '', amount: String(sp.amount ?? ''), description: sp.description ?? '' }))
    setSplits(existingSplits)
    setSplitMode(existingSplits.length > 1)
  }, [tx.data])

  useEffect(() => { if (!form.account_id && accounts.data?.[0]) setForm((f) => ({ ...f, account_id: accounts.data![0]!.id })) }, [accounts.data, form.account_id])
  const visibleCategories = useMemo(() => categories.data?.filter(c => form.transaction_type === 'INCOME' ? c.transaction_type !== 'EXPENSE' : c.transaction_type !== 'INCOME') ?? [], [categories.data, form.transaction_type])

  const mutation = useMutation({
    mutationFn: async (payload: TransactionWriteInput) => editing ? updateTransaction({ ...payload, id: id! }) : createTransaction(payload),
    onSuccess: async () => { await Promise.all([qc.invalidateQueries({ queryKey: ['transactions'] }), qc.invalidateQueries({ queryKey: ['dashboard'] }), qc.invalidateQueries({ queryKey: ['accounts'] })]); navigate('/transactions') },
  })

  function buildPayload(): TransactionWriteInput | null {
    const effectiveCategory = splitMode ? (splits[0]?.category_id || null) : (form.category_id || null)
    const values = { transaction_type: form.transaction_type, total_amount: Number(form.total_amount), currency: household?.default_currency ?? 'IDR', transaction_date: form.transaction_date, transaction_time: form.transaction_time, account_id: form.account_id || null, destination_account_id: form.destination_account_id || null, category_id: effectiveCategory, merchant_name: form.merchant_name || null, description: form.description || null, notes: form.notes || null }
    const parsed = transactionFormSchema.safeParse(values)
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Periksa kembali form.'); return null }
    const amount = parsed.data.total_amount
    let normalizedSplits: Array<{ category_id: string; amount: number; description: string | null }> = []
    if (parsed.data.transaction_type !== 'TRANSFER') {
      if (splitMode) {
        normalizedSplits = splits.map((sp) => ({ category_id: sp.category_id, amount: Number(sp.amount), description: sp.description || null }))
        if (!normalizedSplits.length || normalizedSplits.some((sp) => !sp.category_id || !Number.isFinite(sp.amount) || sp.amount <= 0)) { setError('Setiap split harus memiliki kategori dan nominal yang valid.'); return null }
        const splitSum = normalizedSplits.reduce((sum, sp) => sum + sp.amount, 0)
        if (Math.abs(splitSum - amount) > 0.001) { setError(`Total split harus sama dengan nominal transaksi (${formatCurrency(amount)}). Saat ini ${formatCurrency(splitSum)}.`); return null }
      } else {
        normalizedSplits = [{ category_id: parsed.data.category_id!, amount, description: parsed.data.description ?? null }]
      }
    }
    const movements = parsed.data.transaction_type === 'TRANSFER'
      ? [{ account_id: parsed.data.account_id!, amount: -amount }, { account_id: parsed.data.destination_account_id!, amount }]
      : [{ account_id: parsed.data.account_id!, amount: parsed.data.transaction_type === 'INCOME' ? amount : -amount }]
    return { household_id: householdId!, transaction_type: parsed.data.transaction_type, transaction_at: `${parsed.data.transaction_date}T${parsed.data.transaction_time}:00+07:00`, timezone: household?.timezone ?? 'Asia/Jakarta', merchant_name: parsed.data.merchant_name, description: parsed.data.description, notes: parsed.data.notes, total_amount: amount, currency: parsed.data.currency, source: 'MANUAL', splits: normalizedSplits, movements, idempotency_key: crypto.randomUUID() }
  }

  function submit(e: FormEvent) {
    e.preventDefault(); setError(null); const payload = buildPayload(); if (!payload) return
    if (!navigator.onLine && !editing) { queueOfflineDraft(payload); navigate('/transactions'); return }
    if (!navigator.onLine && editing) { setError('Edit transaksi membutuhkan koneksi agar perubahan tidak konflik.'); return }
    mutation.mutate(payload)
  }

  return <main className="page max-w-4xl">
    <button className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-900" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4"/>Kembali</button>
    <h1 className="page-title">{editing ? 'Edit transaksi' : 'Tambah transaksi manual'}</h1><p className="page-subtitle">Semua nominal akan divalidasi dan disimpan atomik ke transaction, split, movement, dan audit log.</p>
    <form onSubmit={submit} className="mt-6"><Card><CardContent className="grid gap-5 pt-5 sm:grid-cols-2">
      <div className="sm:col-span-2"><span className="field-label">Tipe transaksi</span><div className="grid grid-cols-3 gap-2">{(['EXPENSE','INCOME','TRANSFER'] as const).map(type => <button type="button" key={type} onClick={() => setForm({ ...form, transaction_type: type, category_id: type === 'TRANSFER' ? '' : form.category_id })} className={`rounded-xl border px-3 py-3 text-sm font-semibold ${form.transaction_type === type ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white'}`}>{type === 'EXPENSE' ? 'Pengeluaran' : type === 'INCOME' ? 'Pemasukan' : 'Transfer'}</button>)}</div></div>
      <label className="sm:col-span-2"><span className="field-label">Nominal</span><Input inputMode="numeric" type="number" min="1" step="1" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} placeholder="85000" required/>{Number(form.total_amount) > 0 && <p className="mt-1 text-xs text-slate-400">{formatCurrency(Number(form.total_amount))}</p>}</label>
      <label><span className="field-label">Tanggal</span><Input type="date" value={form.transaction_date} onChange={(e) => setForm({ ...form, transaction_date: e.target.value })} required/></label>
      <label><span className="field-label">Waktu</span><Input type="time" value={form.transaction_time} onChange={(e) => setForm({ ...form, transaction_time: e.target.value })} required/></label>
      <label><span className="field-label">{form.transaction_type === 'INCOME' ? 'Masuk ke akun' : form.transaction_type === 'TRANSFER' ? 'Dari akun' : 'Bayar dari akun'}</span><Select value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })} required><option value="">Pilih akun</option>{accounts.data?.filter(a=>a.is_active).map(a => <option key={a.id} value={a.id}>{a.name} · {formatCurrency(a.current_balance, a.currency)}</option>)}</Select></label>
      {form.transaction_type === 'TRANSFER' ? <label><span className="field-label">Ke akun</span><Select value={form.destination_account_id} onChange={(e) => setForm({ ...form, destination_account_id: e.target.value })} required><option value="">Pilih akun tujuan</option>{accounts.data?.filter(a=>a.is_active && a.id !== form.account_id).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></label> : <label><span className="field-label">Kategori utama</span><Select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} disabled={splitMode} required={!splitMode}><option value="">Pilih kategori</option>{visibleCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></label>}
      {form.transaction_type !== 'TRANSFER' && <div className="sm:col-span-2 rounded-2xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">Split kategori</p><p className="text-xs text-slate-500">Gunakan jika satu transaksi mencakup beberapa kategori.</p></div><button type="button" onClick={() => { const next=!splitMode; setSplitMode(next); if(next && splits.length===0) setSplits([{ category_id: form.category_id, amount: form.total_amount, description: form.description }]) }} className={`h-7 w-12 rounded-full p-1 transition ${splitMode?'bg-slate-950':'bg-slate-200'}`}><span className={`block h-5 w-5 rounded-full bg-white transition ${splitMode?'translate-x-5':''}`}/></button></div>{splitMode && <div className="mt-4 space-y-3">{splits.map((sp,index)=><div key={index} className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_150px_auto]"><Select value={sp.category_id} onChange={e=>setSplits(splits.map((x,i)=>i===index?{...x,category_id:e.target.value}:x))}><option value="">Pilih kategori</option>{visibleCategories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select><Input type="number" min="1" value={sp.amount} onChange={e=>setSplits(splits.map((x,i)=>i===index?{...x,amount:e.target.value}:x))} placeholder="Nominal"/><Button type="button" size="icon" variant="ghost" onClick={()=>setSplits(splits.filter((_,i)=>i!==index))}><Trash2 className="h-4 w-4 text-red-600"/></Button><Input className="sm:col-span-3" value={sp.description} onChange={e=>setSplits(splits.map((x,i)=>i===index?{...x,description:e.target.value}:x))} placeholder="Keterangan split (opsional)"/></div>)}<Button type="button" size="sm" variant="outline" onClick={()=>setSplits([...splits,{category_id:'',amount:'',description:''}])}><Plus className="h-4 w-4"/>Tambah split</Button><p className="text-xs text-slate-500">Total split: {formatCurrency(splits.reduce((sum,sp)=>sum+(Number(sp.amount)||0),0))}</p></div>}</div>}
      <label><span className="field-label">Merchant</span><Input value={form.merchant_name} onChange={(e) => setForm({ ...form, merchant_name: e.target.value })} placeholder="Opsional"/></label>
      <label><span className="field-label">Deskripsi</span><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Makan siang, gaji, dll."/></label>
      <label className="sm:col-span-2"><span className="field-label">Catatan</span><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Opsional"/></label>
      {error && <div className="sm:col-span-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {!navigator.onLine && !editing && <div className="sm:col-span-2 flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><WifiOff className="h-5 w-5"/>Offline: transaksi akan disimpan sebagai draft lokal dan disinkronkan saat online.</div>}
      <div className="sm:col-span-2 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => navigate(-1)}>Batal</Button><Button type="submit" disabled={mutation.isPending || tx.isLoading}>{mutation.isPending && <LoaderCircle className="h-4 w-4 animate-spin"/>}{editing ? 'Simpan perubahan' : navigator.onLine ? 'Simpan transaksi' : 'Simpan draft'}</Button></div>
    </CardContent></Card></form>
  </main>
}
