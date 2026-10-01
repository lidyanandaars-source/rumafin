import { useRef, useState } from 'react'
import { Mic, Square, LoaderCircle, CheckCircle2, AlertTriangle, ShieldAlert } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { invokeEdge } from '@/lib/edge'
import { useHousehold } from '@/hooks/useHousehold'
import { formatCurrency } from '@/utils/currency'

interface InterpretResult {
  command_id: string
  transcript: string
  command: Record<string, unknown>
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
    description?: string
    merchant_name?: string
    account_name?: string
    account_type?: string
    account_type_name?: string
    new_account_type_name?: string | null
    opening_balance?: number
    opening_balance_defaulted?: boolean
    category_name?: string
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

export function VoiceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { householdId } = useHousehold()
  const qc = useQueryClient()
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [confirmationText, setConfirmationText] = useState('')
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setRecording(false)
    setBusy(false)
    setTranscript('')
    setPreview(null)
    setSelected(null)
    setConfirmationText('')
    setError(null)
    chunksRef.current = []
  }

  function close(value: boolean) {
    if (!value) reset()
    onOpenChange(value)
  }

  async function startRecording() {
    setError(null)
    setPreview(null)
    setConfirmationText('')
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

  async function interpret(text = transcript, audioPath: string | null = null) {
    if (!householdId || !text.trim()) return
    setBusy(true)
    setError(null)
    setPreview(null)
    setSelected(null)
    setConfirmationText('')
    try {
      const parsed = await invokeEdge<InterpretResult>('voice-interpret', {
        household_id: householdId,
        transcript: text.trim(),
        audio_path: audioPath,
      })
      const result = await invokeEdge<PreviewResult>('transaction-command-preview', {
        household_id: householdId,
        command_id: parsed.command_id,
      })
      setPreview(result)
      if (result.candidates?.length === 1) setSelected(result.candidates[0]!.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Perintah belum dapat dipahami.')
    } finally {
      setBusy(false)
    }
  }

  async function commit() {
    if (!preview || !householdId) return
    setBusy(true)
    setError(null)
    try {
      await invokeEdge('transaction-command-commit', {
        household_id: householdId,
        command_id: preview.command_id,
        selected_entity_id: selected,
        confirmation_text: confirmationText,
      })
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
      setError(e instanceof Error ? e.message : 'Perintah gagal dijalankan.')
    } finally {
      setBusy(false)
    }
  }

  const risk = preview?.risk_level ?? 'NORMAL'
  const destructive = risk === 'DESTRUCTIVE' || risk === 'CRITICAL'
  const critical = risk === 'CRITICAL'
  const needsSelection = Boolean(preview?.candidates && preview.candidates.length > 1)
  const selectedCandidate = preview?.candidates?.find((candidate) => candidate.id === selected)
  const effectiveConfirmationPhrase = preview?.confirmation_phrase ||
    (preview?.intent === 'DELETE_ACCOUNT_CASCADE' && selectedCandidate?.name
      ? `HAPUS AKUN ${selectedCandidate.name}`
      : preview?.intent === 'RESET_ACCOUNT' && selectedCandidate?.name
        ? `RESET AKUN ${selectedCandidate.name}`
        : null)
  const typedConfirmationValid = !preview?.requires_typed_confirmation ||
    confirmationText.trim().toLocaleUpperCase('id-ID') ===
      String(effectiveConfirmationPhrase ?? '').trim().toLocaleUpperCase('id-ID')
  const canCommit = preview?.can_commit !== false

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Voice instruction"
      description="Voice Superpower dapat menjalankan tindakan finansial dan administrasi yang diizinkan. AI hanya menafsirkan; aplikasi memvalidasi dan Anda tetap mengonfirmasi perubahan."
    >
      <div className="space-y-4">
        <div className="rounded-3xl bg-slate-950 p-6 text-center text-white">
          <button
            disabled={busy}
            onClick={recording ? stopRecording : startRecording}
            className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-white text-slate-950 transition hover:scale-105 disabled:opacity-60"
          >
            {recording ? (
              <Square className="h-8 w-8 fill-current" />
            ) : busy ? (
              <LoaderCircle className="h-8 w-8 animate-spin" />
            ) : (
              <Mic className="h-8 w-8" />
            )}
          </button>
          <p className="mt-4 font-semibold">
            {recording ? 'Sedang mendengarkan…' : busy ? 'Memproses…' : 'Tap untuk berbicara'}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Contoh: “Buat tipe akun Crypto”, “Buat akun Binance tipe Crypto saldo 5 juta”, atau “Pindahkan 500 ribu dari BCA ke Cash”.
          </p>
        </div>

        {transcript && (
          <div>
            <label className="field-label">Transcript</label>
            <Textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} />
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              disabled={busy}
              onClick={() => interpret()}
            >
              Interpretasi ulang
            </Button>
          </div>
        )}

        {error && (
          <div className="flex gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            {error}
          </div>
        )}

        {preview && (
          <div className={`rounded-2xl border p-4 ${critical ? 'border-red-300 bg-red-50/40' : 'border-slate-200'}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Preview</p>
                <p className="mt-1 font-semibold text-slate-900">{preview.message}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge>{preview.intent}</Badge>
                {destructive && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    {critical ? 'Risiko kritis' : 'Destruktif'}
                  </span>
                )}
              </div>
            </div>

            {preview.prepared && (
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                {preview.prepared.total_amount != null && (
                  <div>
                    <dt className="text-slate-400">Nominal</dt>
                    <dd className="font-semibold">{formatCurrency(preview.prepared.total_amount)}</dd>
                  </div>
                )}
                {preview.prepared.account_name && (
                  <div>
                    <dt className="text-slate-400">Akun</dt>
                    <dd className="font-semibold">{preview.prepared.account_name}</dd>
                  </div>
                )}
                {preview.prepared.account_type && (
                  <div>
                    <dt className="text-slate-400">Tipe akun</dt>
                    <dd className="font-semibold">{preview.prepared.account_type}</dd>
                  </div>
                )}
                {preview.prepared.account_type_name && (
                  <div>
                    <dt className="text-slate-400">Tipe akun baru</dt>
                    <dd className="font-semibold">{preview.prepared.account_type_name}</dd>
                  </div>
                )}
                {preview.prepared.new_account_type_name && (
                  <div>
                    <dt className="text-slate-400">Nama tipe baru</dt>
                    <dd className="font-semibold">{preview.prepared.new_account_type_name}</dd>
                  </div>
                )}
                {preview.prepared.opening_balance != null && (
                  <div>
                    <dt className="text-slate-400">Saldo awal</dt>
                    <dd className="font-semibold">
                      {formatCurrency(preview.prepared.opening_balance)}
                      {preview.prepared.opening_balance_defaulted ? ' (default)' : ''}
                    </dd>
                  </div>
                )}
                {preview.prepared.source_account_name && (
                  <div>
                    <dt className="text-slate-400">Dari</dt>
                    <dd className="font-semibold">{preview.prepared.source_account_name}</dd>
                  </div>
                )}
                {preview.prepared.destination_account_name && (
                  <div>
                    <dt className="text-slate-400">Ke</dt>
                    <dd className="font-semibold">{preview.prepared.destination_account_name}</dd>
                  </div>
                )}
                {preview.prepared.category_name && (
                  <div>
                    <dt className="text-slate-400">Kategori</dt>
                    <dd className="font-semibold">{preview.prepared.category_name}</dd>
                  </div>
                )}
                {preview.prepared.new_name && (
                  <div>
                    <dt className="text-slate-400">Nama baru</dt>
                    <dd className="font-semibold">{preview.prepared.new_name}</dd>
                  </div>
                )}
                {preview.prepared.new_opening_balance != null && (
                  <div>
                    <dt className="text-slate-400">Saldo awal baru</dt>
                    <dd className="font-semibold">{formatCurrency(preview.prepared.new_opening_balance)}</dd>
                  </div>
                )}
                {preview.prepared.description && (
                  <div className="col-span-2">
                    <dt className="text-slate-400">Deskripsi</dt>
                    <dd className="font-semibold">{preview.prepared.description}</dd>
                  </div>
                )}
              </dl>
            )}

            {preview.can_commit === false && !!preview.blocking_issues?.length && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Perintah belum aman untuk dijalankan karena: <strong>{preview.blocking_issues.join(', ')}</strong>.
                Edit transcript lalu pilih <strong>Interpretasi ulang</strong>, atau gunakan input manual.
              </div>
            )}

            {!!preview.candidates?.length && (
              <div className="mt-4 space-y-2">
                <p className="text-sm font-semibold">
                  {needsSelection
                    ? `Ditemukan ${preview.candidates.length} kandidat. Pilih satu:`
                    : preview.candidate_kind === 'account'
                      ? 'Akun yang cocok:'
                      : preview.candidate_kind === 'account_type'
                        ? 'Tipe akun yang cocok:'
                        : 'Transaksi yang cocok:'}
                </p>
                {preview.candidates.map((candidate) => (
                  <label
                    key={candidate.id}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"
                  >
                    <input
                      type="radio"
                      name="voice-candidate"
                      checked={selected === candidate.id}
                      onChange={() => setSelected(candidate.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {candidate.label || candidate.name || candidate.merchant_name || candidate.description || 'Kandidat'}
                      </p>
                      {candidate.entity_type === 'account' || candidate.entity_type === 'account_type' || candidate.name ? (
                        <p className="text-xs text-slate-500">
                          {candidate.entity_type === 'account_type' ? 'TIPE AKUN' : (candidate.account_type || 'ACCOUNT')}
                          {candidate.current_balance != null ? ` · ${formatCurrency(candidate.current_balance)}` : ''}
                          {candidate.is_active === false ? ' · Diarsipkan' : ''}
                        </p>
                      ) : (
                        <p className="text-xs text-slate-500">
                          {candidate.total_amount != null ? formatCurrency(candidate.total_amount) : ''}
                          {candidate.transaction_at ? ` · ${new Date(candidate.transaction_at).toLocaleString('id-ID')}` : ''}
                          {candidate.deleted_at ? ' · Terhapus' : ''}
                        </p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}

            {preview.requires_typed_confirmation && effectiveConfirmationPhrase && (
              <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3">
                <p className="text-sm font-semibold text-red-800">Konfirmasi ekstra diperlukan</p>
                <p className="mt-1 text-xs text-red-700">
                  Ketik persis <strong>{effectiveConfirmationPhrase}</strong> untuk melanjutkan.
                </p>
                <Input
                  className="mt-3 bg-white"
                  value={confirmationText}
                  onChange={(e) => setConfirmationText(e.target.value)}
                  placeholder={effectiveConfirmationPhrase}
                />
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => close(false)}>
                Tutup
              </Button>
              {preview.requires_confirmation && (
                <Button
                  variant={destructive ? 'danger' : 'primary'}
                  className="flex-1"
                  disabled={
                    busy ||
                    !canCommit ||
                    (Boolean(preview.candidates?.length) && !selected) ||
                    !typedConfirmationValid
                  }
                  onClick={commit}
                >
                  {busy ? 'Memproses…' : critical ? 'Konfirmasi tindakan kritis' : destructive ? 'Konfirmasi' : 'Simpan'}
                  <CheckCircle2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}
