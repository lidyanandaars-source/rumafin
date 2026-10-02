import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Home, List, Plus, BarChart3, Settings, WalletCards, Mic, ReceiptText, PenLine, Landmark, Tags, Target, Users, ChevronDown, LogOut, Menu as MenuIcon } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/utils/cn'
import { useHousehold } from '@/hooks/useHousehold'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { OfflineBanner } from '@/components/ui/status'
import { VoiceDialog } from '@/features/voice/VoiceDialog'
import { ReceiptDialog } from '@/features/receipts/ReceiptDialog'
import { syncOfflineDrafts } from '@/services/offline'
import { requireSupabase } from '@/lib/supabase'

const desktopNav = [
  { to: '/', label: 'Dashboard', icon: Home },
  { to: '/transactions', label: 'Transaksi', icon: List },
  { to: '/accounts', label: 'Akun', icon: Landmark },
  { to: '/categories', label: 'Kategori', icon: Tags },
  { to: '/budgets', label: 'Budget', icon: Target },
  { to: '/reports', label: 'Laporan', icon: BarChart3 },
  { to: '/members', label: 'Anggota', icon: Users },
  { to: '/settings', label: 'Pengaturan', icon: Settings },
]

function NavItem({ to, label, icon: Icon, mobile = false }: { to: string; label: string; icon: typeof Home; mobile?: boolean }) {
  return <NavLink end={to === '/'} to={to} className={({ isActive }) => cn(mobile ? 'flex flex-1 flex-col items-center gap-1 py-2 text-[11px]' : 'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium', isActive ? (mobile ? 'text-slate-950' : 'bg-slate-900 text-white') : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900')}><Icon className={cn(mobile ? 'h-5 w-5' : 'h-4.5 w-4.5')} />{label}</NavLink>
}

export function AppShell() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { household, householdId, memberships, setHouseholdId } = useHousehold()
  const [online, setOnline] = useState(navigator.onLine)
  const [addOpen, setAddOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  async function signOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await requireSupabase().auth.signOut()
      qc.clear()
      navigate('/')
    } finally {
      setSigningOut(false)
    }
  }

  useEffect(() => {
    const onOnline = async () => {
      setOnline(true)
      const result = await syncOfflineDrafts()
      if (result.synced) await qc.invalidateQueries({ queryKey: ['transactions'] })
    }
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [qc])

  return (
    <div className="min-h-screen bg-slate-50">
      {!online && <div className="fixed inset-x-0 top-0 z-[70]"><OfflineBanner /></div>}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white p-4 md:flex md:flex-col">
        <div className="flex items-center gap-3 px-2 py-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-950 text-white"><WalletCards className="h-5 w-5" /></div><div><p className="font-bold">RumaFin AI</p><p className="text-xs text-slate-400">Household Finance</p></div></div>
        <div className="mt-4 rounded-2xl border border-slate-200 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Household</p>
          <div className="relative mt-1">
            <select value={householdId ?? ''} onChange={(e) => setHouseholdId(e.target.value)} className="w-full appearance-none bg-transparent pr-6 text-sm font-semibold outline-none">
              {(memberships ?? []).map((m) => <option key={m.household_id} value={m.household_id}>{m.household?.name ?? 'Household'}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-0.5 h-4 w-4 text-slate-400" />
          </div>
        </div>
        <nav className="mt-5 space-y-1">{desktopNav.map((item) => <NavItem key={item.to} {...item} />)}</nav>
        <div className="mt-auto rounded-2xl bg-slate-950 p-4 text-white"><p className="text-sm font-semibold">Input cepat</p><p className="mt-1 text-xs leading-5 text-slate-300">Suara dan receipt selalu direview sebelum perubahan sensitif.</p><Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4"/>Tambah</Button></div>
      </aside>

      <div className="md:pl-64">
        <header className="sticky top-0 z-20 hidden h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-6 backdrop-blur md:flex">
          <div><p className="text-sm font-semibold text-slate-900">{household?.name}</p><p className="text-xs text-slate-400">{household?.default_currency} · {household?.timezone}</p></div>
          <Button variant="outline" onClick={signOut} disabled={signingOut}><LogOut className="h-4 w-4"/>{signingOut ? 'Keluar…' : 'Logout'}</Button>
        </header>
        <Outlet />
      </div>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex items-end border-t border-slate-200 bg-white/95 px-2 backdrop-blur md:hidden">
        <NavItem to="/" label="Home" icon={Home} mobile />
        <NavItem to="/transactions" label="Transaksi" icon={List} mobile />
        <button aria-label="Tambah" onClick={() => setAddOpen(true)} className="-mt-5 flex w-16 flex-col items-center"><span className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-950 text-white shadow-lg"><Plus className="h-7 w-7"/></span><span className="mt-1 text-[11px] font-semibold text-slate-950">Tambah</span></button>
        <NavItem to="/reports" label="Laporan" icon={BarChart3} mobile />
        <button aria-label="Menu lengkap" onClick={() => setMoreOpen(true)} className="flex flex-1 flex-col items-center gap-1 py-2 text-[11px] text-slate-500"><MenuIcon className="h-5 w-5" />Menu</button>
      </nav>

      <Dialog open={addOpen} onOpenChange={setAddOpen} title="Tambah pencatatan" description="Pilih cara paling cepat untuk transaksi ini.">
        <div className="grid gap-3 sm:grid-cols-3">
          <button onClick={() => { setAddOpen(false); setVoiceOpen(true) }} className="rounded-2xl border border-slate-200 p-5 text-left hover:bg-slate-50"><Mic className="mb-5 h-7 w-7"/><p className="font-semibold">Voice</p><p className="mt-1 text-xs text-slate-500">Ucapkan transaksi atau perubahan.</p></button>
          <button onClick={() => { setAddOpen(false); setReceiptOpen(true) }} className="rounded-2xl border border-slate-200 p-5 text-left hover:bg-slate-50"><ReceiptText className="mb-5 h-7 w-7"/><p className="font-semibold">Receipt</p><p className="mt-1 text-xs text-slate-500">Foto atau upload struk.</p></button>
          <button onClick={() => { setAddOpen(false); navigate('/transactions/new') }} className="rounded-2xl border border-slate-200 p-5 text-left hover:bg-slate-50"><PenLine className="mb-5 h-7 w-7"/><p className="font-semibold">Manual</p><p className="mt-1 text-xs text-slate-500">Isi form tanpa AI.</p></button>
        </div>
      </Dialog>


      <Dialog open={moreOpen} onOpenChange={setMoreOpen} title="Menu lengkap" description="Semua fitur desktop juga tersedia di tampilan HP.">
        <div className="mb-4 rounded-2xl border border-slate-200 p-3">
          <label className="field-label">Household aktif</label>
          <div className="relative">
            <select value={householdId ?? ''} onChange={(e) => setHouseholdId(e.target.value)} className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-9 text-sm font-semibold outline-none">
              {(memberships ?? []).map((m) => <option key={m.household_id} value={m.household_id}>{m.household?.name ?? 'Household'}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { to: '/accounts', label: 'Akun & tipe akun', description: 'Tambah akun, saldo awal, dan tipe akun.', icon: Landmark },
            { to: '/categories', label: 'Kategori', description: 'Tambah kategori dan subkategori.', icon: Tags },
            { to: '/budgets', label: 'Budget', description: 'Kelola budget rumah tangga.', icon: Target },
            { to: '/reports', label: 'Laporan & ekspor', description: 'Lihat laporan serta ekspor Excel/Word.', icon: BarChart3 },
            { to: '/members', label: 'Anggota', description: 'Kelola anggota household.', icon: Users },
            { to: '/settings', label: 'Pengaturan', description: 'Privasi, audit, dan pengaturan aplikasi.', icon: Settings },
          ].map((item) => {
            const Icon = item.icon
            return <button key={item.to} onClick={() => { setMoreOpen(false); navigate(item.to) }} className="rounded-2xl border border-slate-200 p-4 text-left hover:bg-slate-50"><Icon className="mb-4 h-6 w-6"/><p className="text-sm font-semibold">{item.label}</p><p className="mt-1 text-xs leading-5 text-slate-500">{item.description}</p></button>
          })}
        </div>
        <Button variant="outline" className="mt-4 w-full" onClick={signOut} disabled={signingOut}><LogOut className="h-4 w-4"/>{signingOut ? 'Keluar…' : 'Logout'}</Button>
      </Dialog>

      <VoiceDialog open={voiceOpen} onOpenChange={setVoiceOpen} />
      <ReceiptDialog open={receiptOpen} onOpenChange={setReceiptOpen} />
    </div>
  )
}
