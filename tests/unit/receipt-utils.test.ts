import { describe, expect, it } from 'vitest'
import { groupReceiptItemsByCategory } from '@/features/receipts/receipt-utils'

describe('receipt multi-transaction grouping', () => {
  it('creates separate transaction groups for different categories', () => {
    const groups = groupReceiptItemsByCategory([
      { name: 'Jajan', amount: 50_000, categoryId: 'food' },
      { name: 'Pampers bayi', amount: 50_000, categoryId: 'child' },
    ])

    expect(groups).toHaveLength(2)
    expect(groups).toEqual([
      { categoryId: 'food', amount: 50_000, itemNames: ['Jajan'] },
      { categoryId: 'child', amount: 50_000, itemNames: ['Pampers bayi'] },
    ])
  })

  it('combines line items that share the same category into one transaction', () => {
    const groups = groupReceiptItemsByCategory([
      { name: 'Roti', amount: 20_000, categoryId: 'food' },
      { name: 'Susu', amount: 30_000, categoryId: 'food' },
      { name: 'Popok', amount: 50_000, categoryId: 'child' },
    ])

    expect(groups).toEqual([
      { categoryId: 'food', amount: 50_000, itemNames: ['Roti', 'Susu'] },
      { categoryId: 'child', amount: 50_000, itemNames: ['Popok'] },
    ])
  })
})
