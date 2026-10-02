import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Download, ExternalLink, FileText, Image as ImageIcon, LoaderCircle, ReceiptText, Store, WalletCards } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { Transaction } from '@/types/domain'
import { formatCurrency } from '@/utils/currency'
import { formatDateId } from '@/utils/date'
import { createReceiptPreviewUrl, downloadReceipt, getReceiptForTransaction } from '@/services/receipts'
import { getTransactionById } from '@/services/transactions'

function formatBytes(value: number | null | undefined) {
  if (!value || value <= 0) return 'Tidak diketahui'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(2)} MB`
}

function captureLabel(value: 'UPLOAD' | 'CAMERA' | null | undefined) {
  if (value === 'CAMERA') return 'Foto dari kamera'
  if (value === 'UPLOAD') return 'Upload foto/file'
  return 'Receipt tersimpan'
}

export function TransactionDetailDialog({
  transaction,
  open,
  onOpenChange,
}: {
  transaction: Transaction | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const transactionId = transaction?.id ?? ''

  const transactionQuery = useQuery({
    queryKey: ['transaction-detail', transactionId],
    queryFn: () => getTransactionById(transactionId),
    enabled: open && Boolean(transactionId),
  })

  const receiptQuery = useQuery({
    queryKey: ['transaction-receipt', transactionId],
    queryFn: () => getReceiptForTransaction(transactionId),
    enabled: open && Boolean(transactionId),
  })
  const receipt = receiptQuery.data

  const previewQuery = useQuery({
    queryKey: ['receipt-preview', receipt?.storage_path],
    queryFn: () => createReceiptPreviewUrl(receipt!.storage_path),
    enabled: open && Boolean(receipt?.storage_path),
    staleTime: 8 * 60 * 1000,
  })

  async function handleDownload() {
    if (!receipt) return
    setDownloading(true)
    setDownloadError(null)
    try {
      await downloadReceipt(receipt)
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Gagal mengunduh receipt.')
    } finally {
      setDownloading(false)
    }
  }

  if (!transaction) return null
  const detail = transactionQuery.data ?? transaction

  const accountNames = detail.movements?.map((movement) => movement.account?.name).filter(Boolean) ?? []
  const categories = detail.splits?.map((split) => split.category?.name).filter(Boolean) ?? []
  const isImage = Boolean(receipt?.mime_type?.startsWith('image/'))
  const isPdf = receipt?.mime_type === 'application/pdf'

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Detail transaksi"
      description="Informasi transaksi dan bukti receipt terkait."
      className="md:max-w-2xl"
    >
      <div className="space-y-5">
        <div className="rounded-2xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-lg font-bold">{detail.merchant_name || detail.description || detail.transaction_type}</h3>
                <Badge>{detail.source}</Badge>
                <Badge>{detail.transaction_type}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">{formatDateId(detail.transaction_at)}</p>
            </div>
            <p className={`text-xl font-bold ${detail.transaction_type === 'INCOME' ? 'text-emerald-600' : ''}`}>
              {detail.transaction_type === 'INCOME' ? '+' : detail.transaction_type === 'EXPENSE' ? '−' : ''}
              {formatCurrency(detail.total_amount, detail.currency)}
            </p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Akun</p>
              <p className="mt-1 text-sm font-semibold">{accountNames.join(', ') || 'Tidak tersedia'}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Kategori</p>
              <p className="mt-1 text-sm font-semibold">{categories.join(', ') || 'Tidak tersedia'}</p>
            </div>
          </div>
          {detail.description && <p className="mt-4 text-sm text-slate-600"><strong>Deskripsi:</strong> {detail.description}</p>}
          {detail.notes && <p className="mt-2 text-sm text-slate-600"><strong>Catatan:</strong> {detail.notes}</p>}
        </div>

        <section className="rounded-2xl border border-slate-200 p-4">
          <div className="flex items-center gap-2">
            <ReceiptText className="h-5 w-5" />
            <div>
              <h3 className="font-bold">Bukti receipt</h3>
              <p className="text-xs text-slate-500">Receipt scan disimpan di private storage bersama transaksi.</p>
            </div>
          </div>

          {receiptQuery.isLoading ? (
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Memuat receipt…
            </div>
          ) : receiptQuery.error ? (
            <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{receiptQuery.error.message}</div>
          ) : !receipt ? (
            <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
              Transaksi ini tidak memiliki file receipt yang terhubung.
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex gap-3 rounded-xl bg-slate-50 p-3">
                  {isImage ? <ImageIcon className="mt-0.5 h-5 w-5 text-slate-500" /> : <FileText className="mt-0.5 h-5 w-5 text-slate-500" />}
                  <div className="min-w-0">
                    <p className="text-xs text-slate-400">File</p>
                    <p className="truncate text-sm font-semibold" title={receipt.original_filename ?? receipt.stored_filename ?? undefined}>{receipt.original_filename || receipt.stored_filename || 'Receipt'}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{receipt.mime_type || 'Tipe tidak diketahui'} · {formatBytes(receipt.file_size_bytes)}</p>
                  </div>
                </div>
                <div className="flex gap-3 rounded-xl bg-slate-50 p-3">
                  <CalendarDays className="mt-0.5 h-5 w-5 text-slate-500" />
                  <div>
                    <p className="text-xs text-slate-400">Receipt</p>
                    <p className="text-sm font-semibold">{receipt.receipt_date ? new Date(`${receipt.receipt_date}T00:00:00`).toLocaleDateString('id-ID') : 'Tanggal tidak terbaca'}</p>
                    <p className="mt-0.5 text-xs text-slate-500">Diunggah {new Date(receipt.created_at).toLocaleString('id-ID')}</p>
                  </div>
                </div>
                <div className="flex gap-3 rounded-xl bg-slate-50 p-3">
                  <Store className="mt-0.5 h-5 w-5 text-slate-500" />
                  <div>
                    <p className="text-xs text-slate-400">Merchant</p>
                    <p className="text-sm font-semibold">{receipt.merchant || detail.merchant_name || 'Tidak terbaca'}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{captureLabel(receipt.capture_source)}</p>
                  </div>
                </div>
                <div className="flex gap-3 rounded-xl bg-slate-50 p-3">
                  <WalletCards className="mt-0.5 h-5 w-5 text-slate-500" />
                  <div>
                    <p className="text-xs text-slate-400">Total receipt</p>
                    <p className="text-sm font-semibold">{receipt.total != null ? formatCurrency(receipt.total) : 'Tidak terbaca'}</p>
                    <p className="mt-0.5 text-xs text-slate-500">Status {receipt.extraction_status.replaceAll('_', ' ').toLowerCase()}</p>
                  </div>
                </div>
              </div>

              {previewQuery.data && isImage && (
                <a href={previewQuery.data} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                  <img src={previewQuery.data} alt="Foto receipt transaksi" className="max-h-[420px] w-full object-contain" />
                </a>
              )}

              {previewQuery.data && isPdf && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-center">
                  <FileText className="mx-auto h-9 w-9 text-slate-500" />
                  <p className="mt-2 text-sm font-semibold">Receipt PDF</p>
                  <p className="mt-1 text-xs text-slate-500">Buka file untuk melihat isi PDF.</p>
                </div>
              )}

              {previewQuery.error && (
                <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Preview tidak dapat dimuat, tetapi file masih dapat dicoba melalui tombol Unduh.</div>
              )}

              {downloadError && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{downloadError}</div>}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={handleDownload} disabled={downloading} className="sm:flex-1">
                  {downloading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {downloading ? 'Mengunduh…' : 'Unduh receipt'}
                </Button>
                {previewQuery.data && (
                  <Button variant="outline" className="sm:flex-1" onClick={() => window.open(previewQuery.data, '_blank', 'noopener,noreferrer')}>
                    <ExternalLink className="h-4 w-4" />Buka receipt
                  </Button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </Dialog>
  )
}
