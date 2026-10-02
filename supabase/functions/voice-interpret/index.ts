import { corsHeaders, handleError, json } from '../_shared/http.ts'
import {
  rateLimit,
  requireHouseholdAccess,
  requireUser,
} from '../_shared/supabase.ts'
import { financialCommandBatchSchema } from '../_shared/schemas.ts'
import { geminiJson, groqJson } from '../_shared/ai.ts'
import {
  detectDeterministicIntent,
  normalizeFinancialCandidate,
  validateFinancialCandidate,
} from '../_shared/financial-command.ts'

function commandNeedsReview(command: any) {
  const highRiskIntents = new Set([
    'DELETE_ACCOUNT_CASCADE',
    'RESET_ACCOUNT',
    'RESET_HOUSEHOLD_FINANCES',
  ])

  if (Number(command?.confidence ?? 0) < 0.9) return true
  if (highRiskIntents.has(String(command?.intent ?? ''))) return true

  if (command?.intent === 'CREATE_TRANSACTION') {
    return command.amount == null || !command.account_hint || (!command.category_hint && !command.description && !command.merchant_hint)
  }
  if (command?.intent === 'CREATE_ACCOUNT') {
    return !String(command.account_hint ?? '').trim() || !String(command.account_type ?? '').trim()
  }
  if (command?.intent === 'CREATE_ACCOUNT_TYPE') {
    return !String(command.account_type_name ?? '').trim()
  }
  if (command?.intent === 'CREATE_CATEGORY') {
    return !String(command.category_name ?? '').trim()
  }
  return false
}

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
Convert the user's voice transcript into structured JSON matching the supplied BATCH schema only.

CORE RULE:
AI interprets. The application validates. The database calculates. The user remains in control.

MULTI-COMMAND RULES — CRITICAL:
- One spoken transcript may contain ONE OR MANY commands. Split it into atomic commands in the exact spoken order.
- Return one commands[] item for every distinct requested action. Do not merge separate purchases, separate account creations, separate category creations, or separate account-type creations into one command.
- Maximum 20 atomic commands.
- source_text must be the smallest faithful transcript span for that item. Do not paraphrase it.
- Shared context may be inherited only when grammar clearly makes it apply to following list items. Example: "kemarin beli beras 100 ribu cash, beli baju 200 ribu cash" means both purchases are YESTERDAY. Example: "buat akun A saldo 1 juta, B saldo 2 juta" means both are CREATE_ACCOUNT.
- Never inherit a value merely because it would be convenient. If a later item has no clear account/type/category/date and shared context does not grammatically apply, leave that field null.
- Example: "buat akun A saldo 1 juta, B saldo 2 juta, C saldo 3 juta" => three CREATE_ACCOUNT commands.
- Example: "kemarin beli beras 100 ribu cash, beli baju 200 ribu cash" => two CREATE_TRANSACTION commands.
- Example: "buat tipe akun Crypto dan Investasi" => two CREATE_ACCOUNT_TYPE commands.
- Example: "buat kategori Sekolah dan Les untuk pengeluaran" => two CREATE_CATEGORY commands; the shared transaction type EXPENSE applies to both.
- A mixed transcript may contain different intents. Example: "buat akun Emas saldo nol lalu catat beli beras 50 ribu cash" => two commands with different intents.

ABSOLUTE SAFETY RULES:
- You interpret intent only. Never execute SQL and never claim an action is already completed.
- Never invent an amount, account, category, merchant, date, transaction, selector, account balance, or database ID.
- If an important field is uncertain, return null for that field and lower confidence. The UI can ask the user to complete it manually.
- Destructive actions are candidate intents only. The application independently matches entities, previews impact, requires confirmation, enforces roles, and commits server-side.
- Never turn a vague phrase such as "hapus semuanya" into DELETE_ACCOUNT_CASCADE unless a specific account and its transaction history are clearly referenced.
- RESET_HOUSEHOLD_FINANCES is allowed only when the transcript clearly asks to reset all household financial data/balances/transactions from zero.
- DELETE_ACCOUNT_CASCADE is allowed only when the user clearly asks to delete an identified account together with its transaction history.
- RESET_ACCOUNT keeps the account but resets its financial state according to application rules.

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
CREATE_ACCOUNT_TYPE
UPDATE_ACCOUNT_TYPE
DELETE_ACCOUNT_TYPE
CREATE_CATEGORY
RESET_HOUSEHOLD_FINANCES
GET_FINANCIAL_SUMMARY

Today in Asia/Jakarta is ${today}.

INTENT DISAMBIGUATION — ACCOUNT VS TRANSACTION:
- Words such as "buat akun", "bikin akun", "tambah akun", "buat rekening", or "akun baru" mean CREATE_ACCOUNT.
- NEVER interpret an explicit account-creation command as CREATE_TRANSACTION.
- A balance stated while creating an account is account_changes.opening_balance. It is NOT a transaction amount, income, expense, or transfer.
- For CREATE_ACCOUNT, put the new account name in account_hint. account_selector must be null because there is no existing account to select.
- If the transcript clearly identifies the account type, set account_type. Examples: "Bank Mandiri" -> BANK, "GoPay ewallet" -> EWALLET, "Cash" -> CASH, "kartu kredit" -> CREDIT_CARD.
- For UPDATE_ACCOUNT / SET_ACCOUNT_OPENING_BALANCE / ARCHIVE_ACCOUNT / DELETE_ACCOUNT_CASCADE / RESET_ACCOUNT, put the existing account name in account_selector.name.
- Account types are household-configurable. Use CREATE_ACCOUNT_TYPE / UPDATE_ACCOUNT_TYPE / DELETE_ACCOUNT_TYPE only for explicit phrases such as "buat tipe akun", "ubah tipe akun", or "hapus tipe akun".
- For CREATE_ACCOUNT, account_type may be a built-in alias (BANK, CASH, EWALLET, CREDIT_CARD, SAVINGS, OTHER) or an exact custom household type name supplied by the user.

INDONESIAN AMOUNTS:
85 ribu = 85000
250 ribu = 250000
500 ribu = 500000
1 juta = 1000000
1,5 juta = 1500000
10 juta = 10000000
satu juta dua ratus ribu = 1200000
"saldo nol" = opening_balance 0 when creating/updating an account.

TRANSACTION EXAMPLES:
"catat makan siang 85 ribu pakai cash hari ini"
=> CREATE_TRANSACTION, transaction_type EXPENSE, amount 85000, account_hint cash, description makan siang.

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
=> CREATE_ACCOUNT, account_hint GoPay, account_type EWALLET, account_selector null, account_changes.opening_balance 100000.

"Buat akun baru bernama Bank Mandiri dengan saldo 10 juta rupiah"
=> CREATE_ACCOUNT, account_hint Bank Mandiri, account_type BANK, account_selector null, account_changes.opening_balance 10000000.

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

ACCOUNT TYPE EXAMPLES:
"buat tipe akun Crypto"
=> CREATE_ACCOUNT_TYPE, account_type_name Crypto.

"ubah tipe akun Crypto jadi Aset Digital"
=> UPDATE_ACCOUNT_TYPE, account_type_selector.name Crypto, account_type_changes.name Aset Digital.

"hapus tipe akun Aset Digital"
=> DELETE_ACCOUNT_TYPE, account_type_selector.name Aset Digital.

"buat akun Binance tipe Crypto saldo 5 juta"
=> CREATE_ACCOUNT, account_hint Binance, account_type Crypto, account_changes.opening_balance 5000000.

SYSTEM EXAMPLE:
"reset semua keuangan dari nol"
=> RESET_HOUSEHOLD_FINANCES.
This resets the financial ledger while keeping household identity, members, account structure, categories, and audit history.

CATEGORY EXAMPLE:
"buat kategori Pets untuk pengeluaran"
=> CREATE_CATEGORY, category_name Pets, category_transaction_type EXPENSE.

For every field not relevant to each selected intent, return null while still satisfying the supplied JSON schema.
Return JSON matching the supplied BATCH schema only.
`.trim()

    const geminiPrimary = Deno.env.get('GEMINI_INTENT_MODEL') ?? 'gemini-3.8-flash'
    const groqPrimary = Deno.env.get('GROQ_INTENT_MODEL') ?? 'openai/gpt-oss-120b'
    const groqSecondary = Deno.env.get('GROQ_INTENT_FALLBACK_MODEL') ?? 'openai/gpt-oss-20b'
    const geminiSecondary = Deno.env.get('GEMINI_INTENT_FALLBACK_MODEL') ?? 'gemini-3.5-flash'
    const geminiLite = Deno.env.get('GEMINI_INTENT_FALLBACK_LITE_MODEL') ?? 'gemini-3.5-flash-lite'

    type Attempt = {
      provider: 'gemini' | 'groq'
      label: string
      model: string
      run: () => Promise<{ parsed: any; raw: any; model?: string }>
    }

    const attempts: Attempt[] = [
      {
        provider: 'gemini',
        label: 'Gemini primary',
        model: geminiPrimary,
        run: () => geminiJson<any>({ model: geminiPrimary, system, prompt: transcript, schema: financialCommandBatchSchema }),
      },
      {
        provider: 'groq',
        label: 'Groq primary',
        model: groqPrimary,
        run: () => groqJson<any>({ model: groqPrimary, system, prompt: transcript, schema: financialCommandBatchSchema, schemaName: 'financial_command_batch_v1' }),
      },
      {
        provider: 'groq',
        label: 'Groq secondary',
        model: groqSecondary,
        run: () => groqJson<any>({ model: groqSecondary, system, prompt: transcript, schema: financialCommandBatchSchema, schemaName: 'financial_command_batch_v1' }),
      },
      {
        provider: 'gemini',
        label: 'Gemini secondary',
        model: geminiSecondary,
        run: () => geminiJson<any>({ model: geminiSecondary, system, prompt: transcript, schema: financialCommandBatchSchema }),
      },
      {
        provider: 'gemini',
        label: 'Gemini Flash-Lite',
        model: geminiLite,
        run: () => geminiJson<any>({ model: geminiLite, system, prompt: transcript, schema: financialCommandBatchSchema }),
      },
    ]

    let normalizedItems: Array<{ source_text: string; command: any }> | null = null
    let raw: any = null
    let provider = ''
    let model = ''
    let lastModelError: unknown = null

    for (const attempt of attempts) {
      try {
        console.log(`Voice intent: trying ${attempt.label} (${attempt.model})`)
        const result = await attempt.run()
        const items = Array.isArray(result.parsed?.commands) ? result.parsed.commands : []
        if (!items.length || items.length > 20) throw new Error('AI returned an invalid command batch size')

        const normalized = items.map((item: any) => {
          const sourceText = String(item?.source_text ?? '').trim() || transcript
          const command = normalizeFinancialCandidate(item?.command, sourceText)
          const sourceIsWholeBatch = items.length > 1 && sourceText === transcript
          validateFinancialCandidate(command, sourceText, !sourceIsWholeBatch)
          command.confidence = Math.max(0, Math.min(1, Number(command.confidence ?? 0)))
          return { source_text: sourceText, command }
        })

        normalizedItems = normalized
        raw = result.raw
        provider = attempt.provider
        model = result.model ?? attempt.model
        console.log(`Voice intent: ${attempt.label} succeeded (${model}) with ${normalized.length} command(s)`)
        break
      } catch (error) {
        lastModelError = error
        console.warn(`Voice intent: ${attempt.label} rejected/failed (${attempt.model})`, error)
      }
    }

    if (!normalizedItems?.length) {
      console.error('Voice intent: all configured AI models failed semantic validation or API execution', lastModelError)
      throw new Error('AI interpretation is temporarily unavailable or inconsistent. Please try again.')
    }

    const confidences = normalizedItems.map((item) => Number(item.command.confidence ?? 0))
    const overallConfidence = confidences.length ? Math.min(...confidences) : 0
    const needsReview = normalizedItems.some((item) => commandNeedsReview(item.command))
    const promptVersion = 'voice-intent-v8-multi-command-review'
    const schemaVersion = 'v5-batch'

    const normalizedOutput = {
      commands: normalizedItems,
    }

    const { error: aiError } = await admin.from('ai_extractions').insert({
      household_id: householdId,
      user_id: authUser.id,
      source_type: 'VOICE',
      provider,
      model,
      prompt_version: promptVersion,
      schema_version: schemaVersion,
      raw_input_reference: audioPath,
      raw_output: raw,
      normalized_output: normalizedOutput,
      confidence: overallConfidence,
      needs_review: needsReview,
    })
    if (aiError) throw aiError

    const commandRows = normalizedItems.map((item, index) => {
      const id = crypto.randomUUID()
      return {
        id,
        user_id: authUser.id,
        household_id: householdId,
        audio_path: index === 0 ? audioPath : null,
        transcript: item.source_text,
        intent: item.command.intent,
        parsed_payload: item.command,
        confidence: item.command.confidence,
        status: 'PARSED',
      }
    })

    const { error: commandError } = await admin.from('voice_commands').insert(commandRows)
    if (commandError) throw commandError

    const commands = commandRows.map((row, index) => ({
      command_id: row.id,
      source_text: normalizedItems![index].source_text,
      command: normalizedItems![index].command,
    }))

    const first = commands[0]
    const singleDeterministicIntent = commands.length === 1 ? detectDeterministicIntent(first.source_text) : null

    return json({
      command_id: first.command_id,
      command: first.command,
      commands,
      transcript,
      ai: {
        provider,
        model,
        prompt_version: promptVersion,
        schema_version: schemaVersion,
        command_count: commands.length,
        deterministic_intent_hint: singleDeterministicIntent,
        routing: attempts.map((attempt) => attempt.model),
      },
    })
  } catch (error) {
    console.error('voice-interpret failed', error)
    return handleError(error)
  }
})
