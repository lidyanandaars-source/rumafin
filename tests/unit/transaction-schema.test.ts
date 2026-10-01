import { describe, expect, it } from 'vitest'
import { transactionFormSchema } from '@/schemas/transaction'

const id1 = '00000000-0000-4000-8000-000000000001'
const id2 = '00000000-0000-4000-8000-000000000002'

describe('transactionFormSchema', () => {
  it('accepts an expense with account and category', () => {
    const result = transactionFormSchema.safeParse({ transaction_type:'EXPENSE', total_amount:85000, currency:'IDR', transaction_date:'2026-10-01', transaction_time:'12:00', account_id:id1, destination_account_id:null, category_id:id2, merchant_name:null, description:'makan siang', notes:null })
    expect(result.success).toBe(true)
  })
  it('rejects transfer to the same account', () => {
    const result = transactionFormSchema.safeParse({ transaction_type:'TRANSFER', total_amount:500000, currency:'IDR', transaction_date:'2026-10-01', transaction_time:'12:00', account_id:id1, destination_account_id:id1, category_id:null, merchant_name:null, description:null, notes:null })
    expect(result.success).toBe(false)
  })
  it('rejects zero amount', () => {
    const result = transactionFormSchema.safeParse({ transaction_type:'EXPENSE', total_amount:0, currency:'IDR', transaction_date:'2026-10-01', transaction_time:'12:00', account_id:id1, destination_account_id:null, category_id:id2, merchant_name:null, description:null, notes:null })
    expect(result.success).toBe(false)
  })
})
