# MVP Acceptance Checklist

## Financial domain

- [ ] Expense creates one negative account movement.
- [ ] Income creates one positive account movement.
- [ ] Transfer creates one negative + one positive movement and does not increase expense.
- [ ] Multi-category split must sum exactly to transaction total.
- [ ] Soft delete removes the transaction effect from account balance/reporting.
- [ ] Restore re-applies the effect exactly once.
- [ ] Repeated request with the same idempotency key does not duplicate a transaction.

## Tenant isolation

- [ ] User in Household A cannot select any row belonging only to Household B.
- [ ] VIEWER cannot create/edit/delete financial data.
- [ ] MEMBER cannot administer accounts/categories/budgets/members beyond allowed finance writes.

## Voice critical cases

- [ ] “Beli makan 75 ribu cash” → expense 75,000, Cash, food candidate.
- [ ] “Bayar listrik satu juta dua ratus ribu” → amount 1,200,000, Electricity/Housing candidate.
- [ ] “Hapus belanja kemarin” with >1 match → no delete until one candidate is selected.
- [ ] Unclear amount → no invented amount; user is directed to manual completion.
- [ ] “Buat akun baru bernama Bank Mandiri dengan saldo 10 juta rupiah” → CREATE_ACCOUNT, Bank Mandiri, BANK, opening balance 10,000,000.
- [ ] Explicit account creation must never persist as CREATE_TRANSACTION.
- [ ] Missing transaction amount/account/category must not silently render as Rp0/Cash/Others and must block commit.
- [ ] Retried commit → no duplicate financial transaction.

## Receipt critical cases

- [ ] Clear supermarket receipt extracts merchant/date/total.
- [ ] Blurred total → total null + needs review.
- [ ] Subtotal + tax − discount arithmetic inconsistency is flagged.
- [ ] Same merchant/date/total existing transaction triggers duplicate warning.
- [ ] Split-by-item is only enabled when item totals reconcile to the receipt total.
- [ ] User can save manually even if AI service fails after file upload.

## PWA / reliability

- [ ] Manual transaction can be queued offline and syncs after connectivity returns.
- [ ] Voice and receipt clearly report that internet is required.
- [ ] Cloudflare SPA fallback works on direct navigation to nested routes.
- [ ] Gemini/Groq keys do not appear in built frontend assets.
