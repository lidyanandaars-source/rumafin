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
import { groupReceiptItemsByCategory } from './receipt-utils'

interface ReceiptDuplicateCandidate {
  id: string
  merchant_name: string | null
  description: string | null
  total_amount: number
  transaction_at: string
}

type ReceiptExtractionItem = ReceiptExtraction['items'][number] & {
  suggested_category_id?: string | null
  suggested_category_name?: string | null
  category_needs_review?: boolean
}

type ExtractionResult = Omit<ReceiptExtraction, 'items'> & {
  items: ReceiptExtractionItem[]
  receipt_id: string
  storage_path: string
  overall_confidence: number
  needs_review: boolean
  manual_entry_required: boolean
  arithmetic_issue: boolean
  duplicate_candidates: ReceiptDuplicateCandidate[]
  suggested_account_id: string | null
  suggested_category_id: string | null
  ai?: {
    provider?: string | null
    model?: string | null
    routing?: string[]
    failures?: string[]
  }
}

interface ReviewItem {
  name: string
  amount: number
  categoryId: string
  categoryHint: string | null
  categoryNeedsReview: boolean
}

async function optimizeReceiptFile(file: File): Promise<File> {
  if (file.type === 'application/pdf' || !file.type.startsWith('image/')) return file
  try {
    const bitmap = await createImageBitmap(file)
    const maxDimension = 2400
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size <= 3 * 1024 * 1024) {
      bitmap.close()
      return file
    }
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) {
      bitmap.close()
      return file
    }
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
  const { householdId } = useHousehold()
  const { user } = useAuth()
  const qc = useQueryClient()
  const accounts = useQuery({
    queryKey: ['accounts', householdId],
    queryFn: () => listAccounts(householdId!),
    enabled: open && Boolean(householdId),
  })
  const categories = useQuery({
    queryKey: ['categories', householdId],
    queryFn: () => listCategories(householdId!),
    enabled: open && Boolean(householdId),
  })

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null)
  const [itemSplitMode, setItemSplitMode] = useState(false)
  const [itemSplits, setItemSplits] = useState<ReviewItem[]>([])
  const [form, setForm] = useState({ merchant: '', date: '', total: '', accountId: '', categoryId: '', description: '' })

  const reviewFields = useMemo(
    () => extraction
      ? [extraction.merchant, extraction.transaction_date, extraction.total, extraction.payment_method]
          .filter((field) => field.needs_review).length
      : 0,
    [extraction],
  )
  const itemSplitTotal = useMemo(() => itemSplits.reduce((sum, item) => sum + Number(item.amount || 0), 0), [itemSplits])
  const receiptTotal = Number(form.total)
  const canItemSplit = Boolean(
    extraction &&
      Number.isFinite(receiptTotal) &&
      receiptTotal > 0 &&
      itemSplits.length > 1 &&
      itemSplits.length === extraction.items.filter((item) => item.total != null && Number(item.total) > 0).length &&
      itemSplits.every((item) => Number.isFinite(item.amount) && item.amount > 0) &&
      Math.abs(itemSplitTotal - receiptTotal) <= 1,
  )
  const transactionGroups = useMemo(
    () => groupReceiptItemsByCategory(itemSplits.map(({ name, amount, categoryId }) => ({ name, amount, categoryId }))),
    [itemSplits],
  )
  const categoryNameById = useMemo(
    () => new Map((categories.data ?? []).map((category) => [category.id, category.name])),
    [categories.data],
  )

  function reset() {
    setBusy(false)
    setError(null)
    setFileName('')
    setExtraction(null)
    setItemSplitMode(false)
    setItemSplits([])
    setForm({ merchant: '', date: '', total: '', accountId: '', categoryId: '', description: '' })
  }

  function close(value: boolean) {
    if (!value) reset()
    onOpenChange(value)
  }

  async function handleFile(file: File | undefined, captureSource: 'UPLOAD' | 'CAMERA') {
    if (!file || !householdId || !user) return
    if (!navigator.onLine) {
      setError('Receipt AI membutuhkan koneksi internet.')
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) {
      setError('Gunakan JPG, PNG, WEBP, atau PDF.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Ukuran file maksimum 10 MB.')
      return
    }

    setBusy(true)
    setError(null)
    setFileName(file.name)
    try {
      const optimized = await optimizeReceiptFile(file)
      if (optimized.size > 10 * 1024 * 1024) throw new Error('Receipt masih melebihi 10 MB setelah optimasi.')

      const ext = optimized.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${householdId}/${user.id}/${crypto.randomUUID()}.${ext}`
      const client = requireSupabase()
      const { error: uploadError } = await client.storage
        .from('receipts')
        .upload(path, optimized, { contentType: optimized.type, upsert: false })
      if (uploadError) throw uploadError

      const result = await invokeEdge<ExtractionResult>('receipt-extract', {
        household_id: householdId,
        storage_path: path,
        mime_type: optimized.type,
        original_filename: file.name,
        stored_filename: optimized.name,
        file_size_bytes: optimized.size,
        capture_source: captureSource,
      })

      const usableItems: ReviewItem[] = result.items
        .filter((item) => item.total != null && Number(item.total) > 0)
        .map((item) => ({
          name: item.name ?? 'Item receipt',
          amount: Number(item.total),
          categoryId: item.suggested_category_id ?? '',
          categoryHint: item.category_hint?.value ?? null,
          categoryNeedsReview: Boolean(item.category_needs_review),
        }))
      const extractedTotal = Number(result.total.value ?? 0)
      const extractedItemTotal = usableItems.reduce((sum, item) => sum + item.amount, 0)
      const autoSplit = usableItems.length > 1 && extractedTotal > 0 && Math.abs(extractedItemTotal - extractedTotal) <= 1

      setExtraction(result)
      setForm({
        merchant: result.merchant.value ?? '',
        date: result.transaction_date.value ?? '',
        total: result.total.value?.toString() ?? '',
        accountId: result.suggested_account_id ?? '',
        categoryId: result.suggested_category_id ?? '',
        description: result.merchant.value ? `Belanja di ${result.merchant.value}` : '',
      })
      setItemSplits(usableItems)
      setItemSplitMode(autoSplit)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Receipt gagal diproses.')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!extraction?.receipt_id || !householdId) return
    const total = Number(form.total)
    if (!form.date || !form.accountId || !Number.isFinite(total) || total <= 0) {
      setError('Tanggal, nominal, dan akun wajib diperiksa.')
      return
    }

    let payloads: Array<Record<string, unknown>> = []
    if (itemSplitMode) {
      if (!canItemSplit) {
        setError('Total item harus sama dengan total receipt sebelum transaksi dapat dipisahkan.')
        return
      }
      if (itemSplits.some((item) => !item.categoryId)) {
        setError('Pilih kategori untuk setiap item receipt yang akan dipisahkan.')
        return
      }
      const groups = groupReceiptItemsByCategory(itemSplits.map(({ name, amount, categoryId }) => ({ name, amount, categoryId })))
      if (!groups.length) {
        setError('Belum ada transaksi receipt yang dapat dibuat.')
        return
      }
      payloads = groups.map((group) => {
        const itemDescription = group.itemNames.join(', ')
        return {
          household_id: householdId,
          transaction_type: 'EXPENSE',
          transaction_at: `${form.date}T12:00:00+07:00`,
          timezone: 'Asia/Jakarta',
          merchant_name: form.merchant || null,
          description: itemDescription || form.description || null,
          total_amount: group.amount,
          currency: 'IDR',
          source: 'RECEIPT',
          splits: [{ category_id: group.categoryId, amount: group.amount, description: itemDescription || null }],
          movements: [{ account_id: form.accountId, amount: -group.amount }],
          idempotency_key: crypto.randomUUID(),
        }
      })
    } else {
      if (!form.categoryId) {
        setError('Kategori wajib dipilih.')
        return
      }
      payloads = [{
        household_id: householdId,
        transaction_type: 'EXPENSE',
        transaction_at: `${form.date}T12:00:00+07:00`,
        timezone: 'Asia/Jakarta',
        merchant_name: form.merchant || null,
        description: form.description || null,
        total_amount: total,
        currency: 'IDR',
        source: 'RECEIPT',
        splits: [{ category_id: form.categoryId, amount: total, description: form.description || null }],
        movements: [{ account_id: form.accountId, amount: -total }],
        idempotency_key: crypto.randomUUID(),
      }]
    }

    setBusy(true)
    setError(null)
    try {
      const client = requireSupabase()
      const { error: rpcError } = await client.rpc('finalize_receipt_transactions', {
        p_receipt_id: extraction.receipt_id,
        p_payloads: payloads,
      })
      if (rpcError) throw rpcError

      await Promise.all([
        qc.invalidateQueries({ queryKey: ['transactions'] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
        qc.invalidateQueries({ queryKey: ['accounts'] }),
        qc.invalidateQueries({ queryKey: ['budgets'] }),
        qc.invalidateQueries({ queryKey: ['reports'] }),
      ])
      close(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal menyimpan receipt.')
    } finally {
      setBusy(false)
    }
  }

  const expenseCategories = categories.data?.filter((category) => category.transaction_type !== 'INCOME') ?? []

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Scan receipt"
      description="Pilih sumber receipt. Field yang tidak jelas akan dikosongkan atau ditandai untuk review."
    >
      <div className="space-y-4">
        {!extraction && (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center transition hover:border-slate-500 hover:bg-slate-100">
              {busy ? (
                <LoaderCircle className="h-10 w-10 animate-spin text-slate-500" />
              ) : (
                <>
                  <Upload className="h-9 w-9" />
                  <p className="mt-4 font-semibold">Upload foto</p>
                  <p className="mt-1 text-xs text-slate-500">Pilih dari galeri atau file</p>
                  <p className="mt-1 text-[11px] text-slate-400">JPG / PNG / WEBP / PDF · maks. 10 MB</p>
                </>
              )}
              <input
                className="hidden"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                disabled={busy}
                onChange={(event) => handleFile(event.target.files?.[0], 'UPLOAD')}
              />
            </label>

            <label className="flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center transition hover:border-slate-500 hover:bg-slate-100">
              {busy ? (
                <LoaderCircle className="h-10 w-10 animate-spin text-slate-500" />
              ) : (
                <>
                  <Camera className="h-9 w-9" />
                  <p className="mt-4 font-semibold">Foto pakai kamera</p>
                  <p className="mt-1 text-xs text-slate-500">Ambil foto receipt langsung</p>
                  <p className="mt-1 text-[11px] text-slate-400">Gunakan kamera belakang agar lebih jelas</p>
                </>
              )}
              <input
                className="hidden"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                disabled={busy}
                onChange={(event) => handleFile(event.target.files?.[0], 'CAMERA')}
              />
            </label>
          </div>
        )}

        {fileName && !extraction && <p className="text-center text-xs text-slate-500">{fileName}</p>}

        {error && (
          <div className="flex gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            {error}
          </div>
        )}

        {extraction && (
          <div className="space-y-4">
            {extraction.manual_entry_required && (
              <div className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <span>AI belum berhasil membaca receipt. Receipt tetap tersimpan; lengkapi data secara manual sebelum menyimpan.</span>
              </div>
            )}

            <div className="flex items-center justify-between rounded-2xl bg-slate-100 p-4">
              <div>
                <p className="text-sm font-semibold">{extraction.manual_entry_required ? 'Review manual receipt' : 'Hasil ekstraksi'}</p>
                <p className="text-xs text-slate-500">
                  Confidence keseluruhan {Math.round(extraction.overall_confidence * 100)}%
                  {extraction.ai?.model ? ` · ${extraction.ai.model}` : ''}
                </p>
              </div>
              <span className={reviewFields ? 'rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800' : 'rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800'}>
                {extraction.manual_entry_required ? 'Isi manual' : reviewFields ? `${reviewFields} field perlu review` : 'Siap direview'}
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <span className="field-label">Merchant {extraction.merchant.needs_review && '⚠'}</span>
                <Input value={form.merchant} onChange={(event) => setForm({ ...form, merchant: event.target.value })} />
              </label>
              <label>
                <span className="field-label">Tanggal {extraction.transaction_date.needs_review && '⚠'}</span>
                <Input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
              </label>
              <label>
                <span className="field-label">Total {extraction.total.needs_review && '⚠'}</span>
                <Input type="number" min="1" value={form.total} onChange={(event) => setForm({ ...form, total: event.target.value })} />
                {Number(form.total) > 0 && <p className="mt-1 text-xs text-slate-400">{formatCurrency(Number(form.total))}</p>}
              </label>
              <label>
                <span className="field-label">Akun / pembayaran {extraction.payment_method.needs_review && '⚠'}</span>
                <Select value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value })}>
                  <option value="">Pilih akun</option>
                  {accounts.data?.filter((account) => account.is_active).map((account) => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </Select>
              </label>
            </div>

            {itemSplits.length > 1 ? (
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">Pisahkan transaksi berdasarkan kategori item</p>
                    <p className="text-xs text-slate-500">
                      Jika aktif, item dengan kategori yang sama digabung menjadi satu transaksi dan kategori berbeda menjadi transaksi terpisah. Total item harus sama dengan total receipt.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setItemSplitMode(!itemSplitMode)}
                    className={`h-7 w-12 rounded-full p-1 transition ${itemSplitMode ? 'bg-slate-950' : 'bg-slate-200'}`}
                    aria-label="Pisahkan transaksi receipt berdasarkan kategori"
                  >
                    <span className={`block h-5 w-5 rounded-full bg-white transition ${itemSplitMode ? 'translate-x-5' : ''}`} />
                  </button>
                </div>

                {itemSplitMode && (
                  <div className="mt-4 space-y-3">
                    {itemSplits.map((item, index) => (
                      <div key={`${item.name}-${index}`} className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_140px_190px] sm:items-end">
                        <div>
                          <p className="text-sm font-semibold">{item.name}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {item.categoryNeedsReview ? 'Kategori perlu dicek' : item.categoryHint ? `AI: ${item.categoryHint}` : 'Kategori hasil pencocokan aplikasi'}
                          </p>
                        </div>
                        <label>
                          <span className="field-label">Nominal</span>
                          <Input
                            type="number"
                            min="1"
                            value={item.amount}
                            onChange={(event) => setItemSplits(itemSplits.map((current, currentIndex) => currentIndex === index ? { ...current, amount: Number(event.target.value) } : current))}
                          />
                        </label>
                        <label>
                          <span className="field-label">Kategori</span>
                          <Select
                            value={item.categoryId}
                            onChange={(event) => setItemSplits(itemSplits.map((current, currentIndex) => currentIndex === index ? { ...current, categoryId: event.target.value } : current))}
                          >
                            <option value="">Pilih kategori</option>
                            {expenseCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                          </Select>
                        </label>
                      </div>
                    ))}

                    <div className={`rounded-xl p-3 text-sm ${Math.abs(itemSplitTotal - receiptTotal) <= 1 ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
                      Total item {formatCurrency(itemSplitTotal)} dari total receipt {Number.isFinite(receiptTotal) ? formatCurrency(receiptTotal) : '—'}.
                    </div>

                    {itemSplits.every((item) => item.categoryId) && transactionGroups.length > 0 && (
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-sm font-semibold">{transactionGroups.length} transaksi akan dibuat</p>
                        <div className="mt-2 space-y-2">
                          {transactionGroups.map((group) => (
                            <div key={group.categoryId} className="flex items-start justify-between gap-3 text-sm">
                              <div>
                                <p className="font-medium">{categoryNameById.get(group.categoryId) ?? 'Kategori'}</p>
                                <p className="text-xs text-slate-500">{group.itemNames.join(', ')}</p>
                              </div>
                              <span className="font-semibold">{formatCurrency(group.amount)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}

            {!itemSplitMode && (
              <label className="block">
                <span className="field-label">Kategori</span>
                <Select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
                  <option value="">Pilih kategori</option>
                  {expenseCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </Select>
              </label>
            )}

            <label className="block">
              <span className="field-label">Deskripsi</span>
              <Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            </label>

            {!!extraction.duplicate_candidates?.length && (
              <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                Possible duplicate detected: {extraction.duplicate_candidates.length} transaksi serupa ditemukan. Periksa sebelum menyimpan.
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setExtraction(null); setItemSplitMode(false); setItemSplits([]) }}>
                Ganti receipt
              </Button>
              <Button className="flex-1" disabled={busy} onClick={save}>
                {busy ? 'Menyimpan…' : itemSplitMode && transactionGroups.length > 1 ? `Simpan ${transactionGroups.length} transaksi` : 'Simpan transaksi'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}
