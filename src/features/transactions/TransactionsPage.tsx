import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, SlidersHorizontal, Plus, Pencil, Trash2, RotateCcw, ChevronRight } from 'lucide-react'
import { useHousehold } from '@/hooks/useHousehold'
import { listTransactions, restoreTransaction, softDeleteTransaction, type TransactionFilters } from '@/services/transactions'
import { listAccounts } from '@/services/accounts'
import { listCategories } from '@/services/categories'
import type { Transaction } from '@/types/domain'
import { formatCurrency } from '@/utils/currency'
import { formatDateId } from '@/utils/date'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState, LoadingState } from '@/components/ui/status'
import { TransactionDetailDialog } from './TransactionDetailDialog'

export function TransactionsPage() {
  const { householdId } = useHousehold()
  const qc = useQueryClient()
  const [filters, setFilters] = useState<TransactionFilters>({ search: '', type: '', includeDeleted: false })
  const [selected, setSelected] = useState<Transaction | null>(null)
  const query = useQuery({ queryKey: ['transactions', householdId, filters], queryFn: () => listTransactions(householdId!, filters), enabled: Boolean(householdId) })
  const accounts = useQuery({ queryKey: ['accounts', householdId], queryFn: () => listAccounts(householdId!), enabled: Boolean(householdId) })
  const categories = useQuery({ queryKey: ['categories', householdId], queryFn: () => listCategories(householdId!), enabled: Boolean(householdId) })
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['transactions'] }), qc.invalidateQueries({ queryKey: ['dashboard'] }), qc.invalidateQueries({ queryKey: ['accounts'] })])
  const remove = useMutation({ mutationFn: softDeleteTransaction, onSuccess: refresh })
  const restore = useMutation({ mutationFn: restoreTransaction, onSuccess: refresh })

  return <main className="page">
    <div className="flex items-end justify-between gap-4">
      <div><h1 className="page-title">Transaksi</h1><p className="page-subtitle">Cari, filter, koreksi, dan audit pencatatan household. Klik transaksi untuk melihat detail dan bukti receipt.</p></div>
      <Link to="/transactions/new"><Button><Plus className="h-4 w-4"/>Tambah</Button></Link>
    </div>
    <div className="mt-6 grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 md:grid-cols-2 xl:grid-cols-4">
      <div className="relative md:col-span-2 xl:col-span-2"><Search className="absolute left-3 top-3 h-5 w-5 text-slate-400"/><Input className="pl-10" placeholder="Cari merchant atau deskripsi…" value={filters.search ?? ''} onChange={(e) => setFilters({ ...filters, search: e.target.value })}/></div>
      <Select value={filters.type ?? ''} onChange={(e) => setFilters({ ...filters, type: e.target.value as TransactionFilters['type'] })}><option value="">Semua tipe</option><option value="EXPENSE">Expense</option><option value="INCOME">Income</option><option value="TRANSFER">Transfer</option></Select>
      <Button variant={filters.includeDeleted ? 'secondary' : 'outline'} onClick={() => setFilters({ ...filters, includeDeleted: !filters.includeDeleted })}><SlidersHorizontal className="h-4 w-4"/>{filters.includeDeleted ? 'Termasuk dihapus' : 'Aktif saja'}</Button>
      <Input type="date" value={filters.from ?? ''} onChange={(e)=>setFilters({...filters,from:e.target.value||undefined})}/>
      <Input type="date" value={filters.to ?? ''} onChange={(e)=>setFilters({...filters,to:e.target.value||undefined})}/>
      <Select value={filters.accountId ?? ''} onChange={(e)=>setFilters({...filters,accountId:e.target.value||undefined})}><option value="">Semua akun</option>{accounts.data?.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select>
      <Select value={filters.categoryId ?? ''} onChange={(e)=>setFilters({...filters,categoryId:e.target.value||undefined})}><option value="">Semua kategori</option>{categories.data?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select>
    </div>
    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {query.isLoading ? <LoadingState /> : !query.data?.length ? <div className="p-5"><EmptyState title="Tidak ada transaksi" description="Ubah filter atau tambahkan transaksi baru."/></div> : <div className="divide-y divide-slate-100">{query.data.map((t) => <div
        key={t.id}
        role="button"
        tabIndex={0}
        onClick={() => setSelected(t)}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(t) } }}
        className={`flex cursor-pointer flex-col gap-3 p-4 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-slate-300 sm:flex-row sm:items-center ${t.deleted_at ? 'bg-slate-50 opacity-60' : ''}`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3"><div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl font-bold ${t.transaction_type === 'INCOME' ? 'bg-emerald-50 text-emerald-700' : t.transaction_type === 'TRANSFER' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>{t.transaction_type === 'INCOME' ? '+' : t.transaction_type === 'TRANSFER' ? '↔' : '−'}</div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-semibold">{t.merchant_name || t.description || t.transaction_type}</p><Badge>{t.source}</Badge>{t.deleted_at && <Badge className="bg-red-50 text-red-700">Deleted</Badge>}</div><p className="mt-1 text-xs text-slate-400">{formatDateId(t.transaction_at)} · {t.splits?.map(s => s.category?.name).filter(Boolean).join(', ') || 'Tanpa kategori'}</p></div></div>
        <div className="flex items-center justify-between gap-4 sm:justify-end"><p className={`text-base font-bold ${t.transaction_type === 'INCOME' ? 'text-emerald-600' : ''}`}>{t.transaction_type === 'INCOME' ? '+' : t.transaction_type === 'EXPENSE' ? '−' : ''}{formatCurrency(t.total_amount, t.currency)}</p><div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>{t.deleted_at ? <Button size="icon" variant="ghost" title="Restore" disabled={restore.isPending} onClick={() => restore.mutate(t.id)}><RotateCcw className="h-4 w-4"/></Button> : <><Link to={`/transactions/${t.id}/edit`}><Button size="icon" variant="ghost" title="Edit"><Pencil className="h-4 w-4"/></Button></Link><Button size="icon" variant="ghost" title="Hapus" disabled={remove.isPending} onClick={() => { if (window.confirm('Hapus transaksi ini? Data akan di-soft-delete dan dapat direstore.')) remove.mutate(t.id) }}><Trash2 className="h-4 w-4 text-red-600"/></Button></>}<ChevronRight className="h-4 w-4 text-slate-300"/></div></div>
      </div>)}</div>}
    </div>

    <TransactionDetailDialog transaction={selected} open={Boolean(selected)} onOpenChange={(value) => { if (!value) setSelected(null) }} />
  </main>
}
