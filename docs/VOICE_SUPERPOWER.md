# Voice Superpower v6

RumaFin voice remains an interpretation layer. It never receives SQL authority. Every command is parsed into a strict JSON allow-list, previewed, role-checked, confirmed, and committed through server-side rules/RPCs.

## Supported voice intents

- CREATE_TRANSACTION
- UPDATE_TRANSACTION
- DELETE_TRANSACTION
- RESTORE_TRANSACTION
- FIND_TRANSACTION
- TRANSFER_MONEY
- CREATE_ACCOUNT
- UPDATE_ACCOUNT
- SET_ACCOUNT_OPENING_BALANCE
- ARCHIVE_ACCOUNT
- DELETE_ACCOUNT_CASCADE
- RESET_ACCOUNT
- CREATE_CATEGORY
- RESET_HOUSEHOLD_FINANCES
- GET_FINANCIAL_SUMMARY

## Confirmation tiers

- READ_ONLY: no mutation.
- NORMAL: explicit confirmation.
- DESTRUCTIVE: red confirmation UI.
- CRITICAL: typed confirmation phrase in addition to the preview.

Critical examples:

- `DELETE_ACCOUNT_CASCADE` -> `HAPUS AKUN <nama akun>`
- `RESET_ACCOUNT` -> `RESET AKUN <nama akun>`
- `RESET_HOUSEHOLD_FINANCES` -> `RESET SEMUA DATA KEUANGAN`

## Role enforcement

- Transaction writes: OWNER / ADMIN / MEMBER through existing financial RPCs.
- Account create/update/archive and category create: OWNER / ADMIN.
- Account reset, permanent account cascade deletion, and household financial reset: OWNER only.

## Reset semantics

`RESET_HOUSEHOLD_FINANCES` resets the financial ledger, not identity data. It:

- soft-deletes active transactions;
- sets every account opening balance to zero;
- deletes budgets;
- deletes recurring transaction definitions;
- keeps household, members, accounts, categories, receipts, and audit history.

`DELETE_ACCOUNT_CASCADE` is deliberately stronger and irreversible from the application UI. It permanently removes the selected account and all transactions that reference that account. A transfer touching that account is removed as a whole to keep both sides of the ledger consistent. Audit metadata remains.

## AI routing

1. Gemini 3.8 Flash
2. Groq `openai/gpt-oss-120b`
3. Groq `openai/gpt-oss-20b`
4. Gemini 3.5 Flash
5. Gemini 3.5 Flash-Lite

Every candidate is semantically validated against the transcript before the router stops. Explicit commands such as `buat akun` cannot be accepted as `CREATE_TRANSACTION`.

If all models fail, no financial mutation is executed.
