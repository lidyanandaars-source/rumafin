import { requireSupabase } from './supabase'

export async function invokeEdge<T>(
  name: string,
  body?: Record<string, unknown>,
  options?: { headers?: Record<string, string> },
) {
  const client = requireSupabase()
  const { data, error } = await client.functions.invoke<T>(name, {
    body,
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
