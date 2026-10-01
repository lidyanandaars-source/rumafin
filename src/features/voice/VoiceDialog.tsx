import { useRef, useState } from 'react'
import { Mic, Square, LoaderCircle, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { requireSupabase } from '@/lib/supabase'
import { invokeEdge } from '@/lib/edge'
import { useHousehold } from '@/hooks/useHousehold'
import { formatCurrency } from '@/utils/currency'

interface InterpretResult { command_id: string; transcript: string; command: Record<string, unknown> }
interface PreviewResult {
  command_id: string
  intent: string
  requires_confirmation: boolean
  message: string
  prepared?: { total_amount?: number; description?: string; merchant_name?: string; account_name?: string; category_name?: string; transaction_at?: string }
  candidates?: Array<{ id: string; merchant_name: string | null; description: string | null; total_amount: number; transaction_at: string }>
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
  const [error, setError] = useState<string | null>(null)

  function reset() { setRecording(false); setBusy(false); setTranscript(''); setPreview(null); setSelected(null); setError(null); chunksRef.current = [] }
  function close(value: boolean) { if (!value) reset(); onOpenChange(value) }

  async function startRecording() {
    setError(null); setPreview(null)
    try {
      if (!navigator.onLine) throw new Error('Voice membutuhkan koneksi internet.')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined })
      recorderRef.current = recorder; chunksRef.current = []
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        await transcribe(blob)
      }
      recorder.start(); setRecording(true)
    } catch (e) { setError(e instanceof Error ? e.message : 'Microphone tidak dapat digunakan.') }
  }

  function stopRecording() { recorderRef.current?.stop(); setRecording(false) }

  async function transcribe(blob: Blob) {
    if (!householdId) return
    setBusy(true); setError(null)
    try {
      const client = requireSupabase()
      const form = new FormData(); form.append('file', blob, 'voice.webm'); form.append('household_id', householdId)
      const { data, error: invokeError } = await client.functions.invoke<{ transcript: string; audio_path?: string | null }>('voice-transcribe', { body: form })
      if (invokeError) throw invokeError
      if (!data?.transcript) throw new Error('Ucapan belum dapat ditranskripsi. Coba ulangi lebih jelas.')
      setTranscript(data.transcript)
      await interpret(data.transcript, data.audio_path ?? null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Transkripsi gagal.') }
    finally { setBusy(false) }
  }

  async function interpret(text = transcript, audioPath: string | null = null) {
    if (!householdId || !text.trim()) return
    setBusy(true); setError(null); setPreview(null); setSelected(null)
    try {
      const parsed = await invokeEdge<InterpretResult>('voice-interpret', { household_id: householdId, transcript: text.trim(), audio_path: audioPath })
      const result = await invokeEdge<PreviewResult>('transaction-command-preview', { household_id: householdId, command_id: parsed.command_id })
      setPreview(result)
      if (result.candidates?.length === 1) setSelected(result.candidates[0]!.id)
    } catch (e) { setError(e instanceof Error ? e.message : 'Perintah belum dapat dipahami.') }
    finally { setBusy(false) }
  }

  async function commit() {
    if (!preview) return
    setBusy(true); setError(null)
    try {
      await invokeEdge('transaction-command-commit', { household_id: householdId, command_id: preview.command_id, selected_transaction_id: selected })
      await Promise.all([qc.invalidateQueries({ queryKey: ['transactions'] }), qc.invalidateQueries({ queryKey: ['dashboard'] }), qc.invalidateQueries({ queryKey: ['accounts'] })])
      close(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'Perintah gagal dijalankan.') }
    finally { setBusy(false) }
  }

  const destructive = preview?.intent === 'DELETE_TRANSACTION'
  const needsSelection = Boolean(preview?.candidates && preview.candidates.length > 1)

  return (
    <Dialog open={open} onOpenChange={close} title="Voice instruction" description="AI menerjemahkan ucapan menjadi kandidat tindakan. Anda tetap mengonfirmasi perubahan.">
      <div className="space-y-4">
        <div className="rounded-3xl bg-slate-950 p-6 text-center text-white">
          <button disabled={busy} onClick={recording ? stopRecording : startRecording} className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-white text-slate-950 transition hover:scale-105 disabled:opacity-60">
            {recording ? <Square className="h-8 w-8 fill-current" /> : busy ? <LoaderCircle className="h-8 w-8 animate-spin"/> : <Mic className="h-8 w-8"/>}
          </button>
          <p className="mt-4 font-semibold">{recording ? 'Sedang mendengarkan…' : busy ? 'Memproses…' : 'Tap untuk berbicara'}</p>
          <p className="mt-1 text-xs text-slate-400">Contoh: “Catat makan siang 85 ribu pakai cash hari ini.”</p>
        </div>

        {transcript && <div><label className="field-label">Transcript</label><Textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} /><Button variant="outline" size="sm" className="mt-2" disabled={busy} onClick={() => interpret()}>Interpretasi ulang</Button></div>}
        {error && <div className="flex gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700"><AlertTriangle className="h-5 w-5 shrink-0"/>{error}</div>}

        {preview && <div className="rounded-2xl border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Preview</p><p className="mt-1 font-semibold text-slate-900">{preview.message}</p></div><Badge>{preview.intent}</Badge></div>
          {preview.prepared && <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            {preview.prepared.total_amount != null && <div><dt className="text-slate-400">Nominal</dt><dd className="font-semibold">{formatCurrency(preview.prepared.total_amount)}</dd></div>}
            {preview.prepared.account_name && <div><dt className="text-slate-400">Akun</dt><dd className="font-semibold">{preview.prepared.account_name}</dd></div>}
            {preview.prepared.category_name && <div><dt className="text-slate-400">Kategori</dt><dd className="font-semibold">{preview.prepared.category_name}</dd></div>}
            {preview.prepared.description && <div><dt className="text-slate-400">Deskripsi</dt><dd className="font-semibold">{preview.prepared.description}</dd></div>}
          </dl>}
          {!!preview.candidates?.length && <div className="mt-4 space-y-2"><p className="text-sm font-semibold">{needsSelection ? `Ditemukan ${preview.candidates.length} kandidat. Pilih satu:` : 'Transaksi yang cocok:'}</p>{preview.candidates.map((candidate) => <label key={candidate.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3"><input type="radio" name="voice-candidate" checked={selected === candidate.id} onChange={() => setSelected(candidate.id)} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{candidate.merchant_name || candidate.description || 'Transaksi'}</p><p className="text-xs text-slate-500">{formatCurrency(candidate.total_amount)} · {new Date(candidate.transaction_at).toLocaleString('id-ID')}</p></div></label>)}</div>}
          <div className="mt-5 flex gap-2"><Button variant="outline" className="flex-1" onClick={() => close(false)}>Batal</Button><Button variant={destructive ? 'danger' : 'primary'} className="flex-1" disabled={busy || (Boolean(preview.candidates?.length) && !selected)} onClick={commit}>{busy ? 'Memproses…' : destructive ? 'Hapus' : 'Konfirmasi'}<CheckCircle2 className="h-4 w-4"/></Button></div>
        </div>}
      </div>
    </Dialog>
  )
}
