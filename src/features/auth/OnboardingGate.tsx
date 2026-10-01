import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Home, LoaderCircle } from 'lucide-react'
import { useHousehold } from '@/hooks/useHousehold'
import { createHousehold } from '@/services/households'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LoadingState } from '@/components/ui/status'

export function OnboardingGate({ children }: { children: ReactNode }) {
  const { memberships, loading } = useHousehold()
  const qc = useQueryClient()
  const [name, setName] = useState('Rumah Tangga Saya')
  const mutation = useMutation({
    mutationFn: () => createHousehold({ name, currency: 'IDR', timezone: 'Asia/Jakarta' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memberships'] }),
  })

  if (loading) return <div className="grid min-h-screen place-items-center"><LoadingState label="Memuat rumah tangga…" /></div>
  if (memberships?.length) return children

  const submit = (e: FormEvent) => { e.preventDefault(); if (name.trim()) mutation.mutate() }
  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 p-5">
      <form onSubmit={submit} className="w-full max-w-lg rounded-3xl bg-white p-7 shadow-soft">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-950 text-white"><Home /></div>
        <h1 className="mt-5 text-2xl font-bold">Siapkan rumah tangga pertama</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">Kami akan membuat akun Cash dan kategori awal yang bisa Anda ubah kapan saja. Mata uang default IDR dan timezone Asia/Jakarta.</p>
        <label className="mt-6 block"><span className="field-label">Nama household</span><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></label>
        {mutation.error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{mutation.error.message}</p>}
        <Button className="mt-5 w-full" size="lg" disabled={mutation.isPending}>{mutation.isPending && <LoaderCircle className="h-4 w-4 animate-spin"/>}Mulai</Button>
      </form>
    </main>
  )
}
