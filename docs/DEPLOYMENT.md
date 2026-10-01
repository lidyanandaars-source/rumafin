# Deployment

## 1. Supabase

Create separate Development, Staging, and Production projects. For Production:

```bash
npx supabase login
npx supabase link --project-ref "$SUPABASE_PROJECT_REF"
npx supabase db push
npx supabase functions deploy voice-transcribe
npx supabase functions deploy voice-interpret
npx supabase functions deploy receipt-extract
npx supabase functions deploy ai-categorize
npx supabase functions deploy transaction-command-preview
npx supabase functions deploy transaction-command-commit
npx supabase functions deploy financial-query
npx supabase functions deploy invite-member
```

Set Edge Function secrets using `supabase secrets set`. Authentication uses Supabase email/password and magic link; Google OAuth is not required.

## 2. Cloudflare

Set build-time variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Then:

```bash
npm run deploy
```

`wrangler.jsonc` uses Workers Static Assets with SPA fallback so React Router paths resolve correctly.

## 3. GitHub Secrets

For automated main-branch deployment configure:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_DB_PASSWORD`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

AI keys stay in Supabase secrets, not GitHub build variables for the frontend.
