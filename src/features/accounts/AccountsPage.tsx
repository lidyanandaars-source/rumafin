import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Landmark, Pencil, Plus, Settings2, Trash2 } from 'lucide-react'
import { useHousehold } from '@/hooks/useHousehold'
import {
  archiveAccount,
  createAccountType,
  deleteAccountType,
  listAccounts,
  listAccountTypes,
  saveAccount,
  updateAccountType,
} from '@/services/accounts'
import type { AccountTypeDefinition } from '@/types/domain'
import { formatCurrency } from '@/utils/currency'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { EmptyState, LoadingState } from '@/components/ui/status'

const emptyTypeForm = { id: '', name: '', icon: '', color: '' }

export function AccountsPage() {
  const { householdId, household, role } = useHousehold()
  const qc = useQueryClient()
  const canManage = role === 'OWNER' || role === 'ADMIN'
  const [open, setOpen] = useState(false)
  const [typesOpen, setTypesOpen] = useState(false)
  const [typeEditorOpen, setTypeEditorOpen] = useState(false)
  const [form, setForm] = useState({ name: '', account_type_id: '', opening_balance: '0' })
  const [typeForm, setTypeForm] = useState(emptyTypeForm)
  const [error, setError] = useState<string | null>(null)
  const [typeError, setTypeError] = useState<string | null>(null)

  const query = useQuery({ queryKey: ['accounts', householdId], queryFn: () => listAccounts(householdId!), enabled: Boolean(householdId) })
  const types = useQuery({ queryKey: ['account-types', householdId], queryFn: () => listAccountTypes(householdId!), enabled: Boolean(householdId) })

  const defaultTypeId = useMemo(() => {
    const rows = types.data ?? []
    return rows.find((t) => t.legacy_type === 'CASH')?.id ?? rows[0]?.id ?? ''
  }, [types.data])

  useEffect(() => {
    if (!form.account_type_id && defaultTypeId) setForm((current) => ({ ...current, account_type_id: defaultTypeId }))
  }, [defaultTypeId, form.account_type_id])

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['accounts'] }),
    qc.invalidateQueries({ queryKey: ['account-types'] }),
    qc.invalidateQueries({ queryKey: ['dashboard'] }),
  ])

  const create = useMutation({
    mutationFn: () => saveAccount({
      household_id: householdId!,
      name: form.name.trim(),
      account_type_id: form.account_type_id,
      currency: household?.default_currency ?? 'IDR',
      opening_balance: Number(form.opening_balance) || 0,
    }),
    onSuccess: async () => {
      await refresh()
      setOpen(false)
      setForm({ name: '', account_type_id: defaultTypeId, opening_balance: '0' })
    },
    onError: (e) => setError(e.message),
  })
  const archive = useMutation({ mutationFn: archiveAccount, onSuccess: refresh })
  const createType = useMutation({
    mutationFn: () => createAccountType({ household_id: householdId!, name: typeForm.name.trim(), icon: typeForm.icon.trim() || null, color: typeForm.color.trim() || null }),
    onSuccess: async () => { await refresh(); setTypeEditorOpen(false); setTypeForm(emptyTypeForm) },
    onError: (e) => setTypeError(e.message),
  })
  const editType = useMutation({
    mutationFn: () => updateAccountType({ id: typeForm.id, name: typeForm.name.trim(), icon: typeForm.icon.trim() || null, color: typeForm.color.trim() || null }),
    onSuccess: async () => { await refresh(); setTypeEditorOpen(false); setTypeForm(emptyTypeForm) },
    onError: (e) => setTypeError(e.message),
  })
  const removeType = useMutation({
    mutationFn: deleteAccountType,
    onSuccess: refresh,
    onError: (e) => setTypeError(e.message),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!form.name.trim()) return setError('Nama akun wajib diisi.')
    if (!form.account_type_id) return setError('Pilih tipe akun.')
    if (!Number.isFinite(Number(form.opening_balance)) || Number(form.opening_balance) < 0) return setError('Saldo awal tidak valid.')
    create.mutate()
  }

  const submitType = (e: FormEvent) => {
    e.preventDefault()
    setTypeError(null)
    if (!typeForm.name.trim()) return setTypeError('Nama tipe akun wajib diisi.')
    if (typeForm.id) editType.mutate()
    else createType.mutate()
  }

  const openTypeEditor = (type?: AccountTypeDefinition) => {
    setTypeError(null)
    setTypeForm(type ? { id: type.id, name: type.name, icon: type.icon ?? '', color: type.color ?? '' } : emptyTypeForm)
    setTypeEditorOpen(true)
  }

  return <main className="page">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="page-title">Akun</h1><p className="page-subtitle">Kelola rekening, saldo awal, dan tipe akun yang dapat dikustomisasi.</p></div>
      {canManage && <div className="flex w-full gap-2 sm:w-auto"><Button className="flex-1 sm:flex-none" variant="outline" onClick={() => setTypesOpen(true)}><Settings2 className="h-4 w-4"/>Tipe akun</Button><Button className="flex-1 sm:flex-none" onClick={() => setOpen(true)}><Plus className="h-4 w-4"/>Akun</Button></div>}
    </div>

    {query.isLoading ? <LoadingState/> : <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {query.data?.length ? query.data.map((a) => <Card key={a.id} className={!a.is_active ? 'opacity-50' : ''}><CardContent className="pt-5">
        <div className="flex items-start justify-between"><div className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100"><Landmark className="h-5 w-5"/></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500">{a.account_type_name ?? a.account_type}</span></div>
        <p className="mt-5 font-semibold">{a.name}</p><p className="mt-1 text-2xl font-bold">{formatCurrency(a.current_balance ?? a.opening_balance, a.currency)}</p><p className="mt-2 text-xs text-slate-400">Saldo awal {formatCurrency(a.opening_balance, a.currency)}</p>
        {canManage && a.is_active && <Button className="mt-4" size="sm" variant="ghost" onClick={() => { if(window.confirm('Arsipkan akun? Riwayat transaksi tetap dipertahankan.')) archive.mutate(a.id) }}><Archive className="h-4 w-4"/>Arsipkan</Button>}
      </CardContent></Card>) : <div className="sm:col-span-2 xl:col-span-3"><EmptyState title="Belum ada akun" description="Tambahkan Cash atau rekening pertama."/></div>}
    </div>}

    <Dialog open={open} onOpenChange={setOpen} title="Tambah akun"><form className="space-y-4" onSubmit={submit}>
      <label><span className="field-label">Nama</span><Input value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} placeholder="BCA, Cash Hendra, GoPay" required/></label>
      <label><span className="field-label">Tipe</span><Select value={form.account_type_id} onChange={(e)=>setForm({...form,account_type_id:e.target.value})} required><option value="">Pilih tipe akun</option>{types.data?.map((t)=><option key={t.id} value={t.id}>{t.name}</option>)}</Select></label>
      <label><span className="field-label">Saldo awal</span><Input type="number" min="0" value={form.opening_balance} onChange={(e)=>setForm({...form,opening_balance:e.target.value})}/></label>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={()=>setOpen(false)}>Batal</Button><Button disabled={create.isPending || types.isLoading}>Simpan</Button></div>
    </form></Dialog>

    <Dialog open={typesOpen} onOpenChange={setTypesOpen} title="Kelola tipe akun">
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-slate-500">Tipe dapat ditambah, diganti nama, atau dihapus dari pilihan. Akun lama tetap mempertahankan riwayatnya.</p><Button className="w-full sm:w-auto" size="sm" onClick={() => openTypeEditor()}><Plus className="h-4 w-4"/>Tipe</Button></div>
        {types.isLoading ? <LoadingState/> : !types.data?.length ? <EmptyState title="Belum ada tipe akun" description="Tambahkan tipe akun pertama."/> : <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">{types.data.map((t) => <div key={t.id} className="flex items-center gap-3 bg-white p-3"><div className="min-w-0 flex-1"><p className="font-semibold">{t.name}</p><p className="text-xs text-slate-400">{t.is_system ? 'Tipe bawaan' : 'Tipe kustom'} · kompatibilitas {t.legacy_type}</p></div><Button size="icon" variant="ghost" title="Edit tipe" onClick={() => openTypeEditor(t)}><Pencil className="h-4 w-4"/></Button><Button size="icon" variant="ghost" title="Hapus tipe" disabled={removeType.isPending} onClick={() => { if (window.confirm(`Hapus tipe akun “${t.name}” dari pilihan? Akun lama yang memakai tipe ini tetap tersimpan.`)) removeType.mutate(t.id) }}><Trash2 className="h-4 w-4 text-red-600"/></Button></div>)}</div>}
        {typeError && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{typeError}</p>}
      </div>
    </Dialog>

    <Dialog open={typeEditorOpen} onOpenChange={setTypeEditorOpen} title={typeForm.id ? 'Edit tipe akun' : 'Tambah tipe akun'}><form className="space-y-4" onSubmit={submitType}>
      <label><span className="field-label">Nama tipe</span><Input value={typeForm.name} onChange={(e)=>setTypeForm({...typeForm,name:e.target.value})} placeholder="Mis. Investasi, Crypto, Rekening Bersama" required maxLength={80}/></label>
      <label><span className="field-label">Ikon (opsional)</span><Input value={typeForm.icon} onChange={(e)=>setTypeForm({...typeForm,icon:e.target.value})} placeholder="wallet, landmark, bitcoin"/></label>
      <label><span className="field-label">Warna (opsional)</span><Input value={typeForm.color} onChange={(e)=>setTypeForm({...typeForm,color:e.target.value})} placeholder="#0f172a"/></label>
      {typeError && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{typeError}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={()=>setTypeEditorOpen(false)}>Batal</Button><Button disabled={createType.isPending || editType.isPending}>Simpan</Button></div>
    </form></Dialog>
  </main>
}
