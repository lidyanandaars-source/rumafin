import { corsHeaders, handleError, json } from '../_shared/http.ts'
import {
  rateLimit,
  requireHouseholdAccess,
  requireUser,
} from '../_shared/supabase.ts'
import { financialCommandSchema } from '../_shared/schemas.ts'
import { geminiJson, groqJson } from '../_shared/ai.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { admin, authUser } = await requireUser(req)
    await rateLimit(admin, authUser.id, 'voice-interpret', 30)

    const body = await req.json()
    const householdId = String(body.household_id ?? '')
    const transcript = String(body.transcript ?? '').trim()
    const audioPath = body.audio_path ? String(body.audio_path) : null

    if (!householdId || !transcript) {
      throw new Error('household_id and transcript are required')
    }

    await requireHouseholdAccess(admin, authUser.id, householdId, true)

    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const getPart = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
    const today = `${getPart('year')}-${getPart('month')}-${getPart('day')}`

    const system = `
You are the intent interpreter for an Indonesian household-finance application.
Convert the user's voice transcript into structured JSON matching the supplied schema only.

ABSOLUTE SAFETY RULES:
- You interpret intent only. You never execute SQL or claim an action is already completed.
- Never invent an amount, account, category, merchant, date, transaction, selector, or account balance.
- If an important field is uncertain, return null for that field and lower confidence.
- Destructive actions are only candidate intents. The application will independently match entities, show impact, require confirmation, enforce roles, and execute server-side business rules.
- Never turn a vague phrase such as "hapus semuanya" into DELETE_ACCOUNT_CASCADE unless an account is clearly identified.
- RESET_HOUSEHOLD_FINANCES is allowed only when the transcript clearly asks to reset all household financial data/balances/transactions from zero.
- DELETE_ACCOUNT_CASCADE is allowed only when the user clearly asks to delete an account together with its transaction history.
- RESET_ACCOUNT means keep the account but reset its opening balance to zero and remove its ledger effect through application rules.
- Account names must be placed in account_selector.name, not invented IDs.

SUPPORTED INTENTS:
CREATE_TRANSACTION
UPDATE_TRANSACTION
DELETE_TRANSACTION
RESTORE_TRANSACTION
FIND_TRANSACTION
TRANSFER_MONEY
CREATE_ACCOUNT
UPDATE_ACCOUNT
SET_ACCOUNT_OPENING_BALANCE
ARCHIVE_ACCOUNT
DELETE_ACCOUNT_CASCADE
RESET_ACCOUNT
CREATE_CATEGORY
RESET_HOUSEHOLD_FINANCES
GET_FINANCIAL_SUMMARY

Today in Asia/Jakarta is ${today}.

INDONESIAN AMOUNTS:
85 ribu = 85000
250 ribu = 250000
500 ribu = 500000
1 juta = 1000000
1,5 juta = 1500000
satu juta dua ratus ribu = 1200000

TRANSACTION EXAMPLES:
"catat makan siang 85 ribu pakai cash hari ini"
=> CREATE_TRANSACTION, amount 85000, account_hint cash, description makan siang.

"ubah transaksi kopi kemarin 25 ribu jadi 30 ribu"
=> UPDATE_TRANSACTION, selector identifies the old transaction, changes.amount 30000.

"hapus transaksi Grab 42 ribu kemarin"
=> DELETE_TRANSACTION with selector. Do not pick among multiple matches.

"pulihkan transaksi kopi kemarin"
=> RESTORE_TRANSACTION with selector.

"pindahkan 500 ribu dari BCA ke Cash"
=> TRANSFER_MONEY, amount 500000, source_account_hint BCA, destination_account_hint Cash.

ACCOUNT EXAMPLES:
"buat akun GoPay ewallet saldo awal 100 ribu"
=> CREATE_ACCOUNT, account_hint GoPay, account_type EWALLET, account_changes.opening_balance 100000.

"ganti nama akun BCA jadi BCA Utama"
=> UPDATE_ACCOUNT, account_selector.name BCA, account_changes.name BCA Utama.

"ubah saldo awal akun BCA jadi 5 juta"
=> SET_ACCOUNT_OPENING_BALANCE, account_selector.name BCA, account_changes.opening_balance 5000000.

"arsipkan akun OVO"
=> ARCHIVE_ACCOUNT, account_selector.name OVO.

"hapus akun OVO beserta semua transaksinya"
=> DELETE_ACCOUNT_CASCADE, account_selector.name OVO.

"reset akun Cash ke nol"
=> RESET_ACCOUNT, account_selector.name Cash.

SYSTEM EXAMPLE:
"reset semua keuangan dari nol"
=> RESET_HOUSEHOLD_FINANCES.
This means reset the financial ledger while keeping the household identity, members, account structure, categories, and audit history.

CATEGORY EXAMPLE:
"buat kategori Pets untuk pengeluaran"
=> CREATE_CATEGORY, category_name Pets, category_transaction_type EXPENSE.

For every field not relevant to the intent, return null while still satisfying the schema.
Return JSON matching the supplied schema only.
`.trim()

    const geminiPrimary = Deno.env.get('GEMINI_INTENT_MODEL') ?? 'gemini-3.8-flash'
    const groqFallback = Deno.env.get('GROQ_INTENT_MODEL') ?? 'openai/gpt-oss-20b'
    const geminiSecondary = Deno.env.get('GEMINI_INTENT_FALLBACK_MODEL') ?? 'gemini-3.5-flash'
    const geminiLite = Deno.env.get('GEMINI_INTENT_FALLBACK_LITE_MODEL') ?? 'gemini-3.5-flash-lite'

    let parsed: any = null
    let raw: any = null
    let provider = 'gemini'
    let model = geminiPrimary

    try {
      console.log(`Voice intent: trying Gemini primary (${geminiPrimary})`)
      const result = await geminiJson<any>({
        model: geminiPrimary,
        system,
        prompt: transcript,
        schema: financialCommandSchema,
      })
      parsed = result.parsed
      raw = result.raw
      provider = 'gemini'
      model = result.model ?? geminiPrimary
      console.log(`Voice intent: Gemini primary succeeded (${model})`)
    } catch (geminiPrimaryError) {
      console.warn(`Voice intent: Gemini primary failed (${geminiPrimary})`, geminiPrimaryError)

      try {
        console.log(`Voice intent: trying Groq fallback (${groqFallback})`)
        const result = await groqJson<any>({
          model: groqFallback,
          system,
          prompt: transcript,
          schema: financialCommandSchema,
          schemaName: 'financial_command_v2',
        })
        parsed = result.parsed
        raw = result.raw
        provider = 'groq'
        model = result.model ?? groqFallback
        console.log(`Voice intent: Groq fallback succeeded (${model})`)
      } catch (groqError) {
        console.warn(`Voice intent: Groq fallback failed (${groqFallback})`, groqError)

        try {
          console.log(`Voice intent: trying Gemini secondary (${geminiSecondary})`)
          const result = await geminiJson<any>({
            model: geminiSecondary,
            system,
            prompt: transcript,
            schema: financialCommandSchema,
          })
          parsed = result.parsed
          raw = result.raw
          provider = 'gemini'
          model = result.model ?? geminiSecondary
          console.log(`Voice intent: Gemini secondary succeeded (${model})`)
        } catch (geminiSecondaryError) {
          console.warn(`Voice intent: Gemini secondary failed (${geminiSecondary})`, geminiSecondaryError)

          try {
            console.log(`Voice intent: trying Gemini Flash-Lite (${geminiLite})`)
            const result = await geminiJson<any>({
              model: geminiLite,
              system,
              prompt: transcript,
              schema: financialCommandSchema,
            })
            parsed = result.parsed
            raw = result.raw
            provider = 'gemini'
            model = result.model ?? geminiLite
            console.log(`Voice intent: Gemini Flash-Lite succeeded (${model})`)
          } catch (geminiLiteError) {
            console.error(`Voice intent: Gemini Flash-Lite failed (${geminiLite})`, geminiLiteError)
            throw new Error('AI interpretation is temporarily unavailable. Please try again.')
          }
        }
      }
    }

    if (!parsed || typeof parsed !== 'object' || !parsed.intent || typeof parsed.confidence !== 'number') {
      throw new Error('AI returned an invalid financial command')
    }

    parsed.confidence = Math.max(0, Math.min(1, parsed.confidence))

    const highRiskIntents = new Set([
      'DELETE_ACCOUNT_CASCADE',
      'RESET_ACCOUNT',
      'RESET_HOUSEHOLD_FINANCES',
    ])
    const missingCreateAmount = parsed.intent === 'CREATE_TRANSACTION' && parsed.amount == null
    const needsReview = parsed.confidence < 0.9 || missingCreateAmount || highRiskIntents.has(parsed.intent)

    const { error: aiError } = await admin.from('ai_extractions').insert({
      household_id: householdId,
      user_id: authUser.id,
      source_type: 'VOICE',
      provider,
      model,
      prompt_version: 'voice-intent-v4-superpower',
      schema_version: 'v2',
      raw_input_reference: audioPath,
      raw_output: raw,
      normalized_output: parsed,
      confidence: parsed.confidence,
      needs_review: needsReview,
    })
    if (aiError) throw aiError

    const { data: command, error: commandError } = await admin
      .from('voice_commands')
      .insert({
        user_id: authUser.id,
        household_id: householdId,
        audio_path: audioPath,
        transcript,
        intent: parsed.intent,
        parsed_payload: parsed,
        confidence: parsed.confidence,
        status: 'PARSED',
      })
      .select('id')
      .single()
    if (commandError) throw commandError

    return json({
      command_id: command.id,
      transcript,
      command: parsed,
      ai: {
        provider,
        model,
        prompt_version: 'voice-intent-v4-superpower',
        routing: [geminiPrimary, groqFallback, geminiSecondary, geminiLite],
      },
    })
  } catch (error) {
    console.error('voice-interpret failed', error)
    return handleError(error)
  }
})
