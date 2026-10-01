import ReactECharts from 'echarts-for-react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownRight, ArrowUpRight, Wallet, PiggyBank, Plus, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useHousehold } from '@/hooks/useHousehold'
import { getDashboardSummary } from '@/services/reports'
import { currentMonthRange, formatDateId } from '@/utils/date'
import { formatCurrency } from '@/utils/currency'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { LoadingState, EmptyState } from '@/components/ui/status'

const kpiMeta = [
  { key: 'income', label: 'Pemasukan', icon: ArrowUpRight },
  { key: 'expense', label: 'Pengeluaran', icon: ArrowDownRight },
  { key: 'net_cash_flow', label: 'Net Cash Flow', icon: PiggyBank },
  { key: 'available_balance', label: 'Saldo Tersedia', icon: Wallet },
] as const

export function DashboardPage() {
  const { householdId, household } = useHousehold(); const range = currentMonthRange()
  const query = useQuery({ queryKey: ['dashboard', householdId, range.from, range.to], queryFn: () => getDashboardSummary(householdId!, range.from, range.to), enabled: Boolean(householdId) })
  const data = query.data

  if (query.isLoading) return <main className="page"><LoadingState label="Menyiapkan dashboard…"/></main>
  if (query.error) return <main className="page"><div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{query.error.message}</div></main>

  const categoryOption = {
    tooltip: { trigger: 'item', valueFormatter: (v: number) => formatCurrency(v) },
    legend: { bottom: 0, type: 'scroll' },
    series: [{ type: 'pie', radius: ['46%', '70%'], center: ['50%', '42%'], label: { show: false }, data: data?.categories.map((c) => ({ name: c.name, value: c.amount })) ?? [] }],
  }
  const trendOption = {
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => formatCurrency(v) },
    grid: { left: 20, right: 15, top: 20, bottom: 28, containLabel: true },
    xAxis: { type: 'category', data: data?.daily.map((d) => d.date.slice(8)) ?? [], axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${Math.round(v / 1000)}k` }, splitLine: { lineStyle: { color: '#e2e8f0' } } },
    series: [{ type: 'line', smooth: true, symbol: 'none', areaStyle: { opacity: 0.08 }, data: data?.daily.map((d) => d.expense) ?? [] }],
  }

  return <main className="page">
    <div className="flex items-end justify-between gap-4"><div><p className="text-sm font-medium text-slate-500">{new Intl.DateTimeFormat('id-ID', { weekday: 'long' }).format(new Date())}</p><h1 className="page-title">Ringkasan {household?.name}</h1><p className="page-subtitle">{new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date())}</p></div><Link to="/transactions/new" className="hidden items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white sm:flex"><Plus className="h-4 w-4"/>Transaksi</Link></div>

    <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{kpiMeta.map(({ key, label, icon: Icon }) => <Card key={key}><CardContent className="pt-5"><div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100"><Icon className="h-5 w-5"/></span><span className="text-xs font-medium text-slate-400">Bulan ini</span></div><p className="mt-5 text-sm text-slate-500">{label}</p><p className="mt-1 text-xl font-bold tracking-tight">{formatCurrency(data?.[key] ?? 0)}</p>{key === 'net_cash_flow' && data?.savings_rate != null && <p className="mt-2 text-xs text-slate-400">Savings rate {data.savings_rate.toFixed(1)}%</p>}</CardContent></Card>)}</section>

    <section className="mt-4 grid gap-4 xl:grid-cols-5">
      <Card className="xl:col-span-3"><CardHeader><h2 className="font-bold">Tren pengeluaran</h2><p className="text-xs text-slate-500">Pengeluaran harian bulan berjalan</p></CardHeader><CardContent>{data?.daily.length ? <ReactECharts option={trendOption} style={{ height: 280 }} /> : <EmptyState title="Belum ada tren" description="Tambahkan transaksi untuk mulai melihat pola."/>}</CardContent></Card>
      <Card className="xl:col-span-2"><CardHeader><h2 className="font-bold">Pengeluaran per kategori</h2><p className="text-xs text-slate-500">Distribusi kategori utama</p></CardHeader><CardContent>{data?.categories.length ? <ReactECharts option={categoryOption} style={{ height: 280 }} /> : <EmptyState title="Belum ada kategori terpakai" description="Transaksi expense akan muncul di sini."/>}</CardContent></Card>
    </section>

    <section className="mt-4 grid gap-4 xl:grid-cols-5">
      <Card className="xl:col-span-3"><CardHeader className="flex flex-row items-center justify-between"><div><h2 className="font-bold">Transaksi terbaru</h2><p className="text-xs text-slate-500">Aktivitas household terbaru</p></div><Link className="text-sm font-semibold text-slate-700" to="/transactions">Lihat semua</Link></CardHeader><CardContent className="space-y-1">{data?.recent_transactions?.length ? data.recent_transactions.slice(0, 6).map((t) => <div key={t.id} className="flex items-center gap-3 border-t border-slate-100 py-3 first:border-0"><div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-sm font-bold">{t.transaction_type === 'INCOME' ? '+' : t.transaction_type === 'TRANSFER' ? '↔' : '−'}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{t.merchant_name || t.description || t.transaction_type}</p><p className="text-xs text-slate-400">{formatDateId(t.transaction_at)} · {t.source}</p></div><p className={`text-sm font-bold ${t.transaction_type === 'INCOME' ? 'text-emerald-600' : ''}`}>{t.transaction_type === 'INCOME' ? '+' : t.transaction_type === 'EXPENSE' ? '−' : ''}{formatCurrency(t.total_amount, t.currency)}</p></div>) : <EmptyState title="Belum ada transaksi" description="Tambahkan transaksi pertama Anda."/>}</CardContent></Card>
      <Card className="xl:col-span-2"><CardHeader><h2 className="font-bold">Saldo akun</h2><p className="text-xs text-slate-500">Dihitung dari account movements</p></CardHeader><CardContent className="space-y-2">{data?.accounts?.map((a) => <Link to="/accounts" key={a.id} className="flex items-center gap-3 rounded-xl p-3 hover:bg-slate-50"><div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100"><Wallet className="h-5 w-5"/></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{a.name}</p><p className="text-xs text-slate-400">{a.account_type}</p></div><div className="text-right"><p className="text-sm font-bold">{formatCurrency(a.balance, a.currency)}</p></div><ChevronRight className="h-4 w-4 text-slate-300"/></Link>)}</CardContent></Card>
    </section>

    <section className="mt-4">
      <Card><CardHeader className="flex flex-row items-center justify-between"><div><h2 className="font-bold">Progress budget</h2><p className="text-xs text-slate-500">Realisasi kategori terhadap budget bulan berjalan</p></div><Link className="text-sm font-semibold text-slate-700" to="/budgets">Kelola budget</Link></CardHeader><CardContent>{data?.budgets?.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{data.budgets.slice(0, 6).map((b) => { const ratio = Math.max(0, Math.min(100, Number(b.ratio) || 0)); return <div key={b.category_id} className="rounded-xl border border-slate-100 p-4"><div className="flex items-center justify-between gap-3"><p className="truncate text-sm font-semibold">{b.category}</p><span className="text-xs font-semibold text-slate-500">{Number(b.ratio).toFixed(0)}%</span></div><p className="mt-2 text-sm text-slate-500">{formatCurrency(b.actual)} / {formatCurrency(b.budget)}</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${ratio >= 100 ? 'bg-red-600' : ratio >= 90 ? 'bg-amber-500' : 'bg-slate-900'}`} style={{ width: `${ratio}%` }} /></div></div>})}</div> : <EmptyState title="Belum ada budget" description="Tambahkan budget kategori untuk memantau progress bulanan." />}</CardContent></Card>
    </section>
  </main>
}
