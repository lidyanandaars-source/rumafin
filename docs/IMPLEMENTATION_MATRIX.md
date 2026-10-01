# Waterfall → Implementation Matrix

This repository implements the supplied waterfall as an MVP-first full-stack system. The source requirement document is retained as `docs/waterfall-source.docx`.

| Waterfall area | Implementation |
|---|---|
| Requirements / roles | OWNER, ADMIN, MEMBER, VIEWER; authenticated household isolation |
| Domain model | households, accounts, categories, transactions, splits, movements, receipts, budgets, voice commands, AI extractions, audit logs |
| UI/UX | mobile-first responsive React PWA; dashboard, transactions, accounts, categories, budgets, reports, members, settings |
| Backend foundation | Supabase Auth/Postgres/Storage/Edge Functions, RLS, private buckets, atomic transaction RPCs |
| Manual finance | expense, income, transfer, multi-category split, edit, soft delete, restore, search/filter, offline draft |
| Voice | MediaRecorder → Groq Whisper → structured intent → deterministic preview/candidate matching → confirmation → RPC commit |
| Receipt AI | client image optimization → private Storage → Gemini structured extraction → confidence/arithmetic/duplicate review → RPC finalize |
| Reporting | DB-computed KPI, categories, daily trend, merchants, waterfall, heatmap, budget progress; filters by date/account/category/member/merchant/type |
| AI assistant backend | natural-language financial query → structured DB filters → PostgreSQL RPC calculation |
| Security | RLS, JWT, private Storage, server-only AI secrets, rate limiting, MIME/size validation, idempotency, audit logging |
| Testing | Vitest unit tests, pgTAP schema/RPC smoke tests, Playwright smoke test, CI workflow |
| Deployment | GitHub Actions → Supabase migrations/functions/secrets + Cloudflare Workers Static Assets |
| Monitoring hooks | AI provider/model/prompt/schema logged; API request log; audit log; function errors surfaced safely |

## Deliberately deferred beyond MVP

The database foundation includes room for recurring transactions, but automatic recurring creation, bank synchronization, investment tracking, debt/assets, multi-currency accounting, WhatsApp/email receipt ingestion, saved filters, exports, anomaly detection and subscription detection remain future releases, matching the supplied roadmap rather than silently expanding MVP scope.
