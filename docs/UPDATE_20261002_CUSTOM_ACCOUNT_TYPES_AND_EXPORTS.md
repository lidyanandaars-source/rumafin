# Update 2026-10-02 — Custom Account Types + Excel/Word Report Export

This update makes account types household-configurable and extends Voice Superpower so account types can be created, renamed, and removed by voice. It also adds report export to `.xlsx` and `.docx` while preserving the active report filters.

## Account types

Account types are now stored in `public.account_types` instead of being only a fixed frontend enum. The existing legacy enum remains internally for backward compatibility, while `accounts.account_type_id` is the user-facing source of truth.

Default types are seeded for every household: Cash, Bank, E-Wallet, Kartu Kredit, Tabungan, and Lainnya. OWNER/ADMIN users can add, rename, or remove types from **Akun → Tipe akun**. “Delete” is a soft delete: the type disappears from new-account choices, while old accounts and their historical reports retain the label.

Voice examples:

- `Buat tipe akun Crypto.` → `CREATE_ACCOUNT_TYPE`
- `Ubah tipe akun Crypto jadi Aset Digital.` → `UPDATE_ACCOUNT_TYPE`
- `Hapus tipe akun Aset Digital.` → `DELETE_ACCOUNT_TYPE`
- `Buat akun Binance tipe Crypto saldo 5 juta.` → `CREATE_ACCOUNT` using the custom type after it exists.

Every voice mutation still follows interpret → validate → preview → confirm → commit → audit. Ambiguous account-type matches must be selected by the user; the model is not allowed to guess.

## Report export

The Reports page now includes **Excel** and **Word** buttons. Export respects the current period and account/category/member/merchant/transaction-type filters.

Excel contains separate worksheets for Ringkasan, Kategori, Merchant, Harian, Akun, and Transaksi. Transaction amounts remain numeric in Excel so the workbook can be further analyzed.

Word contains the report period/filters, KPI summary, category and merchant tables, account balances, and the filtered transaction detail table.

When a category filter is active, the transaction export contains both **Nilai dalam Filter** and **Total Transaksi**, preventing a split transaction’s full total from being confused with the amount attributable to the selected category.

## Deployment

From the project root:

```powershell
npm install
npm run build
supabase db push
supabase functions deploy voice-interpret
supabase functions deploy transaction-command-preview
supabase functions deploy transaction-command-commit
```

Then commit/push the frontend if Cloudflare deploys from GitHub:

```powershell
git add .
git commit -m "Add custom account types and report exports"
git push
```

`supabase db push` is required before deploying the updated functions because the functions rely on `account_types`, `accounts.account_type_id`, and the new RPCs.

## Post-deploy acceptance checks

1. Add a custom type manually, e.g. `Crypto`.
2. Rename it, then create an account using that type.
3. Delete the type and verify existing accounts still show the historical type label while it no longer appears in the new-account dropdown.
4. Repeat create/rename/delete through Voice Superpower and verify preview/confirmation before commit.
5. Open Reports, apply filters, export Excel and Word, and verify exported values match the on-screen report.
6. With a split transaction and a category filter, verify `Nilai dalam Filter` differs from `Total Transaksi` when appropriate.
