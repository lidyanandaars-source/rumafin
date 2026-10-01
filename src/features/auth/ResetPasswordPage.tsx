import { useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { requireSupabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null); setMessage(null)
    if (password.length < 8) { setError('Password minimal 8 karakter.'); return }
    if (password !== confirm) { setError('Konfirmasi password tidak sama.'); return }
    setBusy(true)
    try {
      const { error: updateError } = await requireSupabase().auth.updateUser({ password })
      if (updateError) throw updateError
      setMessage('Password berhasil diperbarui. Anda dapat kembali ke dashboard.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Gagal memperbarui password.') }
    finally { setBusy(false) }
  }

  return <main className="grid min-h-screen place-items-center bg-slate-100 p-5"><form onSubmit={submit} className="w-full max-w-md rounded-3xl bg-white p-7 shadow-soft"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-950 text-white"><KeyRound/></div><h1 className="mt-5 text-2xl font-bold">Buat password baru</h1><p className="mt-1 text-sm text-slate-500">Gunakan minimal 8 karakter.</p><div className="mt-6 space-y-4"><label><span className="field-label">Password baru</span><Input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={8}/></label><label><span className="field-label">Konfirmasi</span><Input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} required minLength={8}/></label>{error&&<p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}{message&&<p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}<Button className="w-full" disabled={busy}>{busy?'Menyimpan…':'Perbarui password'}</Button></div></form></main>
}
