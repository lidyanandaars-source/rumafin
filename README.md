# RumaFin AI — Household Finance Full-stack

Production-oriented household finance PWA based on the supplied waterfall specification.

## Architecture

- **Frontend:** React + TypeScript + Vite + Tailwind + shadcn-style local UI + TanStack Query + ECharts
- **Delivery:** Cloudflare Workers Static Assets (SPA fallback)
- **Backend:** Supabase Auth + PostgreSQL + Storage + Edge Functions + RLS
- **Voice:** Groq Whisper Large V3 Turbo, fallback Whisper Large V3
- **Intent / receipt:** Gemini Flash-class model configured by environment variable; Groq structured-output fallback for intent
- **Source of truth:** PostgreSQL. AI never writes SQL and never becomes the financial calculation engine.

Core rule: **AI interprets → application validates → database calculates → user remains in control.**

## Implemented MVP

Authentication (email/password, magic link, optional Google), household onboarding, roles, accounts, customizable categories/subcategories, expense/income/transfer, multi-category split transactions, atomic account movements, soft delete/restore, search/filter foundation, dashboard with budget progress, DB-calculated reports with date/account/category/member/merchant/type filters, budgets, voice CREATE/UPDATE/DELETE with candidate confirmation, receipt upload/extraction/review, receipt item split when arithmetic is consistent, duplicate detection, private storage, audit logs, PWA, offline manual drafts, privacy retention preferences, member invitations, rate limiting, idempotency, and AI prompt/model logging.

## Local setup

1. Install Node.js 22+, Docker, Supabase CLI, and npm dependencies.
2. Copy `.env.example` → `.env.local` and fill the Supabase URL + publishable/anon key.
3. Copy `supabase/functions/.env.example` → `supabase/functions/.env` and fill Groq/Gemini keys.
4. Run:

```bash
npm install
npx supabase start
npx supabase db reset
npx supabase functions serve --env-file supabase/functions/.env
npm run dev
```

The local Supabase URL/keys are printed by `supabase start`.

## AI secrets

Never place `GROQ_API_KEY`, `GEMINI_API_KEY`, or `SUPABASE_SERVICE_ROLE_KEY` in Vite variables. Production AI secrets belong in Supabase Edge Function secrets:

```bash
supabase secrets set GROQ_API_KEY=... GEMINI_API_KEY=... \
  GROQ_TRANSCRIPTION_MODEL=whisper-large-v3-turbo \
  GROQ_TRANSCRIPTION_FALLBACK_MODEL=whisper-large-v3 \
  GROQ_INTENT_MODEL=openai/gpt-oss-20b \
  GEMINI_INTENT_MODEL=gemini-3.8-flash \
  GEMINI_RECEIPT_MODEL=gemini-3.8-flash \
  APP_URL=https://your-domain.example
```

Model names are intentionally configurable because providers can deprecate or rename models.

## Database safety

Browser clients have SELECT access to transaction internals but **no direct INSERT/UPDATE/DELETE grants** for `transactions`, `transaction_splits`, or `account_movements`. Writes go through security-definer RPCs that re-check household membership and enforce:

- amount > 0;
- expense = one negative movement;
- income = one positive movement;
- transfer = exactly one debit + one credit, same absolute amount, distinct accounts;
- split sum = transaction total;
- categories/accounts must belong to the same household;
- idempotency key uniqueness;
- audit logging;
- soft delete / restore.

## Verification

```bash
npm run typecheck
npm run test
npm run build
npx supabase test db
npm run test:e2e
```

`docs/ACCEPTANCE_CHECKLIST.md` contains the waterfall acceptance scenarios.

## Deployment

See `docs/DEPLOYMENT.md`. CI and main-branch deployment workflows are included under `.github/workflows/`. The waterfall-to-code mapping is documented in `docs/IMPLEMENTATION_MATRIX.md`.
