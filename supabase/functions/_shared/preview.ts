function norm(value?: string | null) {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function jakartaDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function resolveDate(command: any, selector = false) {
  const source = selector ? (command.selector ?? {}) : command
  if (source.date) return source.date
  const ref = selector ? source.relative_date : source.date_reference
  if (selector && !ref) return null
  return ref === 'YESTERDAY' ? jakartaDate(-1) : jakartaDate(0)
}

export async function matchAccount(admin: any, householdId: string, hint?: string | null, includeInactive = false) {
  const n = norm(hint)
  if (!n) return null

  let query = admin
    .from('account_balances')
    .select('id,name,account_type,account_type_id,account_type_name,currency,opening_balance,current_balance,is_active')
    .eq('household_id', householdId)

  if (!includeInactive) query = query.eq('is_active', true)

  const { data, error } = await query.order('name')
  if (error) throw error

  const accounts = data ?? []
  if (!accounts.length) return null
  if (n) {
    const exact = accounts.find((a: any) => norm(a.name) === n)
    if (exact) return exact
    const partials = accounts.filter(
      (a: any) => norm(a.name).includes(n) || n.includes(norm(a.name)),
    )
    if (partials.length === 1) return partials[0]
    return null
  }

  return null
}

async function findAccountCandidates(admin: any, householdId: string, command: any) {
  const selector = command.account_selector ?? {}
  const hint = selector.name ?? command.account_hint

  const { data, error } = await admin
    .from('account_balances')
    .select('id,name,account_type,account_type_id,account_type_name,currency,opening_balance,current_balance,is_active')
    .eq('household_id', householdId)
    .order('name')

  if (error) throw error
  let accounts = data ?? []

  if (selector.account_type) {
    accounts = accounts.filter((a: any) => norm(a.account_type_name) === norm(selector.account_type) || norm(a.account_type) === norm(selector.account_type))
  }

  const n = norm(hint)
  if (!n) return []
  if (n) {
    const exact = accounts.filter((a: any) => norm(a.name) === n)
    if (exact.length) return exact
    accounts = accounts.filter(
      (a: any) => norm(a.name).includes(n) || n.includes(norm(a.name)),
    )
  }

  return accounts.slice(0, 20)
}


async function matchAccountType(admin: any, householdId: string, hint?: string | null) {
  const n = norm(hint)
  if (!n) return null
  const { data, error } = await admin
    .from('account_types')
    .select('id,name,legacy_type,icon,color,is_system,deleted_at')
    .eq('household_id', householdId)
    .is('deleted_at', null)
    .order('is_system', { ascending: false })
    .order('name')
  if (error) throw error
  const types = data ?? []
  const aliases: Record<string, string> = {
    cash: 'cash', tunai: 'cash', bank: 'bank', rekening: 'bank',
    ewallet: 'e wallet', 'e wallet': 'e wallet', 'dompet digital': 'e wallet',
    'credit card': 'kartu kredit', 'kartu kredit': 'kartu kredit',
    savings: 'tabungan', tabungan: 'tabungan', other: 'lainnya', lainnya: 'lainnya',
  }
  const alias = aliases[n] ?? n
  const exact = types.find((t: any) => norm(t.name) === alias || norm(t.legacy_type) === n)
  if (exact) return exact
  const partials = types.filter((t: any) => norm(t.name).includes(alias) || alias.includes(norm(t.name)))
  return partials.length === 1 ? partials[0] : null
}

async function findAccountTypeCandidates(admin: any, householdId: string, hint?: string | null) {
  const n = norm(hint)
  if (!n) return []
  const { data, error } = await admin
    .from('account_types')
    .select('id,name,legacy_type,icon,color,is_system,deleted_at')
    .eq('household_id', householdId)
    .is('deleted_at', null)
    .order('name')
  if (error) throw error
  const rows = data ?? []
  const exact = rows.filter((t: any) => norm(t.name) === n || norm(t.legacy_type) === n)
  if (exact.length) return exact
  return rows.filter((t: any) => norm(t.name).includes(n) || n.includes(norm(t.name))).slice(0, 20)
}

const keywordMap: Array<[RegExp, string[]]> = [
  [/jajan|snack|snacks|cemilan|camilan|makan|nasi|restoran|restaurant|bakmi|kopi|coffee|gofood|grabfood|delivery/i, ['snacks', 'food', 'restaurant', 'coffee', 'delivery']],
  [/belanja|supermarket|indomaret|alfamart|grocer/i, ['groceries', 'food']],
  [/bensin|bbm|fuel|pertamina|shell/i, ['fuel', 'transport']],
  [/parkir|parking/i, ['parking']],
  [/tol|toll/i, ['toll']],
  [/grab|gocar|taxi/i, ['taxi', 'transport']],
  [/listrik|pln/i, ['electricity', 'housing']],
  [/internet|wifi|indihome/i, ['internet', 'housing']],
  [/air|pdam/i, ['water', 'housing']],
  [/popok|diaper|diapers|pampers/i, ['diapers', 'child']],
  [/obat|dokter|hospital|clinic|kesehatan/i, ['healthcare']],
  [/gaji|salary/i, ['salary', 'income']],
  [/bonus/i, ['bonus', 'income']],
]

export async function matchCategory(admin: any, householdId: string, command: any) {
  const merchant = norm(command.merchant_hint ?? command.selector?.merchant)
  if (merchant) {
    const { data: rule } = await admin
      .from('merchant_category_rules')
      .select('category_id,category:categories(id,name,color)')
      .eq('household_id', householdId)
      .eq('merchant_normalized', merchant)
      .maybeSingle()
    if (rule?.category) return rule.category

    const { data: history } = await admin
      .from('transactions')
      .select('splits:transaction_splits(category_id,category:categories(id,name,color))')
      .eq('household_id', householdId)
      .ilike('merchant_name', `%${merchant.replace(/[%_,]/g, ' ')}%`)
      .is('deleted_at', null)
      .order('transaction_at', { ascending: false })
      .limit(5)
    const found = history
      ?.flatMap((t: any) => t.splits ?? [])
      .find((s: any) => s.category)?.category
    if (found) return found
  }

  const hint = norm(command.category_hint)
  const text = norm(
    [
      command.description,
      command.merchant_hint,
      command.selector?.description,
      command.selector?.merchant,
    ]
      .filter(Boolean)
      .join(' '),
  )

  if (!hint && !text) return null

  const { data, error } = await admin
    .from('categories')
    .select('id,name,color,parent_id')
    .eq('household_id', householdId)
    .eq('is_archived', false)
  if (error) throw error

  const categories = data ?? []
  if (hint) {
    const exact = categories.find((c: any) => norm(c.name) === hint)
    if (exact) return exact
    const partial = categories.find(
      (c: any) => norm(c.name).includes(hint) || hint.includes(norm(c.name)),
    )
    if (partial) return partial
  }

  for (const [re, names] of keywordMap) {
    if (re.test(text)) {
      for (const name of names) {
        const c = categories.find((x: any) => norm(x.name).includes(name))
        if (c) return c
      }
    }
  }

  return null
}

export async function findCandidates(admin: any, householdId: string, command: any) {
  const selector = command.selector ?? {}
  let query = admin
    .from('transactions')
    .select('id,transaction_type,transaction_at,merchant_name,description,total_amount,currency,source,deleted_at')
    .eq('household_id', householdId)
    .order('transaction_at', { ascending: false })
    .limit(20)

  if (command.intent === 'RESTORE_TRANSACTION') query = query.not('deleted_at', 'is', null)
  else query = query.is('deleted_at', null)

  const date = resolveDate(command, true)
  if (date) {
    query = query
      .gte('transaction_at', `${date}T00:00:00+07:00`)
      .lte('transaction_at', `${date}T23:59:59.999+07:00`)
  }
  if (selector.amount != null) query = query.eq('total_amount', selector.amount)

  const term = norm(selector.merchant || selector.description)
  if (term) {
    const safe = term.replace(/[%_,()]/g, ' ')
    query = query.or(`merchant_name.ilike.%${safe}%,description.ilike.%${safe}%`)
  }

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

async function accountImpact(admin: any, accountId: string) {
  const { data: movements, error } = await admin
    .from('account_movements')
    .select('transaction_id')
    .eq('account_id', accountId)
  if (error) throw error

  const transactionIds = [...new Set((movements ?? []).map((m: any) => m.transaction_id))]
  if (!transactionIds.length) {
    return { transaction_count: 0, active_transaction_count: 0, counterpart_account_count: 0 }
  }

  const { data: txs, error: txError } = await admin
    .from('transactions')
    .select('id,deleted_at')
    .in('id', transactionIds)
  if (txError) throw txError

  const { data: counterparts, error: cpError } = await admin
    .from('account_movements')
    .select('account_id')
    .in('transaction_id', transactionIds)
    .neq('account_id', accountId)
  if (cpError) throw cpError

  return {
    transaction_count: transactionIds.length,
    active_transaction_count: (txs ?? []).filter((t: any) => !t.deleted_at).length,
    counterpart_account_count: new Set((counterparts ?? []).map((m: any) => m.account_id)).size,
  }
}

async function householdResetImpact(admin: any, householdId: string) {
  const [tx, accounts, budgets, recurring] = await Promise.all([
    admin.from('transactions').select('id', { count: 'exact', head: true }).eq('household_id', householdId).is('deleted_at', null),
    admin.from('accounts').select('id', { count: 'exact', head: true }).eq('household_id', householdId),
    admin.from('budgets').select('id', { count: 'exact', head: true }).eq('household_id', householdId),
    admin.from('recurring_transactions').select('id', { count: 'exact', head: true }).eq('household_id', householdId),
  ])
  for (const result of [tx, accounts, budgets, recurring]) if (result.error) throw result.error
  return {
    active_transaction_count: tx.count ?? 0,
    account_count: accounts.count ?? 0,
    budget_count: budgets.count ?? 0,
    recurring_count: recurring.count ?? 0,
  }
}

export async function buildPreview(admin: any, householdId: string, command: any) {
  if (command.intent === 'CREATE_TRANSACTION') {
    const amount = command.amount == null ? null : Number(command.amount)
    const account = await matchAccount(admin, householdId, command.account_hint)
    const category = command.transaction_type === 'TRANSFER'
      ? null
      : await matchCategory(admin, householdId, command)
    const missing: string[] = []
    if (amount == null || !Number.isFinite(amount) || amount <= 0) missing.push('nominal')
    if (!account) missing.push('akun')
    if (command.transaction_type !== 'TRANSFER' && !category) missing.push('kategori')
    const date = resolveDate(command, false)
    const prepared = {
      total_amount: amount != null && Number.isFinite(amount) && amount > 0 ? amount : undefined,
      account_id: account?.id,
      account_name: account?.name,
      category_id: category?.id,
      category_name: category?.name,
      description: command.description,
      merchant_name: command.merchant_hint,
      transaction_at: `${date}T12:00:00+07:00`,
      transaction_type: command.transaction_type ?? 'EXPENSE',
      currency: command.currency ?? 'IDR',
    }
    return {
      intent: command.intent,
      risk_level: 'NORMAL',
      requires_confirmation: true,
      requires_typed_confirmation: false,
      message: missing.length
        ? `Perlu review manual: ${missing.join(', ')} belum jelas.`
        : 'Periksa transaksi berikut sebelum disimpan.',
      can_commit: missing.length === 0,
      blocking_issues: missing,
      prepared,
      candidates: [],
      candidate_kind: null,
    }
  }

  if (command.intent === 'TRANSFER_MONEY') {
    const amount = command.amount == null ? null : Number(command.amount)
    const source = await matchAccount(admin, householdId, command.source_account_hint)
    const destination = await matchAccount(admin, householdId, command.destination_account_hint)
    const missing: string[] = []
    if (amount == null || !Number.isFinite(amount) || amount <= 0) missing.push('nominal')
    if (!source) missing.push('akun sumber')
    if (!destination) missing.push('akun tujuan')
    if (source?.id && destination?.id && source.id === destination.id) missing.push('akun sumber/tujuan harus berbeda')
    const date = resolveDate(command, false)
    return {
      intent: command.intent,
      risk_level: 'NORMAL',
      requires_confirmation: true,
      requires_typed_confirmation: false,
      message: missing.length ? `Perlu review manual: ${missing.join(', ')}.` : 'Periksa transfer sebelum disimpan.',
      can_commit: missing.length === 0,
      blocking_issues: missing,
      prepared: {
        total_amount: amount != null && Number.isFinite(amount) && amount > 0 ? amount : undefined,
        source_account_id: source?.id,
        source_account_name: source?.name,
        destination_account_id: destination?.id,
        destination_account_name: destination?.name,
        description: command.description,
        transaction_at: `${date}T12:00:00+07:00`,
        currency: command.currency ?? source?.currency ?? 'IDR',
      },
      candidates: [],
      candidate_kind: null,
    }
  }

  if (['UPDATE_TRANSACTION', 'DELETE_TRANSACTION', 'RESTORE_TRANSACTION', 'FIND_TRANSACTION'].includes(command.intent)) {
    const candidates = await findCandidates(admin, householdId, command)
    const destructive = command.intent === 'DELETE_TRANSACTION'
    return {
      intent: command.intent,
      risk_level: destructive ? 'DESTRUCTIVE' : command.intent === 'FIND_TRANSACTION' ? 'READ_ONLY' : 'NORMAL',
      requires_confirmation: command.intent !== 'FIND_TRANSACTION',
      requires_typed_confirmation: false,
      message: candidates.length === 0
        ? 'Tidak menemukan transaksi yang cocok.'
        : candidates.length === 1
          ? 'Ditemukan satu transaksi yang cocok.'
          : `Ditemukan ${candidates.length} transaksi yang cocok. Pilih satu.`,
      can_commit: command.intent === 'FIND_TRANSACTION' ? false : candidates.length > 0,
      blocking_issues: candidates.length === 0 ? ['transaksi target'] : [],
      candidates: candidates.map((c: any) => ({ ...c, entity_type: 'transaction', label: c.merchant_name || c.description || 'Transaksi' })),
      candidate_kind: 'transaction',
    }
  }

  if (command.intent === 'CREATE_ACCOUNT') {
    const name = String(command.account_hint ?? '').trim()
    const rawOpening = command.account_changes?.opening_balance
    const opening = rawOpening == null ? 0 : Number(rawOpening)
    const type = await matchAccountType(admin, householdId, command.account_type)
    const missing: string[] = []
    if (!name) missing.push('nama akun')
    if (!type) missing.push('tipe akun yang valid')
    if (!Number.isFinite(opening) || opening < 0) missing.push('saldo awal')
    return {
      intent: command.intent,
      risk_level: 'NORMAL',
      requires_confirmation: true,
      requires_typed_confirmation: false,
      message: missing.length ? `Perlu review manual: ${missing.join(', ')} belum jelas.` : 'Periksa akun baru sebelum dibuat.',
      can_commit: missing.length === 0,
      blocking_issues: missing,
      prepared: {
        account_name: name || undefined,
        account_type_id: type?.id,
        account_type: type?.name,
        account_type_legacy: type?.legacy_type,
        opening_balance: Number.isFinite(opening) && opening >= 0 ? opening : undefined,
        opening_balance_defaulted: rawOpening == null,
        currency: command.currency ?? 'IDR',
      },
      candidates: [],
      candidate_kind: null,
    }
  }

  if (command.intent === 'CREATE_ACCOUNT_TYPE') {
    const name = String(command.account_type_name ?? '').trim()
    return {
      intent: command.intent,
      risk_level: 'NORMAL',
      requires_confirmation: true,
      requires_typed_confirmation: false,
      message: name ? `Tipe akun baru “${name}” akan ditambahkan.` : 'Nama tipe akun belum jelas.',
      can_commit: Boolean(name),
      blocking_issues: name ? [] : ['nama tipe akun'],
      prepared: { account_type_name: name || undefined },
      candidates: [],
      candidate_kind: null,
    }
  }

  if (['UPDATE_ACCOUNT_TYPE', 'DELETE_ACCOUNT_TYPE'].includes(command.intent)) {
    const hint = command.account_type_selector?.name
    const candidates = await findAccountTypeCandidates(admin, householdId, hint)
    const newName = String(command.account_type_changes?.name ?? '').trim()
    const blocking: string[] = []
    if (!candidates.length) blocking.push('tipe akun target')
    if (command.intent === 'UPDATE_ACCOUNT_TYPE' && !newName) blocking.push('nama tipe akun baru')
    const destructive = command.intent === 'DELETE_ACCOUNT_TYPE'
    let message = candidates.length === 0
      ? 'Tidak menemukan tipe akun yang cocok.'
      : candidates.length === 1
        ? destructive
          ? `Tipe akun “${candidates[0].name}” akan dihapus dari pilihan. Akun lama tetap mempertahankan riwayat tipe tersebut.`
          : `Tipe akun “${candidates[0].name}” akan diubah menjadi “${newName || 'nama yang belum jelas'}”.`
        : `Ditemukan ${candidates.length} tipe akun yang cocok. Pilih satu.`
    return {
      intent: command.intent,
      risk_level: destructive ? 'DESTRUCTIVE' : 'NORMAL',
      requires_confirmation: true,
      requires_typed_confirmation: false,
      message,
      can_commit: blocking.length === 0,
      blocking_issues: blocking,
      prepared: { new_account_type_name: newName || null },
      candidates: candidates.map((t: any) => ({ ...t, entity_type: 'account_type', label: t.name })),
      candidate_kind: 'account_type',
    }
  }

  if (['UPDATE_ACCOUNT', 'SET_ACCOUNT_OPENING_BALANCE', 'ARCHIVE_ACCOUNT', 'DELETE_ACCOUNT_CASCADE', 'RESET_ACCOUNT'].includes(command.intent)) {
    const candidates = await findAccountCandidates(admin, householdId, command)
    let prepared: any = {
      new_name: command.account_changes?.name ?? null,
      new_opening_balance: command.account_changes?.opening_balance ?? null,
    }
    let message = candidates.length === 0
      ? 'Tidak menemukan akun yang cocok.'
      : candidates.length === 1
        ? 'Ditemukan satu akun yang cocok.'
        : `Ditemukan ${candidates.length} akun yang cocok. Pilih satu.`
    const isCriticalAccountAction = ['DELETE_ACCOUNT_CASCADE', 'RESET_ACCOUNT'].includes(command.intent)
    let riskLevel = isCriticalAccountAction ? 'CRITICAL' : command.intent === 'ARCHIVE_ACCOUNT' ? 'DESTRUCTIVE' : 'NORMAL'
    let requiresTyped = isCriticalAccountAction
    let confirmationPhrase: string | null = null

    if (candidates.length === 1) {
      const account = candidates[0]
      prepared = { ...prepared, account }

      if (['DELETE_ACCOUNT_CASCADE', 'RESET_ACCOUNT'].includes(command.intent)) {
        const impact = await accountImpact(admin, account.id)
        prepared = { ...prepared, impact }
        confirmationPhrase = command.intent === 'DELETE_ACCOUNT_CASCADE'
          ? `HAPUS AKUN ${account.name}`
          : `RESET AKUN ${account.name}`

        if (command.intent === 'DELETE_ACCOUNT_CASCADE') {
          message = `PERMANEN: akun ${account.name} akan dihapus bersama ${impact.transaction_count} transaksi terkait. Transfer terkait dapat memengaruhi ${impact.counterpart_account_count} akun lain.`
        } else {
          message = `Akun ${account.name} akan dipertahankan, saldo awal diubah menjadi Rp0 dan ${impact.active_transaction_count} transaksi aktif terkait akan di-soft-delete.`
        }
      } else if (command.intent === 'ARCHIVE_ACCOUNT') {
        message = `Akun ${account.name} akan diarsipkan. Riwayat transaksi tetap dipertahankan.`
      } else if (command.intent === 'SET_ACCOUNT_OPENING_BALANCE') {
        message = `Saldo awal akun ${account.name} akan diubah menjadi ${command.account_changes?.opening_balance ?? 'nilai yang belum jelas'}.`
      } else if (command.intent === 'UPDATE_ACCOUNT') {
        message = `Periksa perubahan akun ${account.name} sebelum disimpan.`
      }
    }

    const blocking: string[] = []
    if (candidates.length === 0) blocking.push('akun target')
    if (command.intent === 'SET_ACCOUNT_OPENING_BALANCE') {
      const opening = command.account_changes?.opening_balance
      if (opening == null || !Number.isFinite(Number(opening)) || Number(opening) < 0) blocking.push('saldo awal baru')
    }
    if (command.intent === 'UPDATE_ACCOUNT' && command.account_changes?.name == null && command.account_changes?.opening_balance == null) {
      blocking.push('perubahan akun')
    }

    return {
      intent: command.intent,
      risk_level: riskLevel,
      requires_confirmation: true,
      requires_typed_confirmation: requiresTyped,
      confirmation_phrase: confirmationPhrase,
      message,
      can_commit: blocking.length === 0,
      blocking_issues: blocking,
      prepared,
      candidates: candidates.map((a: any) => ({
        ...a,
        entity_type: 'account',
        label: a.name,
      })),
      candidate_kind: 'account',
    }
  }

  if (command.intent === 'CREATE_CATEGORY') {
    const name = String(command.category_name ?? command.category_hint ?? '').trim()
    return {
      intent: command.intent,
      risk_level: 'NORMAL',
      requires_confirmation: true,
      requires_typed_confirmation: false,
      message: name ? 'Periksa kategori baru sebelum dibuat.' : 'Nama kategori belum jelas.',
      can_commit: Boolean(name),
      blocking_issues: name ? [] : ['nama kategori'],
      prepared: {
        category_name: name || undefined,
        parent_category_hint: command.parent_category_hint ?? null,
        category_transaction_type: command.category_transaction_type ?? 'EXPENSE',
      },
      candidates: [],
      candidate_kind: null,
    }
  }

  if (command.intent === 'RESET_HOUSEHOLD_FINANCES') {
    const impact = await householdResetImpact(admin, householdId)
    return {
      intent: command.intent,
      risk_level: 'CRITICAL',
      requires_confirmation: true,
      requires_typed_confirmation: true,
      confirmation_phrase: 'RESET SEMUA DATA KEUANGAN',
      message: `Reset besar: ${impact.active_transaction_count} transaksi aktif akan di-soft-delete, saldo awal ${impact.account_count} akun menjadi Rp0, dan budget/recurring akan dibersihkan. Akun, kategori, anggota, receipt, serta audit log tetap dipertahankan.`,
      can_commit: true,
      blocking_issues: [],
      prepared: { impact },
      candidates: [],
      candidate_kind: null,
    }
  }

  if (command.intent === 'GET_FINANCIAL_SUMMARY') {
    return {
      intent: command.intent,
      risk_level: 'READ_ONLY',
      requires_confirmation: false,
      requires_typed_confirmation: false,
      message: 'Permintaan ringkasan keuangan tidak mengubah data.',
      can_commit: false,
      blocking_issues: [],
      candidates: [],
      candidate_kind: null,
    }
  }

  return {
    intent: command.intent,
    risk_level: 'NORMAL',
    requires_confirmation: true,
    requires_typed_confirmation: false,
    message: 'Perintah ini belum didukung.',
    can_commit: false,
    blocking_issues: ['intent belum didukung'],
    candidates: [],
    candidate_kind: null,
  }
}
