import { useMemo, useState } from 'react'
import { Camera, Upload, LoaderCircle, AlertTriangle } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useHousehold } from '@/hooks/useHousehold'
import { useAuth } from '@/features/auth/AuthProvider'
import { requireSupabase } from '@/lib/supabase'
import { invokeEdge } from '@/lib/edge'
import { listAccounts } from '@/services/accounts'
import { listCategories } from '@/services/categories'
import type { ReceiptExtraction } from '@/types/domain'
import { formatCurrency } from '@/utils/currency'

interface ExtractionResult extends ReceiptExtraction { suggested_account_id?: string | null; suggested_category_id?: string | null }

async function optimizeReceiptFile(file: File): Promise<File> {
  if (file.type === 'application/pdf' || !file.type.startsWith('image/')) return file
  try {
    const bitmap = await createImageBitmap(file)
    const maxDimension = 2400
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size <= 3 * 1024 * 1024) { bitmap.close(); return file }
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) { bitmap.close(); return file }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!blob || blob.size >= file.size) return file
    const base = file.name.replace(/\.[^.]+$/, '') || 'receipt'
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified })
  } catch {
    return file
  }
}

export function ReceiptDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { householdId } = useHousehold(); const { user } = useAuth(); const qc = useQueryClient()
  const accounts = useQuery({ queryKey: ['accounts', householdId], queryFn: () => listAccounts(householdId!), enabled: open && Boolean(householdId) })
  const categories = useQuery({ queryKey: ['categories', householdId], queryFn: () => listCategories(householdId!), enabled: open && Boolean(householdId) })
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [fileName, setFileName] = useState('')
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null)
  const [itemSplitMode, setItemSplitMode] = useState(false)
  const [itemSplits, setItemSplits] = useState<Array<{ name: string; amount: number; categoryId: string }>>([])
  const [form, setForm] = useState({ merchant: '', date: '', total: '', accountId: '', categoryId: '', description: '' })

  const reviewFields = useMemo(() => extraction ? [extraction.merchant, extraction.transaction_date, extraction.total, extraction.payment_method].filter((f) => f.needs_review).length : 0, [extraction])
  const itemSplitTotal = useMemo(() => itemSplits.reduce((sum, item) => sum + item.amount, 0), [itemSplits])
  const canItemSplit = Boolean(extraction?.total.value && itemSplits.length > 1 && itemSplits.length === extraction.items.length && Math.abs(itemSplitTotal - Number(extraction.total.value)) <= 1)
  function reset() { setBusy(false); setError(null); setFileName(''); setExtraction(null); setItemSplitMode(false); setItemSplits([]); setForm({ merchant: '', date: '', total: '', accountId: '', categoryId: '', description: '' }) }
  function close(v: boolean) { if (!v) reset(); onOpenChange(v) }

  async function handleFile(file?: File) {
    if (!file || !householdId || !user) return
    if (!navigator.onLine) { setError('Receipt AI membutuhkan koneksi internet.'); return }
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) { setError('Gunakan JPG, PNG, WEBP, atau PDF.'); return }
    if (file.size > 10 * 1024 * 1024) { setError('Ukuran file maksimum 10 MB.'); return }
    setBusy(true); setError(null); setFileName(file.name)
    try {
      const optimized = await optimizeReceiptFile(file)
      if (optimized.size > 10 * 1024 * 1024) throw new Error('Receipt masih melebihi 10 MB setelah optimasi.')
      const ext = optimized.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${householdId}/${user.id}/${crypto.randomUUID()}.${ext}`
      const client = requireSupabase()
      const { error: uploadError } = await client.storage.from('receipts').upload(path, optimized, { contentType: optimized.type, upsert: false })
      if (uploadError) throw uploadError
      const result = await invokeEdge<ExtractionResult>('receipt-extract', { household_id: householdId, storage_path: path, mime_type: optimized.type })
      setExtraction(result)
      setForm({
        merchant: result.merchant.value ?? '', date: result.transaction_date.value ?? '', total: result.total.value?.toString() ?? '',
        accountId: result.suggested_account_id ?? '', categoryId: result.suggested_category_id ?? '', description: result.merchant.value ? `Belanja di ${result.merchant.value}` : '',
      })
      setItemSplits(result.items.filter((i) => i.total != null && Number(i.total) > 0).map((i) => ({ name: i.name ?? 'Item receipt', amount: Number(i.total), categoryId: result.suggested_category_id ?? '' })))
      setItemSplitMode(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'Receipt gagal diproses.') }
    finally { setBusy(false) }
  }

  async function save() {
    if (!extraction?.receipt_id || !householdId) return
    const total = Number(form.total)
    if (!form.date || !form.accountId || (!itemSplitMode && !form.categoryId) || !Number.isFinite(total) || total <= 0) { setError('Tanggal, nominal, akun, dan kategori wajib diperiksa.'); return }
    if (itemSplitMode && (!canItemSplit || itemSplits.some((item) => !item.categoryId))) { setError('Semua item split harus memiliki kategori dan total item harus sama dengan total receipt.'); return }
    const txSplits = itemSplitMode
      ? itemSplits.map((item) => ({ category_id: item.categoryId, amount: item.amount, description: item.name }))
      : [{ category_id: form.categoryId, amount: total, description: form.description || null }]
    setBusy(true); setError(null)
    try {
      const client = requireSupabase()
      const { error: rpcError } = await client.rpc('finalize_receipt_transaction', { p_receipt_id: extraction.receipt_id, p_payload: {
        household_id: householdId, transaction_type: 'EXPENSE', transaction_at: `${form.date}T12:00:00+07:00`, timezone: 'Asia/Jakarta', merchant_name: form.merchant || null,
        description: form.description || null, total_amount: total, currency: 'IDR', source: 'RECEIPT', splits: txSplits, movements: [{ account_id: form.accountId, amount: -total }], idempotency_key: crypto.randomUUID(),
      } })
      if (rpcError) throw rpcError
      await Promise.all([qc.invalidateQueries({ queryKey: ['transactions'] }), qc.invalidateQueries({ queryKey: ['dashboard'] }), qc.invalidateQueries({ queryKey: ['accounts'] })])
      close(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'Gagal menyimpan receipt.') }
    finally { setBusy(false) }
  }

  return <Dialog open={open} onOpenChange={close} title="Scan receipt" description="Field yang tidak jelas akan dikosongkan atau ditandai untuk review.">
    <div className="space-y-4">
      {!extraction && <label className="flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center hover:border-slate-500">
        {busy ? <LoaderCircle className="h-10 w-10 animate-spin text-slate-500"/> : <><div className="flex gap-2"><Camera className="h-9 w-9"/><Upload className="h-9 w-9"/></div><p className="mt-4 font-semibold">Camera, gallery, atau file</p><p className="mt-1 text-xs text-slate-500">JPG / PNG / WEBP / PDF · maks. 10 MB</p></>}
        <input className="hidden" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" disabled={busy} onChange={(e) => handleFile(e.target.files?.[0])}/>
      </label>}
      {fileName && !extraction && <p className="text-center text-xs text-slate-500">{fileName}</p>}
      {error && <div className="flex gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700"><AlertTriangle className="h-5 w-5 shrink-0"/>{error}</div>}
      {extraction && <div className="space-y-4">
        <div className="flex items-center justify-between rounded-2xl bg-slate-100 p-4"><div><p className="text-sm font-semibold">Hasil ekstraksi</p><p className="text-xs text-slate-500">Confidence keseluruhan {Math.round(extraction.overall_confidence * 100)}%</p></div><span className={reviewFields ? 'rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800' : 'rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800'}>{reviewFields ? `${reviewFields} field perlu review` : 'Siap direview'}</span></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label><span className="field-label">Merchant {extraction.merchant.needs_review && '⚠'}</span><Input value={form.merchant} onChange={(e) => setForm({ ...form, merchant: e.target.value })}/></label>
          <label><span className="field-label">Tanggal {extraction.transaction_date.needs_review && '⚠'}</span><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}/></label>
          <label><span className="field-label">Total {extraction.total.needs_review && '⚠'}</span><Input type="number" min="1" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })}/>{Number(form.total) > 0 && <p className="mt-1 text-xs text-slate-400">{formatCurrency(Number(form.total))}</p>}</label>
          <label><span className="field-label">Akun / pembayaran {extraction.payment_method.needs_review && '⚠'}</span><Select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}><option value="">Pilih akun</option>{accounts.data?.filter(a => a.is_active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></label>
          <label className="sm:col-span-2"><span className="field-label">Kategori</span><Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}><option value="">Pilih kategori</option>{categories.data?.filter(c => c.transaction_type !== 'INCOME').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></label>
          {extraction.items.length > 1 && <div className="sm:col-span-2 rounded-2xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">Split berdasarkan item receipt</p><p className="text-xs text-slate-500">{canItemSplit ? 'Total item cocok dengan total receipt; tiap item dapat dikategorikan terpisah.' : 'Split item dinonaktifkan karena item tidak lengkap atau total item tidak sama dengan total receipt.'}</p></div><button type="button" disabled={!canItemSplit} onClick={() => setItemSplitMode(!itemSplitMode)} className={`h-7 w-12 rounded-full p-1 transition disabled:opacity-40 ${itemSplitMode?'bg-slate-950':'bg-slate-200'}`}><span className={`block h-5 w-5 rounded-full bg-white transition ${itemSplitMode?'translate-x-5':''}`}/></button></div>{itemSplitMode && <div className="mt-4 space-y-2">{itemSplits.map((item,index)=><div key={`${item.name}-${index}`} className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_180px]"><div><p className="text-sm font-semibold">{item.name}</p><p className="text-xs text-slate-500">{formatCurrency(item.amount)}</p></div><Select value={item.categoryId} onChange={(e)=>setItemSplits(itemSplits.map((x,i)=>i===index?{...x,categoryId:e.target.value}:x))}><option value="">Pilih kategori</option>{categories.data?.filter(c => c.transaction_type !== 'INCOME').map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>)}</div>}</div>}
          <label className="sm:col-span-2"><span className="field-label">Deskripsi</span><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}/></label>
        </div>
        {!!extraction.duplicate_candidates?.length && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Possible duplicate detected: {extraction.duplicate_candidates.length} transaksi serupa ditemukan. Periksa sebelum menyimpan.</div>}
        <div className="flex gap-2"><Button variant="outline" className="flex-1" onClick={() => setExtraction(null)}>Ganti receipt</Button><Button className="flex-1" disabled={busy} onClick={save}>{busy ? 'Menyimpan…' : 'Simpan transaksi'}</Button></div>
      </div>}
    </div>
  </Dialog>
}
