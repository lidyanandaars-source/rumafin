import { useState, type FormEvent } from 'react'
import { WalletCards, Mail, LockKeyhole } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { requireSupabase } from '@/lib/supabase'

export function LoginPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(null); setMessage(null)
    try {
      const client = requireSupabase()
      const result = mode === 'signin'
        ? await client.auth.signInWithPassword({ email, password })
        : await client.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
      if (result.error) throw result.error
      if (mode === 'signup' && !result.data.session) setMessage('Akun dibuat. Periksa email untuk konfirmasi.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Autentikasi gagal.')
    } finally { setBusy(false) }
  }

  async function sendMagicLink() {
    if (!email) { setError('Isi email terlebih dahulu.'); return }
    setBusy(true); setError(null); setMessage(null)
    try {
      const { error: authError } = await requireSupabase().auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })
      if (authError) throw authError
      setMessage('Magic link sudah dikirim ke email Anda.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Gagal mengirim magic link.') }
    finally { setBusy(false) }
  }


  async function forgotPassword() {
    if (!email) { setError('Isi email terlebih dahulu.'); return }
    setBusy(true); setError(null); setMessage(null)
    try {
      const { error: resetError } = await requireSupabase().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` })
      if (resetError) throw resetError
      setMessage('Link reset password sudah dikirim ke email Anda.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Gagal mengirim link reset password.') }
    finally { setBusy(false) }
  }


  return (
    <main className="min-h-screen bg-slate-100 lg:grid lg:grid-cols-2">
      <section className="hidden bg-slate-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3 text-lg font-bold"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-slate-950"><WalletCards /></span>RumaFin AI</div>
        <div className="max-w-xl"><p className="text-5xl font-bold leading-tight">Catat uang rumah tangga tanpa membuat pencatatan terasa seperti pekerjaan.</p><p className="mt-6 text-lg leading-8 text-slate-300">Manual, suara, atau receipt. AI membantu membaca maksud Anda; database tetap menjadi sumber kebenaran.</p></div>
        <p className="text-sm text-slate-400">AI interprets · Application validates · Database calculates · You remain in control</p>
      </section>
      <section className="grid min-h-screen place-items-center p-5">
        <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-soft md:p-8">
          <div className="mb-7 lg:hidden"><div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-slate-950 text-white"><WalletCards /></div><h1 className="text-2xl font-bold">RumaFin AI</h1></div>
          <h2 className="text-2xl font-bold">{mode === 'signin' ? 'Masuk ke rumah Anda' : 'Buat akun baru'}</h2>
          <p className="mt-1 text-sm text-slate-500">Keuangan rumah tangga, tersusun dan dapat diaudit.</p>
          <form className="mt-7 space-y-4" onSubmit={submit}>
            <label><span className="field-label">Email</span><div className="relative"><Mail className="absolute left-3 top-3 h-5 w-5 text-slate-400"/><Input className="pl-10" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div></label>
            <label><span className="field-label">Password</span><div className="relative"><LockKeyhole className="absolute left-3 top-3 h-5 w-5 text-slate-400"/><Input className="pl-10" type="password" minLength={8} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required /></div></label>
            {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            {message && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
            <Button className="w-full" size="lg" disabled={busy}>{busy ? 'Memproses…' : mode === 'signin' ? 'Masuk' : 'Daftar'}</Button>
          </form>
          <div className="my-5 flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200"/>atau<span className="h-px flex-1 bg-slate-200"/></div>
          <div className="space-y-2"><Button variant="outline" className="w-full" type="button" onClick={sendMagicLink} disabled={busy}>Kirim magic link</Button><button type="button" className="w-full py-1 text-sm font-medium text-slate-500 hover:text-slate-950" onClick={forgotPassword}>Lupa password?</button></div>
          <button className="mt-6 w-full text-sm font-medium text-slate-600 hover:text-slate-950" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setMessage(null) }}>{mode === 'signin' ? 'Belum punya akun? Daftar' : 'Sudah punya akun? Masuk'}</button>
        </div>
      </section>
    </main>
  )
}
