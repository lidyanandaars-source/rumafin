import { describe, expect, it } from 'vitest'
import { buildPreview } from '../../supabase/functions/_shared/preview'

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
    const preview = await buildPreview({}, 'household-id', {
      intent: 'CREATE_ACCOUNT',
      account_hint: 'Bank Mandiri',
      account_type: 'BANK',
      currency: 'IDR',
      account_changes: { name: null, opening_balance: 10_000_000 },
      account_selector: null,
    })

    expect(preview.can_commit).toBe(true)
    expect(preview.prepared?.account_name).toBe('Bank Mandiri')
    expect(preview.prepared?.account_type).toBe('BANK')
    expect(preview.prepared?.opening_balance).toBe(10_000_000)
  })
})
