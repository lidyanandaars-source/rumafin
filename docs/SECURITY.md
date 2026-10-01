# Security & Privacy

- HTTPS is provided by Cloudflare/Supabase in production.
- Receipt and voice buckets are private.
- All exposed financial tables have RLS enabled.
- AI provider secrets are server-side only.
- Transaction writes are atomic RPCs; internal tables are not directly writable from the browser.
- Delete is soft-delete; restore is auditable.
- Edge Functions apply per-user per-endpoint rate limits.
- Voice/receipt MIME and file-size limits are checked before AI calls.
- Voice delete/update requires an exact selected candidate when matching is ambiguous.
- AI raw output is isolated in `ai_extractions` and not treated as final financial data.
- Prompt/model/schema versions are logged for model-change debugging.
- Default voice retention is `NEVER`.
- Receipt original retention can be `KEEP` or `DELETE_AFTER_EXTRACTION`.
- Idempotency keys prevent retry-driven duplicate transaction creation.

Before production launch, rotate all test keys, run RLS tests against two independent households, enable provider billing alerts, and review Supabase Auth redirect allowlists.
