import type { DashboardSummary, ReportTransactionRow } from '@/types/domain'
import type { ReportFilters } from '@/services/reports'

export interface ReportExportContext {
  householdName: string
  currency: string
  timezone: string
  from: string
  to: string
  filters: ReportFilters
  filterLabels: {
    account?: string | null
    category?: string | null
    member?: string | null
    merchant?: string | null
    transactionType?: string | null
  }
  summary: DashboardSummary
  transactions: ReportTransactionRow[]
}

function safeFilename(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'rumafin'
}

function rupiah(value: number | null | undefined, currency = 'IDR') {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value ?? 0))
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

function filtersText(ctx: ReportExportContext) {
  const rows = [
    ['Periode', `${ctx.from} s.d. ${ctx.to}`],
    ['Akun', ctx.filterLabels.account || 'Semua akun'],
    ['Kategori', ctx.filterLabels.category || 'Semua kategori'],
    ['Anggota', ctx.filterLabels.member || 'Semua anggota'],
    ['Merchant', ctx.filterLabels.merchant || 'Semua merchant'],
    ['Tipe transaksi', ctx.filterLabels.transactionType || 'Semua tipe'],
  ]
  return rows
}

export async function exportReportToExcel(ctx: ReportExportContext) {
  const XLSX = await import('xlsx')
  const workbook = XLSX.utils.book_new()

  const summaryRows: Array<Array<string | number>> = [
    ['RumaFin — Laporan Keuangan Rumah Tangga'],
    ['Household', ctx.householdName],
    ...filtersText(ctx),
    [],
    ['Indikator', 'Nilai'],
    ['Income', ctx.summary.income],
    ['Expenses', ctx.summary.expense],
    ['Net Cash Flow', ctx.summary.net_cash_flow],
    ['Available Balance', ctx.summary.available_balance],
    ['Savings Rate (%)', ctx.summary.savings_rate ?? ''],
  ]
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows)
  summarySheet['!cols'] = [{ wch: 24 }, { wch: 32 }]
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Ringkasan')

  const categorySheet = XLSX.utils.json_to_sheet(ctx.summary.categories.map((row) => ({ Kategori: row.name, Pengeluaran: row.amount })))
  categorySheet['!cols'] = [{ wch: 28 }, { wch: 18 }]
  XLSX.utils.book_append_sheet(workbook, categorySheet, 'Kategori')

  const merchantSheet = XLSX.utils.json_to_sheet(ctx.summary.merchants.map((row) => ({ Merchant: row.name, Pengeluaran: row.amount })))
  merchantSheet['!cols'] = [{ wch: 30 }, { wch: 18 }]
  XLSX.utils.book_append_sheet(workbook, merchantSheet, 'Merchant')

  const dailySheet = XLSX.utils.json_to_sheet(ctx.summary.daily.map((row) => ({ Tanggal: row.date, Pengeluaran: row.expense, Pemasukan: row.income })))
  dailySheet['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 18 }]
  XLSX.utils.book_append_sheet(workbook, dailySheet, 'Harian')

  const accountSheet = XLSX.utils.json_to_sheet(ctx.summary.accounts.map((row) => ({ Akun: row.name, Tipe: row.account_type, Saldo: row.balance, Mata_Uang: row.currency })))
  accountSheet['!cols'] = [{ wch: 26 }, { wch: 20 }, { wch: 18 }, { wch: 12 }]
  XLSX.utils.book_append_sheet(workbook, accountSheet, 'Akun')

  const transactionSheet = XLSX.utils.json_to_sheet(ctx.transactions.map((row) => ({
    Tanggal: formatDateTime(row.transaction_at, ctx.timezone),
    Tipe: row.transaction_type,
    Merchant: row.merchant_name ?? '',
    Deskripsi: row.description ?? '',
    Nilai_dalam_Filter: row.filtered_amount,
    Total_Transaksi: row.total_amount,
    Mata_Uang: row.currency,
    Akun: row.accounts.map((a) => a.name).join(', '),
    Kategori: row.categories.map((c) => c.name).join(', '),
    Anggota: row.member_name,
    Sumber: row.source,
    Catatan: row.notes ?? '',
  })))
  transactionSheet['!cols'] = [
    { wch: 22 }, { wch: 14 }, { wch: 24 }, { wch: 34 }, { wch: 18 }, { wch: 18 },
    { wch: 12 }, { wch: 28 }, { wch: 28 }, { wch: 28 }, { wch: 14 }, { wch: 34 },
  ]
  XLSX.utils.book_append_sheet(workbook, transactionSheet, 'Transaksi')

  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeFilename(ctx.householdName)}-${ctx.from}-${ctx.to}.xlsx`)
}

export async function exportReportToWord(ctx: ReportExportContext) {
  const {
    AlignmentType,
    Document,
    HeadingLevel,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = await import('docx')

  const cell = (value: string | number, bold = false) => new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text: String(value), bold })] })],
  })
  const table = (headers: string[], rows: Array<Array<string | number>>) => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: headers.map((h) => cell(h, true)), tableHeader: true }),
      ...rows.map((row) => new TableRow({ children: row.map((v) => cell(v)) })),
    ],
  })

  const children: any[] = [
    new Paragraph({ text: 'RumaFin — Laporan Keuangan Rumah Tangga', heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
    new Paragraph({ children: [new TextRun({ text: ctx.householdName, bold: true })], alignment: AlignmentType.CENTER }),
    new Paragraph({ text: `Periode ${ctx.from} s.d. ${ctx.to}`, alignment: AlignmentType.CENTER }),
    new Paragraph({ text: '' }),
    new Paragraph({ text: 'Filter Laporan', heading: HeadingLevel.HEADING_1 }),
    table(['Filter', 'Nilai'], filtersText(ctx)),
    new Paragraph({ text: 'Ringkasan', heading: HeadingLevel.HEADING_1 }),
    table(['Indikator', 'Nilai'], [
      ['Income', rupiah(ctx.summary.income, ctx.currency)],
      ['Expenses', rupiah(ctx.summary.expense, ctx.currency)],
      ['Net Cash Flow', rupiah(ctx.summary.net_cash_flow, ctx.currency)],
      ['Available Balance', rupiah(ctx.summary.available_balance, ctx.currency)],
      ['Savings Rate', ctx.summary.savings_rate == null ? '—' : `${ctx.summary.savings_rate.toFixed(2)}%`],
    ]),
    new Paragraph({ text: 'Pengeluaran per Kategori', heading: HeadingLevel.HEADING_1 }),
    table(['Kategori', 'Pengeluaran'], ctx.summary.categories.map((r) => [r.name, rupiah(r.amount, ctx.currency)])),
    new Paragraph({ text: 'Top Merchant', heading: HeadingLevel.HEADING_1 }),
    table(['Merchant', 'Pengeluaran'], ctx.summary.merchants.map((r) => [r.name, rupiah(r.amount, ctx.currency)])),
    new Paragraph({ text: 'Saldo Akun', heading: HeadingLevel.HEADING_1 }),
    table(['Akun', 'Tipe', 'Saldo'], ctx.summary.accounts.map((r) => [r.name, r.account_type, rupiah(r.balance, r.currency)])),
    new Paragraph({ text: 'Transaksi', heading: HeadingLevel.HEADING_1 }),
  ]

  if (ctx.transactions.length) {
    children.push(table(
      ['Tanggal', 'Tipe', 'Merchant/Deskripsi', 'Nilai Filter', 'Total Transaksi', 'Akun', 'Kategori', 'Anggota'],
      ctx.transactions.map((r) => [
        formatDateTime(r.transaction_at, ctx.timezone),
        r.transaction_type,
        r.merchant_name || r.description || '—',
        rupiah(r.filtered_amount, r.currency),
        rupiah(r.total_amount, r.currency),
        r.accounts.map((a) => a.name).join(', ') || '—',
        r.categories.map((c) => c.name).join(', ') || '—',
        r.member_name || '—',
      ]),
    ))
  } else {
    children.push(new Paragraph({ text: 'Tidak ada transaksi pada filter ini.' }))
  }

  const documentFile = new Document({
    creator: 'RumaFin',
    title: `Laporan ${ctx.householdName} ${ctx.from} - ${ctx.to}`,
    description: 'Laporan keuangan rumah tangga diekspor dari RumaFin.',
    sections: [{ children }],
  })
  const blob = await Packer.toBlob(documentFile)
  downloadBlob(blob, `${safeFilename(ctx.householdName)}-${ctx.from}-${ctx.to}.docx`)
}
