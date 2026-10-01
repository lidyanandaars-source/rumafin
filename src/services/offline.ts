import type { TransactionWriteInput } from './transactions'
import { createTransaction } from './transactions'

const KEY = 'rumafin-offline-drafts-v1'

export interface OfflineDraft extends TransactionWriteInput {
  local_id: string
  queued_at: string
}

export function getOfflineDrafts(): OfflineDraft[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as OfflineDraft[] } catch { return [] }
}

export function queueOfflineDraft(input: TransactionWriteInput) {
  const drafts = getOfflineDrafts()
  drafts.push({ ...input, local_id: crypto.randomUUID(), queued_at: new Date().toISOString(), idempotency_key: input.idempotency_key ?? crypto.randomUUID() })
  localStorage.setItem(KEY, JSON.stringify(drafts))
}

export async function syncOfflineDrafts() {
  if (!navigator.onLine) return { synced: 0, failed: getOfflineDrafts().length }
  const drafts = getOfflineDrafts()
  const remaining: OfflineDraft[] = []
  let synced = 0
  for (const draft of drafts) {
    try {
      const { local_id: _localId, queued_at: _queuedAt, ...payload } = draft
      await createTransaction(payload)
      synced += 1
    } catch {
      remaining.push(draft)
    }
  }
  localStorage.setItem(KEY, JSON.stringify(remaining))
  return { synced, failed: remaining.length }
}
