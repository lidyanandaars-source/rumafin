import { describe, expect, it } from 'vitest'
import {
  detectDeterministicIntent,
  extractCreateAccountName,
  extractOpeningBalanceFromTranscript,
  inferAccountTypeFromTranscript,
  extractExplicitAccountTypeHint,
  intentRequiresOwnerAdmin,
  normalizeFinancialCandidate,
  validateFinancialCandidate,
} from '../../supabase/functions/_shared/financial-command'

function baseCandidate(overrides: Record<string, unknown> = {}) {
  return {
    intent: 'CREATE_ACCOUNT',
    transaction_type: null,
    amount: null,
    currency: 'IDR',
    date: null,
    date_reference: null,
    account_hint: null,
    source_account_hint: null,
    destination_account_hint: null,
    category_hint: null,
    merchant_hint: null,
    description: null,
    selector: null,
    changes: null,
    account_selector: null,
    account_changes: { name: null, opening_balance: null },
    account_type: null,
    account_type_name: null,
    account_type_selector: null,
    account_type_changes: null,
    category_name: null,
    parent_category_hint: null,
    category_transaction_type: null,
    confidence: 0.95,
    ...overrides,
  }
}

describe('financial voice semantic guard', () => {
  const transcript = 'Buat akun baru bernama Bank Mandiri dengan saldo 10 juta rupiah.'

  it('detects explicit account creation deterministically', () => {
    expect(detectDeterministicIntent(transcript)).toBe('CREATE_ACCOUNT')
  })

  it('extracts the account name, type, and opening balance from the reported failure case', () => {
    expect(extractCreateAccountName(transcript)).toBe('Bank Mandiri')
    expect(inferAccountTypeFromTranscript(transcript)).toBe('BANK')
    expect(extractOpeningBalanceFromTranscript(transcript)).toBe(10_000_000)
  })

  it('repairs safe CREATE_ACCOUNT fields when the model omits them', () => {
    const normalized = normalizeFinancialCandidate(baseCandidate(), transcript)
    expect(normalized.intent).toBe('CREATE_ACCOUNT')
    expect(normalized.account_hint).toBe('Bank Mandiri')
    expect(normalized.account_type).toBe('BANK')
    expect(normalized.account_changes.opening_balance).toBe(10_000_000)
    expect(normalized.account_selector).toBeNull()
    expect(() => validateFinancialCandidate(normalized, transcript)).not.toThrow()
  })

  it('overrides hallucinated CREATE_ACCOUNT fields when the transcript is explicit', () => {
    const normalized = normalizeFinancialCandidate(baseCandidate({
      account_hint: 'Cash',
      account_type: 'OTHER',
      account_changes: { name: null, opening_balance: 1_000_000 },
    }), transcript)
    expect(normalized.account_hint).toBe('Bank Mandiri')
    expect(normalized.account_type).toBe('BANK')
    expect(normalized.account_changes.opening_balance).toBe(10_000_000)
  })

  it('rejects the original wrong CREATE_TRANSACTION classification', () => {
    const wrong = baseCandidate({
      intent: 'CREATE_TRANSACTION',
      transaction_type: 'EXPENSE',
      amount: 10_000_000,
      account_hint: 'Cash',
    })
    expect(() => validateFinancialCandidate(wrong, transcript)).toThrow(/expected CREATE_ACCOUNT/i)
  })

  it.each([
    ['Bikin akun GoPay ewallet saldo awal 100 ribu', 'CREATE_ACCOUNT'],
    ['Tambah rekening BCA saldo 5 juta', 'CREATE_ACCOUNT'],
    ['Ubah saldo awal akun BCA jadi 5 juta', 'SET_ACCOUNT_OPENING_BALANCE'],
    ['Ganti nama akun BCA jadi BCA Utama', 'UPDATE_ACCOUNT'],
    ['Pindahkan 500 ribu dari BCA ke Cash', 'TRANSFER_MONEY'],
    ['Hapus transaksi Grab 42 ribu kemarin', 'DELETE_TRANSACTION'],
    ['Buat kategori Pets untuk pengeluaran', 'CREATE_CATEGORY'],
    ['Buat tipe akun Crypto', 'CREATE_ACCOUNT_TYPE'],
    ['Ubah tipe akun Crypto jadi Aset Digital', 'UPDATE_ACCOUNT_TYPE'],
    ['Hapus tipe akun Aset Digital', 'DELETE_ACCOUNT_TYPE'],
  ])('routes %s to %s', (text, expected) => {
    expect(detectDeterministicIntent(text)).toBe(expected)
  })


  it('extracts an explicit custom account type for a new account', () => {
    const text = 'Buat akun Binance tipe Crypto saldo 5 juta'
    expect(extractExplicitAccountTypeHint(text)).toBe('Crypto')
    const normalized = normalizeFinancialCandidate(baseCandidate(), text)
    expect(normalized.account_hint).toBe('Binance')
    expect(normalized.account_type).toBe('Crypto')
    expect(normalized.account_changes.opening_balance).toBe(5_000_000)
  })


  it('extracts an explicit zero opening balance', () => {
    expect(extractOpeningBalanceFromTranscript('Tambahkan akun emas saldo nol')).toBe(0)
  })

  it('allows incomplete CREATE commands to continue to manual review', () => {
    const incompleteAccount = baseCandidate({ intent: 'CREATE_ACCOUNT', account_hint: 'Emas', account_type: null })
    expect(() => validateFinancialCandidate(incompleteAccount, 'Tambahkan akun emas saldo nol')).not.toThrow()

    const incompleteType = baseCandidate({ intent: 'CREATE_ACCOUNT_TYPE', account_type_name: null })
    expect(() => validateFinancialCandidate(incompleteType, 'Buat tipe akun')).not.toThrow()

    const incompleteCategory = baseCandidate({ intent: 'CREATE_CATEGORY', category_name: null })
    expect(() => validateFinancialCandidate(incompleteCategory, 'Buat kategori')).not.toThrow()
  })

  it('marks account type administration as owner/admin only', () => {
    expect(intentRequiresOwnerAdmin('CREATE_ACCOUNT_TYPE')).toBe(true)
    expect(intentRequiresOwnerAdmin('UPDATE_ACCOUNT_TYPE')).toBe(true)
    expect(intentRequiresOwnerAdmin('DELETE_ACCOUNT_TYPE')).toBe(true)
    expect(intentRequiresOwnerAdmin('CREATE_TRANSACTION')).toBe(false)
  })

  it('normalizes custom account type administration fields', () => {
    const create = normalizeFinancialCandidate(baseCandidate({ intent: 'CREATE_ACCOUNT_TYPE' }), 'Buat tipe akun Crypto')
    expect(create.account_type_name).toBe('Crypto')
    expect(() => validateFinancialCandidate(create, 'Buat tipe akun Crypto')).not.toThrow()

    const rename = normalizeFinancialCandidate(baseCandidate({ intent: 'UPDATE_ACCOUNT_TYPE' }), 'Ubah tipe akun Crypto jadi Aset Digital')
    expect(rename.account_type_selector.name).toBe('Crypto')
    expect(rename.account_type_changes.name).toBe('Aset Digital')

    const remove = normalizeFinancialCandidate(baseCandidate({ intent: 'DELETE_ACCOUNT_TYPE' }), 'Hapus tipe akun Aset Digital')
    expect(remove.account_type_selector.name).toBe('Aset Digital')
  })
})
