import { corsHeaders, handleError, json } from '../_shared/http.ts'
import { rateLimit, requireHouseholdAccess, requireUser } from '../_shared/supabase.ts'
import { receiptSchema } from '../_shared/schemas.ts'
import { geminiJson } from '../_shared/ai.ts'
import { matchCategory } from '../_shared/preview.ts'

function toBase64(bytes: Uint8Array) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)))
  }
  return btoa(binary)
}

function safeConfidence(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function assertReceiptShape(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AI returned an invalid receipt object')
  }
  for (const key of ['merchant', 'transaction_date', 'total', 'subtotal', 'tax', 'discount', 'payment_method', 'category_hint']) {
    const field = value[key]
    if (!field || typeof field !== 'object' || Array.isArray(field) || !('value' in field)) {
      throw new Error(`AI receipt output is missing field: ${key}`)
    }
  }
  if (!Array.isArray(value.items)) throw new Error('AI receipt output has invalid items array')
  return value
}

function manualField() {
  return { value: null, confidence: 0, needs_review: true }
}

async function qwenVisionJson<T>(args: {
  model: string
  system: string
  prompt: string
  schema: unknown
  media: { data: string; mimeType: string }
}) {
  const key = Deno.env.get('GROQ_API_KEY')
  if (!key) throw new Error('GROQ_API_KEY is not configured')

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(args.media.mimeType)) {
    throw new Error(`Qwen Vision does not support this receipt MIME type: ${args.media.mimeType}`)
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: args.model,
      messages: [
        { role: 'system', content: args.system },
        {
          role: 'user',
          content: [
            { type: 'text', text: args.prompt },
            {
              type: 'image_url',
              image_url: { url: `data:${args.media.mimeType};base64,${args.media.data}` },
            },
          ],
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'receipt_extraction',
          strict: true,
          schema: args.schema,
        },
      },
      stream: false,
      max_completion_tokens: 8192,
    }),
  })

  if (!response.ok) {
    throw new Error(`Groq Qwen Vision API ${response.status}: ${(await response.text()).slice(0, 500)}`)
  }

  const raw = await response.json()
  const text = raw?.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string') throw new Error('Groq Qwen Vision returned no usable output')

  return {
    parsed: JSON.parse(text) as T,
    raw,
    model: raw?.model ?? args.model,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { admin, authUser } = await requireUser(req)
    await rateLimit(admin, authUser.id, 'receipt-extract', 15)

    const body = await req.json()
    const householdId = String(body.household_id ?? '')
    const storagePath = String(body.storage_path ?? '')
    const mimeType = String(body.mime_type ?? '').split(';')[0].trim().toLowerCase()

    if (!householdId || !storagePath) throw new Error('household_id and storage_path are required')
    await requireHouseholdAccess(admin, authUser.id, householdId, true)

    if (!storagePath.startsWith(`${householdId}/${authUser.id}/`)) {
      throw new Error('Receipt path does not belong to the current user')
    }

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    if (!allowed.includes(mimeType)) throw new Error('Unsupported receipt MIME type')

    const { data: file, error: downloadError } = await admin.storage.from('receipts').download(storagePath)
    if (downloadError || !file) throw new Error('Receipt file could not be read')
    if (file.size > 10 * 1024 * 1024) throw new Error('Receipt exceeds 10 MB limit')

    const { data: categories } = await admin
      .from('categories')
      .select('name')
      .eq('household_id', householdId)
      .eq('is_archived', false)

    const categoryNames = (categories ?? []).map((category: any) => category.name).join(', ')
    const system = `Extract a household purchase receipt into JSON. Never invent unreadable or missing values. If a value is unclear, return null with low confidence and needs_review=true. Dates must use YYYY-MM-DD. Monetary values are plain numbers without currency symbols. Never confuse cash paid, change, or subtotal with the final transaction total. For category_hint, choose one of the supplied household category names only when supported by the merchant/items; otherwise return null. Household categories: ${categoryNames || 'none'}.`
    const prompt = 'Extract this receipt. Preserve uncertainty. Extract merchant, date, total, subtotal, tax, discount, payment method, category hint, and readable line items. Check subtotal + tax - discount against total when readable.'

    const geminiPrimary = Deno.env.get('GEMINI_RECEIPT_MODEL') ?? 'gemini-3.8-flash'
    const qwenFallback = Deno.env.get('GROQ_RECEIPT_FALLBACK_MODEL') ?? 'qwen/qwen3.8-27b'
    const geminiSecondary = Deno.env.get('GEMINI_RECEIPT_FALLBACK_MODEL') ?? 'gemini-3.5-flash'
    const geminiLite = Deno.env.get('GEMINI_RECEIPT_FALLBACK_LITE_MODEL') ?? 'gemini-3.5-flash-lite'

    const bytes = new Uint8Array(await file.arrayBuffer())
    const media = { data: toBase64(bytes), mimeType }
    const isImage = mimeType.startsWith('image/')

    let result: { parsed: any; raw: any; model: string } | null = null
    let provider: 'gemini' | 'groq' | 'none' = 'none'
    const failures: string[] = []

    try {
      console.log(`Receipt AI: trying Gemini primary (${geminiPrimary})`)
      const candidate = await geminiJson<any>({ model: geminiPrimary, system, prompt, schema: receiptSchema, media })
      assertReceiptShape(candidate.parsed)
      result = candidate
      provider = 'gemini'
      console.log(`Receipt AI: Gemini primary succeeded (${candidate.model})`)
    } catch (error) {
      const message = errorMessage(error)
      failures.push(`Gemini primary: ${message}`)
      console.warn(`Receipt AI: Gemini primary failed (${geminiPrimary})`, message)
    }

    if (!result && isImage) {
      try {
        console.log(`Receipt AI: trying Qwen Vision fallback (${qwenFallback})`)
        const candidate = await qwenVisionJson<any>({ model: qwenFallback, system, prompt, schema: receiptSchema, media })
        assertReceiptShape(candidate.parsed)
        result = candidate
        provider = 'groq'
        console.log(`Receipt AI: Qwen Vision succeeded (${candidate.model})`)
      } catch (error) {
        const message = errorMessage(error)
        failures.push(`Qwen Vision: ${message}`)
        console.warn(`Receipt AI: Qwen Vision failed (${qwenFallback})`, message)
      }
    } else if (!result && mimeType === 'application/pdf') {
      console.log('Receipt AI: Qwen Vision skipped for PDF input')
    }

    if (!result) {
      try {
        console.log(`Receipt AI: trying Gemini secondary (${geminiSecondary})`)
        const candidate = await geminiJson<any>({ model: geminiSecondary, system, prompt, schema: receiptSchema, media })
        assertReceiptShape(candidate.parsed)
        result = candidate
        provider = 'gemini'
        console.log(`Receipt AI: Gemini secondary succeeded (${candidate.model})`)
      } catch (error) {
        const message = errorMessage(error)
        failures.push(`Gemini secondary: ${message}`)
        console.warn(`Receipt AI: Gemini secondary failed (${geminiSecondary})`, message)
      }
    }

    if (!result) {
      try {
        console.log(`Receipt AI: trying Gemini Flash-Lite (${geminiLite})`)
        const candidate = await geminiJson<any>({ model: geminiLite, system, prompt, schema: receiptSchema, media })
        assertReceiptShape(candidate.parsed)
        result = candidate
        provider = 'gemini'
        console.log(`Receipt AI: Gemini Flash-Lite succeeded (${candidate.model})`)
      } catch (error) {
        const message = errorMessage(error)
        failures.push(`Gemini Flash-Lite: ${message}`)
        console.warn(`Receipt AI: Gemini Flash-Lite failed (${geminiLite})`, message)
      }
    }

    // If every model fails, create a FAILED receipt record and return a manual-review
    // payload instead of losing the uploaded receipt or blocking manual entry.
    if (!result) {
      console.error('Receipt AI: all configured models failed', failures)

      const { data: cashAccount } = await admin
        .from('accounts')
        .select('id,name')
        .eq('household_id', householdId)
        .eq('is_active', true)
        .eq('account_type', 'CASH')
        .limit(1)
        .maybeSingle()

      const { data: receipt, error: receiptError } = await admin
        .from('receipts')
        .insert({
          household_id: householdId,
          uploaded_by: authUser.id,
          storage_path: storagePath,
          mime_type: mimeType,
          extraction_status: 'FAILED',
          overall_confidence: 0,
        })
        .select('id')
        .single()

      if (receiptError) throw receiptError

      const manualOutput = {
        merchant: manualField(),
        transaction_date: manualField(),
        total: manualField(),
        subtotal: manualField(),
        tax: manualField(),
        discount: manualField(),
        payment_method: manualField(),
        category_hint: manualField(),
        items: [],
      }

      const { error: aiError } = await admin.from('ai_extractions').insert({
        household_id: householdId,
        user_id: authUser.id,
        source_type: 'RECEIPT',
        provider: 'none',
        model: 'all-receipt-models-failed',
        prompt_version: 'receipt-extractor-v2',
        schema_version: 'v1',
        raw_input_reference: storagePath,
        raw_output: { failures },
        normalized_output: manualOutput,
        confidence: 0,
        needs_review: true,
      })
      if (aiError) throw aiError

      return json({
        ...manualOutput,
        overall_confidence: 0,
        needs_review: true,
        manual_entry_required: true,
        arithmetic_issue: false,
        duplicate_candidates: [],
        receipt_id: receipt.id,
        storage_path: storagePath,
        suggested_account_id: cashAccount?.id ?? null,
        suggested_category_id: null,
        ai: { provider: 'none', model: null, failures },
      })
    }

    const x = assertReceiptShape(result.parsed)
    for (const key of ['merchant', 'transaction_date', 'total', 'subtotal', 'tax', 'discount', 'payment_method', 'category_hint']) {
      x[key].confidence = safeConfidence(x[key].confidence)
      if (x[key].confidence < 0.7) x[key].needs_review = true
    }

    let arithmeticIssue = false
    if (x.subtotal.value != null && x.total.value != null) {
      const expected = Number(x.subtotal.value) + Number(x.tax.value ?? 0) - Number(x.discount.value ?? 0)
      if (Math.abs(expected - Number(x.total.value)) > Math.max(1, Number(x.total.value) * 0.01)) arithmeticIssue = true
    }

    const importantFields = ['merchant', 'transaction_date', 'total']
    const overall = Math.min(...importantFields.map((key) => safeConfidence(x[key].confidence)))
    const needsReview = arithmeticIssue || overall < 0.9 || importantFields.some((key) => x[key].value == null || x[key].needs_review)

    const category = await matchCategory(admin, householdId, {
      category_hint: x.category_hint.value,
      merchant_hint: x.merchant.value,
      description: x.items.map((item: any) => item.name).filter(Boolean).join(' '),
    })

    let account: any = null
    if (x.payment_method.value) {
      const hint = String(x.payment_method.value).replace(/[%_,]/g, ' ')
      const { data } = await admin
        .from('accounts')
        .select('id,name')
        .eq('household_id', householdId)
        .eq('is_active', true)
        .ilike('name', `%${hint}%`)
        .limit(1)
        .maybeSingle()
      account = data
    }

    if (!account) {
      const { data } = await admin
        .from('accounts')
        .select('id,name')
        .eq('household_id', householdId)
        .eq('is_active', true)
        .eq('account_type', 'CASH')
        .limit(1)
        .maybeSingle()
      account = data
    }

    let duplicates: any[] = []
    if (x.total.value != null && x.transaction_date.value) {
      const start = `${x.transaction_date.value}T00:00:00+07:00`
      const end = `${x.transaction_date.value}T23:59:59.999+07:00`
      const { data } = await admin
        .from('transactions')
        .select('id,merchant_name,description,total_amount,transaction_at')
        .eq('household_id', householdId)
        .eq('transaction_type', 'EXPENSE')
        .eq('total_amount', x.total.value)
        .is('deleted_at', null)
        .gte('transaction_at', start)
        .lte('transaction_at', end)
        .limit(10)
      duplicates = data ?? []
    }

    const { data: receipt, error: receiptError } = await admin
      .from('receipts')
      .insert({
        household_id: householdId,
        uploaded_by: authUser.id,
        storage_path: storagePath,
        mime_type: mimeType,
        merchant: x.merchant.value,
        receipt_date: x.transaction_date.value,
        subtotal: x.subtotal.value,
        tax: x.tax.value,
        discount: x.discount.value,
        total: x.total.value,
        extraction_status: needsReview ? 'NEEDS_REVIEW' : 'EXTRACTED',
        overall_confidence: overall,
      })
      .select('id')
      .single()

    if (receiptError) throw receiptError

    if (x.items.length) {
      const rows = x.items.map((item: any, index: number) => ({
        receipt_id: receipt.id,
        line_no: index + 1,
        name: item.name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total: item.total,
        confidence: safeConfidence(item.confidence),
      }))
      const { error: itemError } = await admin.from('receipt_items').insert(rows)
      if (itemError) throw itemError
    }

    const { error: aiError } = await admin.from('ai_extractions').insert({
      household_id: householdId,
      user_id: authUser.id,
      source_type: 'RECEIPT',
      provider,
      model: result.model,
      prompt_version: 'receipt-extractor-v2',
      schema_version: 'v1',
      raw_input_reference: storagePath,
      raw_output: result.raw,
      normalized_output: x,
      confidence: overall,
      needs_review: needsReview,
    })
    if (aiError) throw aiError

    const { data: pref } = await admin
      .from('user_preferences')
      .select('receipt_retention')
      .eq('user_id', authUser.id)
      .maybeSingle()

    if (pref?.receipt_retention === 'DELETE_AFTER_EXTRACTION') {
      await admin.storage.from('receipts').remove([storagePath])
    }

    return json({
      ...x,
      overall_confidence: overall,
      needs_review: needsReview,
      manual_entry_required: false,
      arithmetic_issue: arithmeticIssue,
      duplicate_candidates: duplicates,
      receipt_id: receipt.id,
      storage_path: storagePath,
      suggested_account_id: account?.id ?? null,
      suggested_category_id: category?.id ?? null,
      ai: {
        provider,
        model: result.model,
        routing: [geminiPrimary, ...(isImage ? [qwenFallback] : []), geminiSecondary, geminiLite],
      },
    })
  } catch (error) {
    return handleError(error)
  }
})
