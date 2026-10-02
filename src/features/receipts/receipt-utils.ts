export interface ReceiptReviewItem {
  name: string
  amount: number
  categoryId: string
}

export interface ReceiptTransactionGroup {
  categoryId: string
  amount: number
  itemNames: string[]
}

export function groupReceiptItemsByCategory(items: ReceiptReviewItem[]): ReceiptTransactionGroup[] {
  const groups = new Map<string, ReceiptTransactionGroup>()

  for (const item of items) {
    const categoryId = item.categoryId.trim()
    const amount = Number(item.amount)
    if (!categoryId || !Number.isFinite(amount) || amount <= 0) continue

    const current = groups.get(categoryId)
    if (current) {
      current.amount += amount
      current.itemNames.push(item.name)
    } else {
      groups.set(categoryId, {
        categoryId,
        amount,
        itemNames: [item.name],
      })
    }
  }

  return [...groups.values()]
}
