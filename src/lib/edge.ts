import { requireSupabase } from './supabase'

type EdgeBody = Record<string, unknown> | FormData | Blob | ArrayBuffer | string | null

export async function invokeEdge<T>(
  name: string,
  body?: EdgeBody,
  options?: { headers?: Record<string, string> },
) {
  const client = requireSupabase()
  const { data, error } = await client.functions.invoke<T>(name, {
    // Supabase FunctionsHttpErrorOptions does not accept null for body.
    // Keep invokeEdge(null) backward-compatible by normalizing null to undefined.
    body: body ?? undefined,
    headers: options?.headers,
  })

  if (error) {
    let detail = error.message
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      try {
        const clone = context.clone()
        const payload = await clone.json() as { error?: string; message?: string }
        detail = payload.error || payload.message || detail
      } catch {
        try {
          const text = await context.clone().text()
          if (text) detail = text
        } catch {
          // Keep the SDK error message when the response body cannot be read.
        }
      }
    }
    throw new Error(detail)
  }

  return data as T
}
