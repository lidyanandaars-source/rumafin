import { useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { useQuery } from '@tanstack/react-query'
import { FileSpreadsheet, FileText, FilterX, LoaderCircle } from 'lucide-react'
import { useHousehold } from '@/hooks/useHousehold'
import { getFilteredReport, getFilteredReportTransactions } from '@/services/reports'
import { exportReportToExcel, exportReportToWord } from '@/services/report-export'
import { listAccounts } from '@/services/accounts'
import { listCategories } from '@/services/categories'
import { requireSupabase } from '@/lib/supabase'
import type { HouseholdRole, TransactionType } from '@/types/domain'
import { currentMonthRange } from '@/utils/date'
import { formatCurrency } from '@/utils/currency'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { EmptyState, LoadingState } from '@/components/ui/status'

interface ReportMember {
  user_id: string
  role: HouseholdRole
  profile: { display_name: string | null; email: string | null } | null
}

export function ReportsPage() {
  const { householdId, household } = useHousehold()
  const initial = currentMonthRange()
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [accountId, setAccountId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [memberId, setMemberId] = useState('')
  const [merchant, setMerchant] = useState('')
  const [transactionType, setTransactionType] = useState<'' | TransactionType>('')
  const [exportBusy, setExportBusy] = useState<'excel' | 'word' | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const accounts = useQuery({ queryKey: ['accounts', householdId], queryFn: () => listAccounts(householdId!), enabled: Boolean(householdId) })
  const categories = useQuery({ queryKey: ['categories', householdId], queryFn: () => listCategories(householdId!), enabled: Boolean(householdId) })
  const members = useQuery({
    queryKey: ['report-members', householdId],
    queryFn: async () => {
      const { data, error } = await requireSupabase().from('household_members').select('user_id,role,profile:profiles(display_name,email)').eq('household_id', householdId!).order('created_at')
      if (error) throw error
      return (data ?? []) as unknown as ReportMember[]
    },
    enabled: Boolean(householdId),
  })

  const filters = useMemo(() => ({ accountId, categoryId, memberId, merchant, transactionType: transactionType || null }), [accountId, categoryId, memberId, merchant, transactionType])
  const query = useQuery({
    queryKey: ['dashboard', 'report', householdId, from, to, filters],
    queryFn: () => getFilteredReport(householdId!, from, to, filters),
    enabled: Boolean(householdId && from && to),
  })
  const data = query.data
  const hasFilters = Boolean(accountId || categoryId || memberId || merchant || transactionType)

  const categoryBar = useMemo(() => ({
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => formatCurrency(v) },
    grid: { left: 20, right: 20, bottom: 20, top: 10, containLabel: true },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${Math.round(v / 1000)}k` } },
    yAxis: { type: 'category', data: [...(data?.categories ?? [])].reverse().map((c) => c.name) },
    series: [{ type: 'bar', data: [...(data?.categories ?? [])].reverse().map((c) => c.amount), barMaxWidth: 24 }],
  }), [data])

  const merchantBar = useMemo(() => ({
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => formatCurrency(v) },
    grid: { left: 20, right: 20, bottom: 20, top: 10, containLabel: true },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${Math.round(v / 1000)}k` } },
    yAxis: { type: 'category', data: [...(data?.merchants ?? [])].slice(0, 8).reverse().map((c) => c.name) },
    series: [{ type: 'bar', data: [...(data?.merchants ?? [])].slice(0, 8).reverse().map((c) => c.amount), barMaxWidth: 24 }],
  }), [data])

  const waterfall = useMemo(() => {
    const cats = (data?.categories ?? []).slice(0, 5)
    let running = data?.income ?? 0
    const labels = ['Income', ...cats.map((c) => c.name), 'Closing']
    const values: number[] = [data?.income ?? 0]
    const base: number[] = [0]
    for (const c of cats) {
      running -= c.amount
      base.push(Math.max(running, 0))
      values.push(c.amount)
    }
    base.push(0)
    values.push(data?.net_cash_flow ?? 0)
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => formatCurrency(v) },
      grid: { left: 20, right: 20, bottom: 35, top: 15, containLabel: true },
      xAxis: { type: 'category', data: labels, axisLabel: { rotate: 20 } },
      yAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${Math.round(v / 1_000_000)}jt` } },
      series: [
        { type: 'bar', stack: 'total', itemStyle: { borderColor: 'transparent', color: 'transparent' }, emphasis: { itemStyle: { borderColor: 'transparent', color: 'transparent' } }, data: base },
        { type: 'bar', stack: 'total', data: values },
      ],
    }
  }, [data])

  const heatmap = useMemo(() => {
    const days = data?.daily ?? []
    const max = Math.max(1, ...days.map((d) => d.expense))
    return {
      tooltip: { formatter: (p: { data: [string, number] }) => `${p.data[0]}<br/>${formatCurrency(p.data[1])}` },
      visualMap: { min: 0, max, show: false },
      calendar: { range: [from, to], cellSize: ['auto', 18], splitLine: { show: false }, itemStyle: { borderWidth: 2, borderColor: '#fff' } },
      series: [{ type: 'heatmap', coordinateSystem: 'calendar', data: days.map((d) => [d.date, d.expense]) }],
    }
  }, [data, from, to])

  const clearFilters = () => {
    setAccountId(''); setCategoryId(''); setMemberId(''); setMerchant(''); setTransactionType('')
  }

  const handleExport = async (format: 'excel' | 'word') => {
    if (!householdId || !data) return
    setExportBusy(format)
    setExportError(null)
    try {
      const transactions = await getFilteredReportTransactions(householdId, from, to, filters)
      const context = {
        householdName: household?.name ?? 'Rumah Tangga',
        currency: household?.default_currency ?? 'IDR',
        timezone: household?.timezone ?? 'Asia/Jakarta',
        from,
        to,
        filters,
        filterLabels: {
          account: accounts.data?.find((a) => a.id === accountId)?.name ?? null,
          category: categories.data?.find((c) => c.id === categoryId)?.name ?? null,
          member: members.data?.find((m) => m.user_id === memberId)?.profile?.display_name ?? members.data?.find((m) => m.user_id === memberId)?.profile?.email ?? null,
          merchant: merchant.trim() || null,
          transactionType: transactionType || null,
        },
        summary: data,
        transactions,
      }
      if (format === 'excel') await exportReportToExcel(context)
      else await exportReportToWord(context)
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Ekspor laporan gagal.')
    } finally {
      setExportBusy(null)
    }
  }

  return <main className="page">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="page-title">Laporan</h1><p className="page-subtitle">Semua angka dihitung PostgreSQL; AI tidak menjadi calculation engine.</p></div><div className="flex w-full gap-2 sm:w-auto"><Button className="flex-1 sm:flex-none" variant="outline" disabled={!data || Boolean(exportBusy)} onClick={() => handleExport('excel')}>{exportBusy === 'excel' ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <FileSpreadsheet className="h-4 w-4"/>}Excel</Button><Button className="flex-1 sm:flex-none" variant="outline" disabled={!data || Boolean(exportBusy)} onClick={() => handleExport('word')}>{exportBusy === 'word' ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <FileText className="h-4 w-4"/>}Word</Button></div></div>
    <div className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-2 xl:grid-cols-4">
      <label><span className="field-label">Dari</span><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label><span className="field-label">Sampai</span><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      <label><span className="field-label">Akun</span><Select value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Semua akun</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></label>
      <label><span className="field-label">Kategori / subkategori</span><Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">Semua kategori</option>{categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></label>
      <label><span className="field-label">Anggota</span><Select value={memberId} onChange={(e) => setMemberId(e.target.value)}><option value="">Semua anggota</option>{members.data?.map((m) => <option key={m.user_id} value={m.user_id}>{m.profile?.display_name || m.profile?.email || m.user_id}</option>)}</Select></label>
      <label><span className="field-label">Merchant</span><Input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="mis. Indomaret" /></label>
      <label><span className="field-label">Tipe transaksi</span><Select value={transactionType} onChange={(e) => setTransactionType(e.target.value as '' | TransactionType)}><option value="">Semua tipe</option><option value="EXPENSE">Expense</option><option value="INCOME">Income</option><option value="TRANSFER">Transfer</option><option value="ADJUSTMENT">Adjustment</option></Select></label>
      <div className="flex items-end">{hasFilters && <Button variant="outline" className="w-full" onClick={clearFilters}><FilterX className="h-4 w-4"/>Hapus filter</Button>}</div>
    </div>
    {exportError && <div className="mt-3 rounded-2xl bg-red-50 p-3 text-sm text-red-700">{exportError}</div>}

    {query.isLoading ? <LoadingState /> : query.error ? <div className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700">{query.error.message}</div> : <>
      <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {([['Income', data?.income ?? 0], ['Expenses', data?.expense ?? 0], ['Net Cash Flow', data?.net_cash_flow ?? 0], ['Savings Rate', data?.savings_rate == null ? null : data.savings_rate]] as const).map(([label, value]) => <Card key={label}><CardContent className="pt-5"><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-xl font-bold">{label === 'Savings Rate' ? (value == null ? '—' : `${Number(value).toFixed(1)}%`) : formatCurrency(Number(value))}</p></CardContent></Card>)}
      </section>
      {!data?.categories.length && !data?.merchants.length && (data?.income ?? 0) === 0 && (data?.expense ?? 0) === 0 ? <div className="mt-4"><EmptyState title="Tidak ada data pada filter ini" description="Ubah periode atau filter untuk melihat laporan." /></div> : <>
        <section className="mt-4 grid gap-4 xl:grid-cols-2"><Card><CardHeader><h2 className="font-bold">Perbandingan kategori</h2></CardHeader><CardContent><ReactECharts option={categoryBar} style={{ height: 320 }} /></CardContent></Card><Card><CardHeader><h2 className="font-bold">Top merchants</h2></CardHeader><CardContent><ReactECharts option={merchantBar} style={{ height: 320 }} /></CardContent></Card></section>
        <section className="mt-4 grid gap-4 xl:grid-cols-2"><Card><CardHeader><h2 className="font-bold">Cash-flow waterfall</h2></CardHeader><CardContent><ReactECharts option={waterfall} style={{ height: 320 }} /></CardContent></Card><Card><CardHeader><h2 className="font-bold">Kalender pengeluaran</h2></CardHeader><CardContent><ReactECharts option={heatmap} style={{ height: 320 }} /></CardContent></Card></section>
      </>}
    </>}
  </main>
}
