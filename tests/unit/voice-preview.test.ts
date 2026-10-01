import { describe, expect, it } from 'vitest'
import { buildPreview } from '../../supabase/functions/_shared/preview'

function accountTypeAdmin() {
  const rows = [{ id: 'type-bank', name: 'Bank', legacy_type: 'BANK', icon: null, color: null, is_system: true, deleted_at: null }]
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => Promise.resolve({ data: rows, error: null }),
  }
  return { from: (table: string) => table === 'account_types' ? chain : (() => { throw new Error(`Unexpected table ${table}`) })() }
}

describe('voice preview safety', () => {
  it('does not convert missing transaction fields into Rp0, Cash, or Others', async () => {
    const preview = await buildPreview({}, 'household-id', {
      intent: 'CREATE_TRANSACTION',
      transaction_type: 'EXPENSE',
      amount: null,
      currency: 'IDR',
      date_reference: 'TODAY',
      account_hint: null,
      category_hint: null,
      merchant_hint: null,
      description: null,
    })

    expect(preview.can_commit).toBe(false)
    expect(preview.blocking_issues).toEqual(['nominal', 'akun', 'kategori'])
    expect(preview.prepared?.total_amount).toBeUndefined()
    expect(preview.prepared?.account_name).toBeUndefined()
    expect(preview.prepared?.category_name).toBeUndefined()
  })

  it('builds a committable Bank Mandiri account preview with Rp10m opening balance', async () => {
    const preview = await buildPreview(accountTypeAdmin(), 'household-id', {
      intent: 'CREATE_ACCOUNT',
      account_hint: 'Bank Mandiri',
      account_type: 'BANK',
      currency: 'IDR',
      account_changes: { name: null, opening_balance: 10_000_000 },
      account_selector: null,
    })

    expect(preview.can_commit).toBe(true)
    expect(preview.prepared?.account_name).toBe('Bank Mandiri')
    expect(preview.prepared?.account_type).toBe('Bank')
    expect(preview.prepared?.account_type_id).toBe('type-bank')
    expect(preview.prepared?.opening_balance).toBe(10_000_000)
  })

  it('previews creation of a custom account type', async () => {
    const preview = await buildPreview({}, 'household-id', {
      intent: 'CREATE_ACCOUNT_TYPE',
      account_type_name: 'Crypto',
    })
    expect(preview.can_commit).toBe(true)
    expect(preview.prepared?.account_type_name).toBe('Crypto')
  })
})
