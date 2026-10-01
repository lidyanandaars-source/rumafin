# Architecture

## Request paths

### Manual transaction
React form → Zod → `create_financial_transaction()` / `update_financial_transaction()` → PostgreSQL validation → transaction + splits + movements + audit log.

### Voice
Browser MediaRecorder → `voice-transcribe` → Groq Whisper → transcript → `voice-interpret` → Gemini 3.8 Flash → Groq GPT-OSS 120B → Groq GPT-OSS 20B → Gemini 3.5 Flash → Gemini 3.5 Flash-Lite → semantic guard/normalization → `voice_commands` + `ai_extractions` → `transaction-command-preview` → deterministic candidate matching → user confirmation → `transaction-command-commit` → guarded financial/account RPC → audit log.

No AI component receives permission to compose or execute SQL.

### Receipt
Private Storage → `receipt-extract` → Gemini 3.8 Flash → Qwen 3.8 27B on Groq for images → Gemini 3.5 Flash → Gemini 3.5 Flash-Lite → per-field confidence + arithmetic checks + duplicate search → receipt/manual review → `finalize_receipt_transaction()` → financial RPC → receipt linked to final transaction. PDF skips Qwen and continues through the Gemini fallbacks.

Unreadable fields must be null, never guessed.

## Source of truth

`transactions` stores the business event. `transaction_splits` stores category allocation. `account_movements` stores balance effects. `account_balances` is a security-invoker view computed from opening balance plus movements attached to confirmed, non-deleted transactions.

## Tenant isolation

Every financial table is household-rooted directly or through its parent transaction/receipt. PostgreSQL RLS uses membership helper functions. OWNER/ADMIN can manage structure; MEMBER can write finance; VIEWER is read-only. Transaction writes additionally pass through RPC authorization.
