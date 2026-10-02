import { requireSupabase } from '@/lib/supabase'

export interface ReceiptAttachmentItem {
  id: string
  line_no: number | null
  name: string | null
  quantity: number | null
  unit_price: number | null
  total: number | null
  confidence: number | null
  category_id: string | null
}

export interface ReceiptAttachment {
  id: string
  storage_path: string
  mime_type: string | null
  original_filename: string | null
  stored_filename: string | null
  file_size_bytes: number | null
  capture_source: 'UPLOAD' | 'CAMERA' | null
  merchant: string | null
  receipt_date: string | null
  subtotal: number | null
  tax: number | null
  discount: number | null
  total: number | null
  extraction_status: string
  overall_confidence: number | null
  created_at: string
  group_no?: number | null
  items?: ReceiptAttachmentItem[]
}

const receiptSelect = `
  id,
  storage_path,
  mime_type,
  original_filename,
  stored_filename,
  file_size_bytes,
  capture_source,
  merchant,
  receipt_date,
  subtotal,
  tax,
  discount,
  total,
  extraction_status,
  overall_confidence,
  created_at,
  items:receipt_items(id,line_no,name,quantity,unit_price,total,confidence,category_id)
`

export async function getReceiptForTransaction(transactionId: string): Promise<ReceiptAttachment | null> {
  const client = requireSupabase()

  const { data: linked, error: linkedError } = await client
    .from('receipt_transactions')
    .select(`group_no,receipt:receipts(${receiptSelect})`)
    .eq('transaction_id', transactionId)
    .maybeSingle()

  if (linkedError) throw linkedError
  if (linked?.receipt) {
    const receipt = (Array.isArray(linked.receipt) ? linked.receipt[0] : linked.receipt) as unknown as ReceiptAttachment
    if (receipt) return { ...receipt, group_no: Number(linked.group_no) || null }
  }

  // Backward compatibility for receipts created before receipt_transactions existed.
  const { data: legacy, error: legacyError } = await client
    .from('receipts')
    .select(receiptSelect)
    .eq('transaction_id', transactionId)
    .maybeSingle()

  if (legacyError) throw legacyError
  return (legacy ?? null) as unknown as ReceiptAttachment | null
}

export async function createReceiptPreviewUrl(storagePath: string, expiresInSeconds = 600): Promise<string> {
  const client = requireSupabase()
  const { data, error } = await client.storage.from('receipts').createSignedUrl(storagePath, expiresInSeconds)
  if (error) throw error
  return data.signedUrl
}

function safeDownloadName(receipt: ReceiptAttachment): string {
  const candidate = receipt.stored_filename || receipt.original_filename || `receipt-${receipt.id}`
  return candidate.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180) || `receipt-${receipt.id}`
}

export async function downloadReceipt(receipt: ReceiptAttachment): Promise<void> {
  const client = requireSupabase()
  const { data, error } = await client.storage.from('receipts').download(receipt.storage_path)
  if (error) throw error
  if (!data) throw new Error('File receipt tidak tersedia.')

  const url = URL.createObjectURL(data)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = safeDownloadName(receipt)
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
