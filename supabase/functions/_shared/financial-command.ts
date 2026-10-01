export const SUPPORTED_FINANCIAL_INTENTS = [
  'CREATE_TRANSACTION',
  'UPDATE_TRANSACTION',
  'DELETE_TRANSACTION',
  'RESTORE_TRANSACTION',
  'FIND_TRANSACTION',
  'TRANSFER_MONEY',
  'CREATE_ACCOUNT',
  'UPDATE_ACCOUNT',
  'SET_ACCOUNT_OPENING_BALANCE',
  'ARCHIVE_ACCOUNT',
  'DELETE_ACCOUNT_CASCADE',
  'RESET_ACCOUNT',
  'CREATE_CATEGORY',
  'RESET_HOUSEHOLD_FINANCES',
  'GET_FINANCIAL_SUMMARY',
] as const

export type FinancialIntent = typeof SUPPORTED_FINANCIAL_INTENTS[number]

const supportedIntentSet = new Set<string>(SUPPORTED_FINANCIAL_INTENTS)

export function normalizeIndonesianText(value: unknown) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9,.'\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function detectDeterministicIntent(transcript: string): FinancialIntent | null {
  const text = normalizeIndonesianText(transcript)

  // Put the most specific / destructive intents first.
  if (/\b(reset|atur ulang)\s+(semua|seluruh)\s+(data\s+)?keuangan\b/.test(text) || /\breset\s+keuangan\s+(rumah tangga\s+)?(dari|ke)\s+nol\b/.test(text)) {
    return 'RESET_HOUSEHOLD_FINANCES'
  }
  if (/\b(hapus|delete)\s+(akun|rekening)\b.*\b(beserta|dengan|dan)\b.*\b(transaksi|riwayat)\b/.test(text)) {
    return 'DELETE_ACCOUNT_CASCADE'
  }
  if (/\b(reset|atur ulang)\s+(akun|rekening)\b/.test(text)) return 'RESET_ACCOUNT'
  if (/\b(arsipkan|arsip|archive)\s+(akun|rekening)\b/.test(text)) return 'ARCHIVE_ACCOUNT'
  if (/\b(ubah|ganti|set|atur)\s+saldo\s+awal\b/.test(text) || /\bsaldo\s+awal\s+(akun|rekening)\b.*\b(jadi|menjadi|ke)\b/.test(text)) {
    return 'SET_ACCOUNT_OPENING_BALANCE'
  }
  if (/\b(ubah|ganti|edit)\s+nama\s+(akun|rekening)\b/.test(text)) return 'UPDATE_ACCOUNT'
  if (/\b(buat|bikin|tambah|tambahkan|create)\s+(akun|rekening)\b/.test(text) || /\b(akun|rekening)\s+baru\b/.test(text)) {
    return 'CREATE_ACCOUNT'
  }
  if (/\b(buat|bikin|tambah|tambahkan|create)\s+kategori\b/.test(text)) return 'CREATE_CATEGORY'
  if (/\b(pindahkan|pindah|transfer)\b.*\b(dari)\b.*\b(ke)\b/.test(text)) return 'TRANSFER_MONEY'
  if (/\b(pulihkan|restore|kembalikan)\s+(transaksi|transaction)\b/.test(text)) return 'RESTORE_TRANSACTION'
  if (/\b(hapus|delete)\s+(transaksi|transaction)\b/.test(text)) return 'DELETE_TRANSACTION'
  if (/\b(ubah|edit|ganti)\s+(transaksi|transaction)\b/.test(text)) return 'UPDATE_TRANSACTION'
  if (/\b(cari|temukan|find|tampilkan)\s+(transaksi|transaction)\b/.test(text)) return 'FIND_TRANSACTION'
  if (/\b(berapa|total|ringkasan|summary)\b.*\b(pengeluaran|pemasukan|income|expense|cash flow|arus kas)\b/.test(text)) {
    return 'GET_FINANCIAL_SUMMARY'
  }
  if (/\b(catat|masukkan|masukin|tambahkan)\s+(transaksi|pengeluaran|pemasukan)\b/.test(text)) return 'CREATE_TRANSACTION'

  return null
}

export function inferAccountTypeFromTranscript(transcript: string): string | null {
  const text = normalizeIndonesianText(transcript)
  if (/\b(kartu kredit|credit card)\b/.test(text)) return 'CREDIT_CARD'
  if (/\b(e\s*wallet|ewallet|dompet digital|gopay|go pay|ovo|dana|shopeepay|shopee pay|linkaja|link aja)\b/.test(text)) return 'EWALLET'
  if (/\b(tabungan|savings?)\b/.test(text)) return 'SAVINGS'
  if (/\b(cash|tunai)\b/.test(text)) return 'CASH'
  if (/\b(bank|rekening|bca|mandiri|bni|bri|cimb|permata|jenius|seabank|blu)\b/.test(text)) return 'BANK'
  return null
}

function parseNumericAmount(rawValue: string, rawUnit?: string | null): number | null {
  let raw = rawValue.trim().toLowerCase()
  if (!raw) return null

  const unit = (rawUnit ?? '').trim().toLowerCase()
  let base: number

  if (unit) {
    // With a unit, comma is a decimal separator. A single dot followed by 1-2
    // digits is also accepted as a decimal separator; otherwise dots are
    // treated as thousands separators.
    raw = raw.replace(/,/g, '.')
    const dotCount = (raw.match(/\./g) ?? []).length
    if (dotCount === 1 && /^\d+\.\d{1,2}$/.test(raw)) {
      base = Number(raw)
    } else {
      base = Number(raw.replace(/\./g, ''))
    }
  } else {
    // Without a unit, Indonesian punctuation is normally a thousands separator.
    base = Number(raw.replace(/[.,]/g, ''))
  }

  if (!Number.isFinite(base)) return null
  if (['ribu', 'rb', 'k'].includes(unit)) return Math.round(base * 1_000)
  if (['juta', 'jt'].includes(unit)) return Math.round(base * 1_000_000)
  if (['miliar', 'milyar', 'm'].includes(unit)) return Math.round(base * 1_000_000_000)
  return Math.round(base)
}

export function extractOpeningBalanceFromTranscript(transcript: string): number | null {
  const text = normalizeIndonesianText(transcript)
  const match = text.match(
    /\bsaldo(?:\s+awal)?(?:\s+(?:sebesar|senilai|jadi|menjadi|adalah))?\s+(?:rp\.?\s*)?([0-9][0-9.,]*)\s*(ribu|rb|k|juta|jt|miliar|milyar|m)?\b/,
  )
  if (!match) return null
  return parseNumericAmount(match[1] ?? '', match[2] ?? '')
}

export function transcriptMentionsOpeningBalance(transcript: string) {
  return /\bsaldo(?:\s+awal)?\b/i.test(normalizeIndonesianText(transcript))
}

export function extractCreateAccountName(transcript: string): string | null {
  const source = String(transcript ?? '').trim()
  if (!source) return null

  const named = source.match(/\bbernama\s+(.+?)(?=\s+(?:dengan\s+)?saldo\b|\s+saldo\s+awal\b|\s+tipe\b|\s+jenis\b|[.,;!?]|$)/i)
  if (named?.[1]?.trim()) return named[1].trim()

  const afterAccount = source.match(/\b(?:buat|bikin|tambah|tambahkan|create)\s+(?:akun|rekening)\s+(?:baru\s+)?(.+?)(?=\s+(?:dengan\s+)?saldo\b|\s+saldo\s+awal\b|\s+(?:e-?wallet|ewallet|bank|cash|tunai|tabungan|savings|kartu kredit|credit card)\b|[.,;!?]|$)/i)
  if (afterAccount?.[1]?.trim()) {
    const candidate = afterAccount[1].trim().replace(/^bernama\s+/i, '').trim()
    return candidate || null
  }

  return null
}

export function normalizeFinancialCandidate(candidate: any, transcript: string) {
  if (!candidate || typeof candidate !== 'object') return candidate
  const normalized = { ...candidate }

  if (normalized.intent === 'CREATE_ACCOUNT') {
    const selector = normalized.account_selector && typeof normalized.account_selector === 'object'
      ? normalized.account_selector
      : null
    const changes = normalized.account_changes && typeof normalized.account_changes === 'object'
      ? { ...normalized.account_changes }
      : { name: null, opening_balance: null }

    const explicitName = extractCreateAccountName(transcript)
    const explicitType = inferAccountTypeFromTranscript(transcript)
    const explicitOpeningBalance = extractOpeningBalanceFromTranscript(transcript)

    // When the transcript states these fields explicitly, prefer deterministic
    // extraction over model output. This prevents a semantically correct intent
    // from carrying a hallucinated account name/type/balance into preview.
    normalized.account_hint = String(
      explicitName ?? normalized.account_hint ?? selector?.name ?? '',
    ).trim() || null
    normalized.account_type = explicitType ?? normalized.account_type ?? selector?.account_type ?? null

    if (explicitOpeningBalance != null) {
      changes.opening_balance = explicitOpeningBalance
    }

    if (!('name' in changes)) changes.name = null
    normalized.account_changes = changes
    normalized.account_selector = null
  }

  return normalized
}

export function validateFinancialCandidate(candidate: any, transcript: string) {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('AI returned an invalid financial command object')
  }
  if (typeof candidate.intent !== 'string' || !supportedIntentSet.has(candidate.intent)) {
    throw new Error(`AI returned an unsupported intent: ${String(candidate.intent ?? '')}`)
  }
  if (typeof candidate.confidence !== 'number' || !Number.isFinite(candidate.confidence)) {
    throw new Error('AI returned invalid confidence')
  }
  if (candidate.confidence < 0 || candidate.confidence > 1) {
    throw new Error('AI confidence must be between 0 and 1')
  }

  const expectedIntent = detectDeterministicIntent(transcript)
  if (expectedIntent && candidate.intent !== expectedIntent) {
    throw new Error(`Semantic intent mismatch: expected ${expectedIntent}, received ${candidate.intent}`)
  }

  switch (candidate.intent as FinancialIntent) {
    case 'CREATE_ACCOUNT': {
      const name = String(candidate.account_hint ?? '').trim()
      if (!name) throw new Error('CREATE_ACCOUNT requires an account name')
      const opening = candidate.account_changes?.opening_balance
      if (opening != null && (typeof opening !== 'number' || !Number.isFinite(opening) || opening < 0)) {
        throw new Error('CREATE_ACCOUNT opening balance is invalid')
      }
      if (transcriptMentionsOpeningBalance(transcript) && opening == null) {
        throw new Error('CREATE_ACCOUNT transcript contains a balance but the AI did not extract it')
      }
      break
    }
    case 'UPDATE_ACCOUNT': {
      if (!String(candidate.account_selector?.name ?? '').trim()) throw new Error('UPDATE_ACCOUNT requires account_selector.name')
      if (candidate.account_changes?.name == null && candidate.account_changes?.opening_balance == null) {
        throw new Error('UPDATE_ACCOUNT requires at least one account change')
      }
      break
    }
    case 'SET_ACCOUNT_OPENING_BALANCE': {
      if (!String(candidate.account_selector?.name ?? '').trim()) throw new Error('SET_ACCOUNT_OPENING_BALANCE requires account_selector.name')
      const value = candidate.account_changes?.opening_balance
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error('SET_ACCOUNT_OPENING_BALANCE requires a valid opening balance')
      }
      break
    }
    case 'ARCHIVE_ACCOUNT':
    case 'DELETE_ACCOUNT_CASCADE':
    case 'RESET_ACCOUNT':
      if (!String(candidate.account_selector?.name ?? '').trim()) throw new Error(`${candidate.intent} requires account_selector.name`)
      break
    case 'TRANSFER_MONEY': {
      if (typeof candidate.amount !== 'number' || !Number.isFinite(candidate.amount) || candidate.amount <= 0) {
        throw new Error('TRANSFER_MONEY requires a positive amount')
      }
      if (!String(candidate.source_account_hint ?? '').trim() || !String(candidate.destination_account_hint ?? '').trim()) {
        throw new Error('TRANSFER_MONEY requires source and destination accounts')
      }
      break
    }
    case 'CREATE_CATEGORY':
      if (!String(candidate.category_name ?? '').trim()) throw new Error('CREATE_CATEGORY requires category_name')
      break
    case 'CREATE_TRANSACTION':
      if (candidate.amount != null && (typeof candidate.amount !== 'number' || !Number.isFinite(candidate.amount) || candidate.amount <= 0)) {
        throw new Error('CREATE_TRANSACTION amount must be positive when supplied')
      }
      break
    default:
      break
  }

  return candidate
}
