import { useRef, useState } from 'react'
import { Mic, Square, LoaderCircle, CheckCircle2, AlertTriangle, ShieldAlert, ListChecks } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { invokeEdge } from '@/lib/edge'
import { useHousehold } from '@/hooks/useHousehold'
import { formatCurrency } from '@/utils/currency'
import { listAccounts, listAccountTypes } from '@/services/accounts'
import { listCategories } from '@/services/categories'

interface InterpretCommandResult {
  command_id: string
  source_text?: string
  command: Record<string, unknown>
}

interface InterpretResult {
  command_id?: string
  transcript: string
  command?: Record<string, unknown>
  commands?: InterpretCommandResult[]
}

interface VoiceCandidate {
  id: string
  entity_type?: 'transaction' | 'account' | 'account_type'
  label?: string
  merchant_name?: string | null
  description?: string | null
  total_amount?: number
  transaction_at?: string
  deleted_at?: string | null
  name?: string
  account_type?: string
  current_balance?: number
  opening_balance?: number
  is_active?: boolean
}

interface PreviewResult {
  command_id: string
  source_text?: string
  intent: string
  risk_level?: 'READ_ONLY' | 'NORMAL' | 'DESTRUCTIVE' | 'CRITICAL'
  requires_confirmation: boolean
  can_commit?: boolean
  blocking_issues?: string[]
  requires_typed_confirmation?: boolean
  confirmation_phrase?: string | null
  candidate_kind?: 'transaction' | 'account' | 'account_type' | null
  message: string
  prepared?: {
    total_amount?: number
    account_id?: string
    category_id?: string
    transaction_type?: 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'ADJUSTMENT'
    currency?: string
    description?: string
    merchant_name?: string
    account_name?: string
    account_type_id?: string
    account_type?: string
    account_type_name?: string
    account_type_legacy?: string
    new_account_type_name?: string | null
    opening_balance?: number
    opening_balance_defaulted?: boolean
    category_name?: string
    parent_category_hint?: string | null
    category_transaction_type?: string
    transaction_at?: string
    source_account_name?: string
    destination_account_name?: string
    new_name?: string | null
    new_opening_balance?: number | null
    account?: {
      id: string
      name: string
      account_type: string
      current_balance: number
      opening_balance: number
      is_active: boolean
    }
    impact?: {
      transaction_count?: number
      active_transaction_count?: number
      counterpart_account_count?: number
      account_count?: number
      budget_count?: number
      recurring_count?: number
    }
  }
  candidates?: VoiceCandidate[]
}

interface VoiceDraft {
  amount: string
  accountId: string
  categoryId: string
  description: string
  accountName: string
  accountTypeId: string
  openingBalance: string
  accountTypeName: string
  categoryName: string
  categoryTransactionType: 'EXPENSE' | 'INCOME' | 'BOTH'
  parentCategoryId: string
}

const emptyDraft = (): VoiceDraft => ({
  amount: '',
  accountId: '',
  categoryId: '',
  description: '',
  accountName: '',
  accountTypeId: '',
  openingBalance: '0',
  accountTypeName: '',
  categoryName: '',
  categoryTransactionType: 'EXPENSE',
  parentCategoryId: '',
})

function norm(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase('id-ID')
}

export function VoiceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { householdId } = useHousehold()
  const qc = useQueryClient()
  const accounts = useQuery({
    queryKey: ['accounts', householdId],
    queryFn: () => listAccounts(householdId!),
    enabled: open && Boolean(householdId),
  })
  const accountTypes = useQuery({
    queryKey: ['account-types', householdId],
    queryFn: () => listAccountTypes(householdId!),
    enabled: open && Boolean(householdId),
  })
  const categories = useQuery({
    queryKey: ['categories', householdId],
    queryFn: () => listCategories(householdId!),
    enabled: open && Boolean(householdId),
  })
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [previews, setPreviews] = useState<PreviewResult[]>([])
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [confirmationTexts, setConfirmationTexts] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Record<string, VoiceDraft>>({})
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setRecording(false)
    setBusy(false)
    setTranscript('')
    setPreviews([])
    setSelected({})
    setConfirmationTexts({})
    setDrafts({})
    setError(null)
    chunksRef.current = []
  }

  function close(value: boolean) {
    if (!value) reset()
    onOpenChange(value)
  }

  async function startRecording() {
    setError(null)
    setPreviews([])
    setConfirmationTexts({})
    try {
      if (!navigator.onLine) throw new Error('Voice membutuhkan koneksi internet.')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined,
      })
      recorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        await transcribe(blob)
      }
      recorder.start()
      setRecording(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Microphone tidak dapat digunakan.')
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
    setRecording(false)
  }

  async function transcribe(blob: Blob) {
    if (!householdId) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', blob, 'voice.webm')
      form.append('household_id', householdId)
      const data = await invokeEdge<{
        transcript: string
        audio_path?: string | null
      }>('voice-transcribe', form)
      if (!data?.transcript) throw new Error('Ucapan belum dapat ditranskripsi. Coba ulangi lebih jelas.')
      setTranscript(data.transcript)
      await interpret(data.transcript, data.audio_path ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transkripsi gagal.')
    } finally {
      setBusy(false)
    }
  }

  function draftFromPreview(preview: PreviewResult): VoiceDraft {
    const draft = emptyDraft()
    const p = preview.prepared ?? {}
    draft.amount = p.total_amount != null ? String(p.total_amount) : ''
    draft.accountId = p.account_id ?? ''
    draft.categoryId = p.category_id ?? ''
    draft.description = p.description ?? ''
    draft.accountName = p.account_name ?? ''
    draft.accountTypeId = p.account_type_id ?? ''
    draft.openingBalance = p.opening_balance != null ? String(p.opening_balance) : '0'
    draft.accountTypeName = p.account_type_name ?? ''
    draft.categoryName = p.category_name ?? ''
    draft.categoryTransactionType = ['EXPENSE', 'INCOME', 'BOTH'].includes(String(p.category_transaction_type))
      ? p.category_transaction_type as VoiceDraft['categoryTransactionType']
      : 'EXPENSE'
    if (p.parent_category_hint) {
      const matches = (categories.data ?? []).filter((category) => norm(category.name) === norm(p.parent_category_hint))
      if (matches.length === 1) draft.parentCategoryId = matches[0].id
    }
    return draft
  }

  async function interpret(text = transcript, audioPath: string | null = null) {
    if (!householdId || !text.trim()) return
    setBusy(true)
    setError(null)
    setPreviews([])
    setSelected({})
    setConfirmationTexts({})
    setDrafts({})
    try {
      const parsed = await invokeEdge<InterpretResult>('voice-interpret', {
        household_id: householdId,
        transcript: text.trim(),
        audio_path: audioPath,
      })
      const commands = parsed.commands?.length
        ? parsed.commands
        : parsed.command_id && parsed.command
          ? [{ command_id: parsed.command_id, source_text: text.trim(), command: parsed.command }]
          : []
      if (!commands.length) throw new Error('AI tidak mengembalikan perintah yang dapat direview.')

      const results = await Promise.all(commands.map(async (item) => {
        const result = await invokeEdge<PreviewResult>('transaction-command-preview', {
          household_id: householdId,
          command_id: item.command_id,
        })
        return { ...result, source_text: item.source_text }
      }))

      const nextDrafts: Record<string, VoiceDraft> = {}
      const nextSelected: Record<string, string> = {}
      for (const result of results) {
        nextDrafts[result.command_id] = draftFromPreview(result)
        if (result.candidates?.length === 1) nextSelected[result.command_id] = result.candidates[0]!.id
      }
      setPreviews(results)
      setDrafts(nextDrafts)
      setSelected(nextSelected)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Perintah belum dapat dipahami.')
    } finally {
      setBusy(false)
    }
  }

  function updateDraft(commandId: string, patch: Partial<VoiceDraft>) {
    setDrafts((current) => ({
      ...current,
      [commandId]: { ...(current[commandId] ?? emptyDraft()), ...patch },
    }))
  }

  function manualOverrideFor(preview: PreviewResult) {
    const draft = drafts[preview.command_id] ?? emptyDraft()
    if (preview.intent === 'CREATE_TRANSACTION') {
      return {
        amount: draft.amount,
        account_id: draft.accountId,
        category_id: draft.categoryId,
        description: draft.description,
      }
    }
    if (preview.intent === 'CREATE_ACCOUNT') {
      return {
        account_name: draft.accountName,
        account_type_id: draft.accountTypeId,
        opening_balance: draft.openingBalance,
      }
    }
    if (preview.intent === 'CREATE_ACCOUNT_TYPE') {
      return { account_type_name: draft.accountTypeName }
    }
    if (preview.intent === 'CREATE_CATEGORY') {
      return {
        category_name: draft.categoryName,
        category_transaction_type: draft.categoryTransactionType,
        parent_category_id: draft.parentCategoryId || null,
      }
    }
    return undefined
  }

  function effectiveConfirmationPhrase(preview: PreviewResult) {
    const selectedCandidate = preview.candidates?.find((candidate) => candidate.id === selected[preview.command_id])
    return preview.confirmation_phrase ||
      (preview.intent === 'DELETE_ACCOUNT_CASCADE' && selectedCandidate?.name
        ? `HAPUS AKUN ${selectedCandidate.name}`
        : preview.intent === 'RESET_ACCOUNT' && selectedCandidate?.name
          ? `RESET AKUN ${selectedCandidate.name}`
          : null)
  }

  function typedConfirmationValid(preview: PreviewResult) {
    if (!preview.requires_typed_confirmation) return true
    return String(confirmationTexts[preview.command_id] ?? '').trim().toLocaleUpperCase('id-ID') ===
      String(effectiveConfirmationPhrase(preview) ?? '').trim().toLocaleUpperCase('id-ID')
  }

  function editableCreateReady(preview: PreviewResult) {
    const draft = drafts[preview.command_id] ?? emptyDraft()
    if (preview.intent === 'CREATE_TRANSACTION') {
      const amount = Number(draft.amount)
      return Number.isFinite(amount) && amount > 0 && Boolean(draft.accountId) && Boolean(draft.categoryId)
    }
    if (preview.intent === 'CREATE_ACCOUNT') {
      const opening = Number(draft.openingBalance)
      return Boolean(draft.accountName.trim()) && Boolean(draft.accountTypeId) && Number.isFinite(opening) && opening >= 0
    }
    if (preview.intent === 'CREATE_ACCOUNT_TYPE') return Boolean(draft.accountTypeName.trim())
    if (preview.intent === 'CREATE_CATEGORY') return Boolean(draft.categoryName.trim()) && ['EXPENSE', 'INCOME', 'BOTH'].includes(draft.categoryTransactionType)
    return preview.can_commit !== false
  }

  function previewReady(preview: PreviewResult) {
    if (!preview.requires_confirmation) return true
    if (!editableCreateReady(preview)) return false
    if (Boolean(preview.candidates?.length) && !selected[preview.command_id]) return false
    if (!typedConfirmationValid(preview)) return false
    return true
  }

  async function commitAll() {
    if (!previews.length || !householdId) return
    const actionable = previews.filter((preview) => preview.requires_confirmation)
    if (!actionable.length) return
    if (actionable.some((preview) => !previewReady(preview))) return

    setBusy(true)
    setError(null)
    let completed = 0
    try {
      for (const preview of actionable) {
        await invokeEdge('transaction-command-commit', {
          household_id: householdId,
          command_id: preview.command_id,
          selected_entity_id: selected[preview.command_id] ?? null,
          confirmation_text: confirmationTexts[preview.command_id] ?? '',
          manual_override: manualOverrideFor(preview),
        })
        completed += 1
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['transactions'] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
        qc.invalidateQueries({ queryKey: ['accounts'] }),
        qc.invalidateQueries({ queryKey: ['account-types'] }),
        qc.invalidateQueries({ queryKey: ['categories'] }),
        qc.invalidateQueries({ queryKey: ['budgets'] }),
        qc.invalidateQueries({ queryKey: ['reports'] }),
      ])
      close(false)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Perintah gagal dijalankan.'
      setError(completed > 0
        ? `${completed} perintah sebelumnya sudah tersimpan. Perintah berikutnya gagal: ${message}. Anda dapat menekan Simpan lagi; perintah yang sudah sukses bersifat idempotent.`
        : message)
    } finally {
      setBusy(false)
    }
  }

  function renderEditableCreate(preview: PreviewResult) {
    const draft = drafts[preview.command_id] ?? emptyDraft()

    if (preview.intent === 'CREATE_TRANSACTION') {
      const amount = Number(draft.amount)
      const transactionType = preview.prepared?.transaction_type ?? 'EXPENSE'
      const availableCategories = (categories.data ?? []).filter((category) =>
        transactionType === 'INCOME' ? category.transaction_type !== 'EXPENSE' : category.transaction_type !== 'INCOME',
      )
      return (
        <div className="mt-4 space-y-4 rounded-2xl bg-slate-50 p-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Lengkapi dan finalisasi transaksi</p>
            <p className="mt-1 text-xs text-slate-500">Akun, kategori, nominal, dan deskripsi selalu dapat diedit sebelum disimpan.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="field-label">Nominal</span>
              <Input type="number" min="1" value={draft.amount} onChange={(event) => updateDraft(preview.command_id, { amount: event.target.value })} placeholder="Masukkan nominal" />
              {amount > 0 && <p className="mt-1 text-xs text-slate-400">{formatCurrency(amount)}</p>}
            </label>
            <label>
              <span className="field-label">Akun</span>
              <Select value={draft.accountId} onChange={(event) => updateDraft(preview.command_id, { accountId: event.target.value })}>
                <option value="">Pilih akun</option>
                {accounts.data?.filter((account) => account.is_active).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </Select>
            </label>
            <label className="sm:col-span-2">
              <span className="field-label">Kategori</span>
              <Select value={draft.categoryId} onChange={(event) => updateDraft(preview.command_id, { categoryId: event.target.value })}>
                <option value="">Pilih kategori</option>
                {availableCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </Select>
            </label>
            <label className="sm:col-span-2">
              <span className="field-label">Deskripsi</span>
              <Textarea value={draft.description} onChange={(event) => updateDraft(preview.command_id, { description: event.target.value })} placeholder="Deskripsi transaksi" />
            </label>
          </div>
          {preview.prepared?.transaction_at && <p className="text-xs text-slate-500">Tanggal: {new Date(preview.prepared.transaction_at).toLocaleDateString('id-ID')}</p>}
        </div>
      )
    }

    if (preview.intent === 'CREATE_ACCOUNT') {
      const opening = Number(draft.openingBalance)
      return (
        <div className="mt-4 space-y-4 rounded-2xl bg-slate-50 p-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Lengkapi dan finalisasi akun</p>
            <p className="mt-1 text-xs text-slate-500">Nama akun, tipe akun, dan saldo awal dapat dikoreksi manual meskipun AI sudah mengisinya.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="field-label">Nama akun</span>
              <Input value={draft.accountName} onChange={(event) => updateDraft(preview.command_id, { accountName: event.target.value })} placeholder="Contoh: Emas, BCA, Cash Hendra" />
            </label>
            <label>
              <span className="field-label">Tipe akun</span>
              <Select value={draft.accountTypeId} onChange={(event) => updateDraft(preview.command_id, { accountTypeId: event.target.value })}>
                <option value="">Pilih tipe akun</option>
                {accountTypes.data?.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
              </Select>
            </label>
            <label>
              <span className="field-label">Saldo awal</span>
              <Input type="number" min="0" value={draft.openingBalance} onChange={(event) => updateDraft(preview.command_id, { openingBalance: event.target.value })} placeholder="0" />
              {Number.isFinite(opening) && opening >= 0 && <p className="mt-1 text-xs text-slate-400">{formatCurrency(opening)}</p>}
            </label>
          </div>
        </div>
      )
    }

    if (preview.intent === 'CREATE_ACCOUNT_TYPE') {
      return (
        <div className="mt-4 rounded-2xl bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-900">Finalisasi tipe akun</p>
          <p className="mt-1 text-xs text-slate-500">Nama hasil interpretasi dapat diedit sebelum tipe akun dibuat.</p>
          <label className="mt-3 block">
            <span className="field-label">Nama tipe akun</span>
            <Input value={draft.accountTypeName} onChange={(event) => updateDraft(preview.command_id, { accountTypeName: event.target.value })} placeholder="Contoh: Crypto, Investasi, Emas" maxLength={80} />
          </label>
        </div>
      )
    }

    if (preview.intent === 'CREATE_CATEGORY') {
      const roots = (categories.data ?? []).filter((category) => !category.parent_id && !category.is_archived)
      return (
        <div className="mt-4 space-y-4 rounded-2xl bg-slate-50 p-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Finalisasi kategori</p>
            <p className="mt-1 text-xs text-slate-500">Nama, tipe transaksi, dan parent category dapat diedit sebelum kategori dibuat.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="field-label">Nama kategori</span>
              <Input value={draft.categoryName} onChange={(event) => updateDraft(preview.command_id, { categoryName: event.target.value })} placeholder="Contoh: Pets, Les, Hobi" />
            </label>
            <label>
              <span className="field-label">Tipe</span>
              <Select value={draft.categoryTransactionType} onChange={(event) => updateDraft(preview.command_id, { categoryTransactionType: event.target.value as VoiceDraft['categoryTransactionType'] })}>
                <option value="EXPENSE">Pengeluaran</option>
                <option value="INCOME">Pemasukan</option>
                <option value="BOTH">Keduanya</option>
              </Select>
            </label>
            <label>
              <span className="field-label">Parent category</span>
              <Select value={draft.parentCategoryId} onChange={(event) => updateDraft(preview.command_id, { parentCategoryId: event.target.value })}>
                <option value="">Tidak ada (kategori utama)</option>
                {roots.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </Select>
            </label>
          </div>
        </div>
      )
    }

    return null
  }

  function renderPrepared(preview: PreviewResult) {
    const p = preview.prepared
    if (!p || ['CREATE_TRANSACTION', 'CREATE_ACCOUNT', 'CREATE_ACCOUNT_TYPE', 'CREATE_CATEGORY'].includes(preview.intent)) return null
    return (
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        {p.total_amount != null && <div><dt className="text-slate-400">Nominal</dt><dd className="font-semibold">{formatCurrency(p.total_amount)}</dd></div>}
        {p.account_name && <div><dt className="text-slate-400">Akun</dt><dd className="font-semibold">{p.account_name}</dd></div>}
        {p.account_type && <div><dt className="text-slate-400">Tipe akun</dt><dd className="font-semibold">{p.account_type}</dd></div>}
        {p.account_type_name && <div><dt className="text-slate-400">Tipe akun baru</dt><dd className="font-semibold">{p.account_type_name}</dd></div>}
        {p.new_account_type_name && <div><dt className="text-slate-400">Nama tipe baru</dt><dd className="font-semibold">{p.new_account_type_name}</dd></div>}
        {p.opening_balance != null && <div><dt className="text-slate-400">Saldo awal</dt><dd className="font-semibold">{formatCurrency(p.opening_balance)}{p.opening_balance_defaulted ? ' (default)' : ''}</dd></div>}
        {p.source_account_name && <div><dt className="text-slate-400">Dari</dt><dd className="font-semibold">{p.source_account_name}</dd></div>}
        {p.destination_account_name && <div><dt className="text-slate-400">Ke</dt><dd className="font-semibold">{p.destination_account_name}</dd></div>}
        {p.category_name && <div><dt className="text-slate-400">Kategori</dt><dd className="font-semibold">{p.category_name}</dd></div>}
        {p.new_name && <div><dt className="text-slate-400">Nama baru</dt><dd className="font-semibold">{p.new_name}</dd></div>}
        {p.new_opening_balance != null && <div><dt className="text-slate-400">Saldo awal baru</dt><dd className="font-semibold">{formatCurrency(p.new_opening_balance)}</dd></div>}
        {p.description && <div className="col-span-2"><dt className="text-slate-400">Deskripsi</dt><dd className="font-semibold">{p.description}</dd></div>}
      </dl>
    )
  }

  const actionable = previews.filter((preview) => preview.requires_confirmation)
  const allReady = actionable.length > 0 && actionable.every(previewReady)
  const anyDestructive = previews.some((preview) => preview.risk_level === 'DESTRUCTIVE' || preview.risk_level === 'CRITICAL')

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Voice instruction"
      description="Satu ucapan dapat berisi beberapa perintah. Semua hasil ditampilkan sebagai draft yang dapat direview sebelum disimpan."
      className="md:max-w-3xl"
    >
      <div className="space-y-4">
        <div className="rounded-3xl bg-slate-950 p-6 text-center text-white">
          <button disabled={busy} onClick={recording ? stopRecording : startRecording} className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-white text-slate-950 transition hover:scale-105 disabled:opacity-60">
            {recording ? <Square className="h-8 w-8 fill-current" /> : busy ? <LoaderCircle className="h-8 w-8 animate-spin" /> : <Mic className="h-8 w-8" />}
          </button>
          <p className="mt-4 font-semibold">{recording ? 'Sedang mendengarkan…' : busy ? 'Memproses…' : 'Tap untuk berbicara'}</p>
          <p className="mt-1 text-xs text-slate-400">Contoh: “Buat akun A saldo 1 juta, akun B saldo 2 juta” atau “Kemarin beli beras 100 ribu cash, beli baju 200 ribu cash”.</p>
        </div>

        {transcript && (
          <div>
            <label className="field-label">Transcript</label>
            <Textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} />
            <Button variant="outline" size="sm" className="mt-2" disabled={busy} onClick={() => interpret()}>Interpretasi ulang</Button>
          </div>
        )}

        {error && <div className="flex gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700"><AlertTriangle className="h-5 w-5 shrink-0" /><span>{error}</span></div>}

        {previews.length > 1 && (
          <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <ListChecks className="mt-0.5 h-5 w-5 shrink-0" />
            <div><p className="font-semibold">{previews.length} perintah terdeteksi</p><p className="mt-1 text-sm text-slate-500">Periksa setiap draft. Semua perintah baru akan dijalankan setelah Anda memilih “Simpan semua”.</p></div>
          </div>
        )}

        {previews.map((preview, index) => {
          const risk = preview.risk_level ?? 'NORMAL'
          const destructive = risk === 'DESTRUCTIVE' || risk === 'CRITICAL'
          const critical = risk === 'CRITICAL'
          const needsSelection = Boolean(preview.candidates && preview.candidates.length > 1)
          const phrase = effectiveConfirmationPhrase(preview)
          const editableCreate = ['CREATE_TRANSACTION', 'CREATE_ACCOUNT', 'CREATE_ACCOUNT_TYPE', 'CREATE_CATEGORY'].includes(preview.intent)
          return (
            <div key={preview.command_id} className={`rounded-2xl border p-4 ${critical ? 'border-red-300 bg-red-50/40' : 'border-slate-200'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{previews.length > 1 ? `Perintah ${index + 1}` : 'Preview'}</p>
                  {previews.length > 1 && preview.source_text && <p className="mt-1 rounded-lg bg-slate-50 px-2 py-1 text-xs italic text-slate-500">“{preview.source_text}”</p>}
                  <p className="mt-2 font-semibold text-slate-900">{preview.message}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge>{preview.intent}</Badge>
                  {destructive && <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700"><ShieldAlert className="h-3.5 w-3.5" />{critical ? 'Risiko kritis' : 'Destruktif'}</span>}
                </div>
              </div>

              {renderEditableCreate(preview)}
              {renderPrepared(preview)}

              {preview.can_commit === false && !!preview.blocking_issues?.length && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  {editableCreate ? (
                    <>AI belum dapat menentukan: <strong>{preview.blocking_issues.join(', ')}</strong>. Lengkapi atau ubah nilainya langsung pada form di atas; Anda tidak perlu merekam ulang.</>
                  ) : (
                    <>Perintah memerlukan data tambahan: <strong>{preview.blocking_issues.join(', ')}</strong>. Edit transcript lalu pilih <strong>Interpretasi ulang</strong>.</>
                  )}
                </div>
              )}

              {!!preview.candidates?.length && (
                <div className="mt-4 space-y-2">
                  <p className="text-sm font-semibold">{needsSelection ? `Ditemukan ${preview.candidates.length} kandidat. Pilih satu:` : preview.candidate_kind === 'account' ? 'Akun yang cocok:' : preview.candidate_kind === 'account_type' ? 'Tipe akun yang cocok:' : 'Transaksi yang cocok:'}</p>
                  {preview.candidates.map((candidate) => (
                    <label key={candidate.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
                      <input type="radio" name={`voice-candidate-${preview.command_id}`} checked={selected[preview.command_id] === candidate.id} onChange={() => setSelected((current) => ({ ...current, [preview.command_id]: candidate.id }))} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{candidate.label || candidate.name || candidate.merchant_name || candidate.description || 'Kandidat'}</p>
                        {candidate.entity_type === 'account' || candidate.entity_type === 'account_type' || candidate.name ? (
                          <p className="text-xs text-slate-500">{candidate.entity_type === 'account_type' ? 'TIPE AKUN' : (candidate.account_type || 'ACCOUNT')}{candidate.current_balance != null ? ` · ${formatCurrency(candidate.current_balance)}` : ''}{candidate.is_active === false ? ' · Diarsipkan' : ''}</p>
                        ) : (
                          <p className="text-xs text-slate-500">{candidate.total_amount != null ? formatCurrency(candidate.total_amount) : ''}{candidate.transaction_at ? ` · ${new Date(candidate.transaction_at).toLocaleString('id-ID')}` : ''}{candidate.deleted_at ? ' · Terhapus' : ''}</p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {preview.requires_typed_confirmation && phrase && (
                <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3">
                  <p className="text-sm font-semibold text-red-800">Konfirmasi ekstra diperlukan</p>
                  <p className="mt-1 text-xs text-red-700">Ketik persis <strong>{phrase}</strong> untuk perintah ini.</p>
                  <Input className="mt-3 bg-white" value={confirmationTexts[preview.command_id] ?? ''} onChange={(e) => setConfirmationTexts((current) => ({ ...current, [preview.command_id]: e.target.value }))} placeholder={phrase} />
                </div>
              )}
            </div>
          )
        })}

        {!!previews.length && (
          <div className="sticky bottom-0 -mx-1 flex gap-2 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur">
            <Button variant="outline" className="flex-1" onClick={() => close(false)}>Tutup</Button>
            {actionable.length > 0 && (
              <Button variant={anyDestructive ? 'danger' : 'primary'} className="flex-1" disabled={busy || !allReady} onClick={commitAll}>
                {busy ? 'Memproses…' : previews.length > 1 ? `Simpan semua (${actionable.length})` : anyDestructive ? 'Konfirmasi' : 'Simpan'}
                <CheckCircle2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}
