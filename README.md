# ClaimBack AI

ClaimBack is a human-in-the-loop claim recovery assistant: it turns a transaction problem into an explainable refund recommendation and a reviewable claim packet.

## What makes it different

It does not auto-submit on a user's behalf. The product has a hard approval gate before any external action. The demo works with no secrets; adding a Gemini key upgrades analysis from the safe deterministic demo assessment to a real AI assessment.

## Deploy to Vercel

1. Push this repository to GitHub.
2. Import it in [Vercel](https://vercel.com/new).
3. Add the variables from `.env.example` in **Settings → Environment Variables**. `GEMINI_API_KEY`, `TINYFISH_API_KEY`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY` are needed for the complete product.
4. Deploy. Vercel serves the frontend and serverless `/api` endpoints.

Or with the CLI:

```bash
npm i -g vercel
vercel --prod
```

## Local development

```bash
npm i -g vercel
cp .env.example .env.local
vercel dev
```

Open `http://localhost:3000`.

## Architecture

| Layer | Role |
| --- | --- |
| `public/index.html` | Responsive, zero-build demo interface |
| `api/analyze.js` | Gemini analysis with an offline-safe fallback |
| `api/claim.js` | Human-approved TinyFish live public-policy check |
| `api/auth.js` and `api/me.js` | Supabase-backed account sign-up, sign-in, and protected session |

## Set up real accounts

1. Create a free project at [Supabase](https://supabase.com/dashboard).
2. In Supabase **Authentication → Providers → Email**, keep Email enabled. For a fast demo, turn off **Confirm email**; keep it on for a production project.
3. In Supabase **Project Settings → API**, copy the Project URL into `SUPABASE_URL` and the anon public key into `SUPABASE_ANON_KEY` in Vercel.
4. Redeploy in Vercel.

The app contains no fabricated claim or recovery data. New claims are generated from the user’s analysis and saved locally in that browser; production persistence can be added with a Supabase `claims` table.

## TinyFish rollout

TinyFish is wired to read a public refund-policy page once the user presses the button. It will not log in, fill a form, or submit anything. For real submission later, add a tested per-merchant workflow, an allowlist, audit log, and one last confirmation screen.

## Security notes

- Never expose `GEMINI_API_KEY` or `TINYFISH_API_KEY` to the browser.
- Do not commit `.env.local`.
- Use encrypted storage and a retention policy before accepting actual invoices or identities.
