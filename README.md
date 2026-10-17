# ClaimBack AI

ClaimBack is a human-in-the-loop claim recovery assistant. A consumer uploads a receipt, explains what went wrong, receives an AI evidence check, then gets a TinyFish review of a public merchant policy before explicitly creating a reviewable claim packet.

## What makes it different

It does not auto-submit on a user's behalf. The product has a hard approval gate before it creates a claim packet, and TinyFish is restricted to reading the supplied public policy page. It never logs in to a merchant portal, contacts support, or submits a refund request.

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
| `public/index.html` | Responsive receipt-upload, evidence-check, and claim-approval interface |
| `api/analyze.js` | Gemini multimodal receipt verification with a safe non-approval fallback |
| `api/claim.js` | Queued TinyFish public-policy check and explicit claim-packet creation |
| `api/auth.js` and `api/me.js` | Supabase-backed account sign-up, sign-in, and protected session |

## Set up real accounts

1. Create a free project at [Supabase](https://supabase.com/dashboard).
2. In Supabase **Authentication → Providers → Email**, keep Email enabled. For a fast demo, turn off **Confirm email**; keep it on for a production project.
3. In Supabase **Project Settings → API**, copy the Project URL into `SUPABASE_URL` and the anon public key into `SUPABASE_ANON_KEY` in Vercel.
4. Redeploy in Vercel.

The app contains no fabricated claim or recovery data. For privacy, the receipt binary is sent only for the verification request and is not saved by the app; only its name and an evidence summary are retained locally in that browser. New claim packets are also local to that browser; production persistence can be added with a Supabase `claims` table and Storage bucket.

## TinyFish rollout

TinyFish is started as a queued run and the UI polls its status, avoiding a serverless timeout while a policy page is inspected. It reads only the public URL supplied by the user. It will not log in, fill a form, or submit anything. For merchant submission later, add tested per-merchant workflows, an allowlist, an audit log, and a final user confirmation screen.

## QA test scenario

`api/demo-policy.js` deliberately serves a fictional public policy for an end-to-end QA run. It is labelled as a test policy and applies only to the ClaimBack sample receipt; do not use it for real claims. After deployment, use `https://YOUR-VERCEL-DOMAIN/api/demo-policy` as the policy URL with the supplied QA receipt, order ID `QA-ORDER-2026-1001`, amount `1299`, and issue `Product arrived damaged`.

## Security notes

- Never expose `GEMINI_API_KEY` or `TINYFISH_API_KEY` to the browser.
- Do not commit `.env.local`.
- The receipt limit is 2.8 MB because browser-to-serverless base64 uploads must remain below Vercel request limits.
- Use encrypted storage and a retention policy before retaining actual invoices or identities.
