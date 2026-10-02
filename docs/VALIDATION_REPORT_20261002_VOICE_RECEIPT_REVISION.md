# Validation Report — Voice & Receipt Revision (2026-10-02)

## Scope checked

- `src/features/voice/VoiceDialog.tsx`
- `src/features/receipts/ReceiptDialog.tsx`
- `src/features/receipts/receipt-utils.ts`
- `supabase/functions/transaction-command-commit/index.ts`
- `supabase/functions/receipt-extract/index.ts`
- `supabase/functions/_shared/schemas.ts`
- `supabase/functions/_shared/preview.ts`
- `src/types/domain.ts`
- `supabase/migrations/202610020003_receipt_multi_transactions.sql`
- `supabase/tests/database.sql`

## Checks completed

1. TypeScript/TSX syntax transpilation check using TypeScript 5.8.3: **PASS** for all changed TS/TSX files.
2. Receipt grouping smoke test:
   - Jajan Rp50.000 / category food
   - Pampers Rp50.000 / category child
   - result: two groups, Rp50.000 each: **PASS**.
3. SQL migration structural check:
   - balanced parentheses: **PASS**;
   - balanced dollar quotes: **PASS**;
   - migration includes `receipt_transactions`, `voice_commands.manual_override`, and `finalize_receipt_transactions`: **PASS**.
4. Database pgTAP manifest updated from 6 to 8 assertions to include the new table and RPC.

## Environment limitation

A full `npm install` / Vite build could not be executed in this sandbox because access to the npm registry timed out. The source package itself does not include `node_modules`, consistent with normal repository packaging. CI or a local environment with registry access should still run `npm run check` before production deployment.
