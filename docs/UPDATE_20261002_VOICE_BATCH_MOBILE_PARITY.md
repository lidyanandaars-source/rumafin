# Update 2026-10-02 — Editable Voice Review, Multi-command Voice, Mobile Parity

## Scope

This revision implements three requested behaviors without changing the core safety rule: AI interprets, application validates, database calculates, user remains in control.

## 1. Manual completion before voice finalization

Voice-created entities no longer require the user to re-record or edit the transcript only because a field is unresolved.

- `CREATE_TRANSACTION`: amount, account, category, and description are editable before commit.
- `CREATE_ACCOUNT`: account name, account type, and opening balance are always editable before commit. If account type is unresolved, the UI exposes the household account-type selector.
- `CREATE_ACCOUNT_TYPE`: the proposed type name is editable before commit.
- `CREATE_CATEGORY`: category name, transaction type, and parent category are editable before commit.

The server re-validates every manual override. Manual values are saved to `voice_commands.manual_override` for audit/debugging.

## 2. Multiple commands in one voice instruction

`voice-interpret` now uses a batch structured-output schema. One utterance can yield up to 20 ordered atomic commands.

Examples:

- `Buat akun A saldo 1 juta, B saldo 2 juta, C saldo 3 juta` → three `CREATE_ACCOUNT` command records.
- `Kemarin beli beras 100 ribu cash, beli baju 200 ribu cash` → two `CREATE_TRANSACTION` command records.
- `Buat tipe akun Crypto dan Investasi` → two `CREATE_ACCOUNT_TYPE` commands.
- `Buat kategori Sekolah dan Les untuk pengeluaran` → two `CREATE_CATEGORY` commands.

Each atomic command receives its own `voice_commands.id`, preview, manual-review state, idempotency protection, and commit call. The UI presents all detected commands in one review dialog and exposes a single **Simpan semua** action. If a later command fails after earlier ones succeeded, retry is safe because already executed command IDs are idempotent.

No database migration is required for this batch behavior because the existing `voice_commands` table already stores one structured command per row.

## 3. Mobile feature parity

The mobile bottom navigation now includes **Menu**. The mobile menu exposes:

- Accounts and custom account types;
- Categories and subcategories;
- Budgets;
- Reports and Excel/Word export;
- Household members;
- Settings;
- Household switcher;
- Logout.

Account, category, and report page action layouts were also adjusted so primary controls remain usable at narrow phone widths.

## Deployment

No new SQL migration is introduced by this revision. Deploy the updated frontend and the affected Supabase Edge Functions:

```powershell
npx supabase functions deploy voice-interpret
npx supabase functions deploy transaction-command-preview
npx supabase functions deploy transaction-command-commit
```

`transaction-command-preview` itself has no functional schema change in this revision, but deploying it together keeps the voice pipeline versions aligned. Deploying all functions is also safe:

```powershell
npx supabase functions deploy
```

Then rebuild/deploy the frontend so the new review UI and mobile menu are live.
