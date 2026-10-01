# Validation report — Voice semantic fix 2026-10-02

## Checks completed

- TypeScript compilation passed for the new pure semantic guard and preview modules:
  - `supabase/functions/_shared/financial-command.ts`
  - `supabase/functions/_shared/preview.ts`
- Runtime regression checks passed with Node's TypeScript stripping for the reported transcript.
- Verified deterministic route: `CREATE_ACCOUNT`.
- Verified normalized account name: `Bank Mandiri`.
- Verified inferred account type: `BANK`.
- Verified opening balance: `10000000`.
- Verified a wrong `CREATE_TRANSACTION` candidate is rejected by semantic validation.
- Verified a valid CREATE_ACCOUNT preview is committable and displays the correct opening balance.
- Verified missing transaction fields no longer become `Rp0`, `Cash`, or `Others`, and the preview is blocked from commit.
- All 65 TypeScript/TSX files were syntax-parsed successfully with TypeScript.
- JSON files parsed successfully.
- GitHub Actions YAML parsed successfully after synchronizing the new Groq/Gemini fallback model variables.
- Isolated TypeScript type-check passed for the semantic guard and preview modules.

## Limitation

A full `npm run check` could not be completed in the validation container because `npm install` did not complete within the available execution window. The repository itself still contains the normal test/build scripts, and the added Vitest regression tests should be run in the development/CI environment after dependencies are installed.

Recommended final verification after deployment:

```bash
npm install
npm run check
```

Then deploy the changed Edge Functions and frontend and repeat the Bank Mandiri voice command described in `VOICE_FIX_20261002.md`.
