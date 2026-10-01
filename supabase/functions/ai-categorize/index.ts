import { corsHeaders, handleError, json } from '../_shared/http.ts'
import { rateLimit, requireHouseholdAccess, requireUser } from '../_shared/supabase.ts'
import { matchCategory } from '../_shared/preview.ts'
import { geminiJson, groqJson } from '../_shared/ai.ts'

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category_name: { type: ['string', 'null'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['category_name', 'confidence'],
} as const

function safeConfidence(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { admin, authUser } = await requireUser(req)
    await rateLimit(admin, authUser.id, 'ai-categorize', 40)

    const body = await req.json()
    const householdId = String(body.household_id ?? '')
    const merchant = String(body.merchant ?? '').trim()
    const description = String(body.description ?? '').trim()

    if (!householdId) throw new Error('household_id is required')
    await requireHouseholdAccess(admin, authUser.id, householdId, true)

    // Prefer household rules/history before spending an AI request.
    const deterministic = await matchCategory(admin, householdId, {
      merchant_hint: merchant,
      description,
    })

    if (deterministic && deterministic.name !== 'Others') {
      return json({
        category_id: deterministic.id,
        category_name: deterministic.name,
        confidence: 1,
        source: 'HOUSEHOLD_RULE_OR_HISTORY',
        ai: null,
      })
    }

    const { data: categories, error: categoryError } = await admin
      .from('categories')
      .select('id,name')
      .eq('household_id', householdId)
      .eq('is_archived', false)
      .neq('transaction_type', 'INCOME')

    if (categoryError) throw categoryError

    const categoryList = categories ?? []
    if (!categoryList.length) {
      return json({
        category_id: null,
        category_name: null,
        confidence: 0,
        source: 'NO_AVAILABLE_CATEGORIES',
        ai: null,
      })
    }

    const names = categoryList.map((category: any) => category.name)
    const system = `Choose the most appropriate household expense category from this exact list: ${names.join(', ')}. Return only a listed category. Never invent a category. If uncertain return category_name=null and lower confidence. Do not modify financial data.`
    const prompt = `Merchant: ${merchant || '(not provided)'}\nDescription: ${description || '(not provided)'}`

    const geminiPrimary = Deno.env.get('GEMINI_INTENT_MODEL') ?? 'gemini-3.8-flash'
    const groqFallback = Deno.env.get('GROQ_INTENT_MODEL') ?? 'openai/gpt-oss-20b'
    const geminiSecondary = Deno.env.get('GEMINI_INTENT_FALLBACK_MODEL') ?? 'gemini-3.5-flash'
    const geminiLite = Deno.env.get('GEMINI_INTENT_FALLBACK_LITE_MODEL') ?? 'gemini-3.5-flash-lite'

    let parsed: any = null
    let provider: 'gemini' | 'groq' | null = null
    let model: string | null = null
    const failures: string[] = []

    try {
      console.log(`AI categorize: trying Gemini primary (${geminiPrimary})`)
      const result = await geminiJson<any>({ model: geminiPrimary, system, prompt, schema })
      parsed = result.parsed
      provider = 'gemini'
      model = result.model ?? geminiPrimary
    } catch (error) {
      const message = errorMessage(error)
      failures.push(`Gemini primary: ${message}`)
      console.warn(`AI categorize: Gemini primary failed (${geminiPrimary})`, message)
    }

    if (!parsed) {
      try {
        console.log(`AI categorize: trying Groq fallback (${groqFallback})`)
        const result = await groqJson<any>({
          model: groqFallback,
          system,
          prompt,
          schema,
          schemaName: 'expense_category',
        })
        parsed = result.parsed
        provider = 'groq'
        model = result.model ?? groqFallback
      } catch (error) {
        const message = errorMessage(error)
        failures.push(`Groq: ${message}`)
        console.warn(`AI categorize: Groq failed (${groqFallback})`, message)
      }
    }

    if (!parsed) {
      try {
        console.log(`AI categorize: trying Gemini secondary (${geminiSecondary})`)
        const result = await geminiJson<any>({ model: geminiSecondary, system, prompt, schema })
        parsed = result.parsed
        provider = 'gemini'
        model = result.model ?? geminiSecondary
      } catch (error) {
        const message = errorMessage(error)
        failures.push(`Gemini secondary: ${message}`)
        console.warn(`AI categorize: Gemini secondary failed (${geminiSecondary})`, message)
      }
    }

    if (!parsed) {
      try {
        console.log(`AI categorize: trying Gemini Flash-Lite (${geminiLite})`)
        const result = await geminiJson<any>({ model: geminiLite, system, prompt, schema })
        parsed = result.parsed
        provider = 'gemini'
        model = result.model ?? geminiLite
      } catch (error) {
        const message = errorMessage(error)
        failures.push(`Gemini Flash-Lite: ${message}`)
        console.warn(`AI categorize: Gemini Flash-Lite failed (${geminiLite})`, message)
      }
    }

    // Categorization being unavailable must not block a financial workflow.
    if (!parsed) {
      console.error('AI categorize: all AI models failed', failures)
      return json({
        category_id: deterministic?.id ?? null,
        category_name: deterministic?.name ?? null,
        confidence: 0,
        source: deterministic ? 'DETERMINISTIC_FALLBACK_AI_UNAVAILABLE' : 'AI_UNAVAILABLE',
        ai: null,
      })
    }

    const confidence = safeConfidence(parsed.confidence)
    const requestedName = typeof parsed.category_name === 'string' ? parsed.category_name.trim() : null
    const selected = requestedName
      ? categoryList.find((category: any) => category.name.trim().toLocaleLowerCase() === requestedName.toLocaleLowerCase())
      : null

    if (selected) {
      return json({
        category_id: selected.id,
        category_name: selected.name,
        confidence,
        source: 'AI',
        ai: { provider, model, routing: [geminiPrimary, groqFallback, geminiSecondary, geminiLite] },
      })
    }

    return json({
      category_id: deterministic?.id ?? null,
      category_name: deterministic?.name ?? null,
      confidence: 0,
      source: deterministic ? 'DETERMINISTIC_FALLBACK' : 'AI_UNCERTAIN',
      ai: { provider, model },
    })
  } catch (error) {
    return handleError(error)
  }
})
