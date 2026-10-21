# ClaimBack AI

ClaimBack is a human-in-the-loop claim recovery assistant. A consumer can opt in to let AI extract visible receipt details, review and apply each suggestion, explain what went wrong, then receive an evidence check and TinyFish review of a public merchant policy before explicitly creating a reviewable claim packet.

## What makes it different

For real merchants, it does not auto-submit on a user's behalf. The product has a hard approval gate before it creates a claim packet, and TinyFish is restricted to reading the supplied public policy page. It never logs in to a merchant portal, contacts support, or submits a refund request.

## Consent-first receipt autofill

After choosing a receipt, the user must tick a consent checkbox and select **Extract receipt details with AI**. Gemini proposes only visible merchant, order reference, amount, date, and item/service data. The values remain in a review card until the user selects **Apply suggested details**; all fields can still be edited before the policy check.

Selecting a supported merchant suggests a public policy link. The user must review that suggestion, and can replace it with a different public URL. ClaimBack currently includes suggestions for Amazon India, Flipkart, Zomato, Swiggy, and the clearly-labelled DemoMart QA fixture. Merchant sites can move policies, so the user remains responsible for checking the destination before running the read-only TinyFish check.

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
| `public/index.html` | Responsive receipt-upload, consent-first AI autofill, policy suggestion, evidence-check, and claim-approval interface |
| `api/analyze.js` | Gemini multimodal receipt extraction and verification with a safe non-approval fallback |
| `api/claim.js` | Queued TinyFish public-policy check, policy snapshot, and explicit claim-packet creation |
| `api/auth.js`, `api/me.js`, `api/claims.js`, and `api/claim-events.js` | Supabase-backed account sign-up, sign-in, private claim history, deletion, audit trail, user-confirmed submission, and recovery updates |
| `api/demomart-session.js` | Allowlisted TinyFish live-browser workflow for the DemoMart QA sandbox only; supports a review-only draft, explicit sandbox submission, and user abort |

## Set up real accounts

1. Create a free project at [Supabase](https://supabase.com/dashboard).
2. In Supabase **Authentication → Providers → Email**, keep Email enabled. For a fast demo, turn off **Confirm email**; keep it on for a production project.
3. In Supabase **Project Settings → API**, copy the Project URL into `SUPABASE_URL` and the anon public key into `SUPABASE_ANON_KEY` in Vercel.
4. In **SQL Editor**, run [`supabase/claims_schema.sql`](supabase/claims_schema.sql) once. This creates the private claims table and Row Level Security policies.
5. Run [`supabase/secure_receipt_storage.sql`](supabase/secure_receipt_storage.sql) once. This creates the non-public receipt bucket and user-only Storage policies.
6. Run [`supabase/roadmap_features.sql`](supabase/roadmap_features.sql) once. This adds policy timestamps, the private audit trail, user-confirmed submission/recovery states, and the DemoMart sandbox event types. It is safe to run again after updates.
7. Redeploy in Vercel.

The app contains no fabricated claim or recovery data. Receipt binary data is only saved when a user explicitly saves a verified claim packet. It is stored in a non-public per-user Supabase Storage folder and opened only through a short-lived signed link. Deleting a claim packet deletes its timeline entry and private receipt.

## Guided submission and audit trail

ClaimBack now creates a reviewable submission draft from the user-approved claim packet. The user copies and submits it through the merchant's official channel themselves; ClaimBack never logs in to, contacts, or submits to a merchant. Afterward, the user can mark the claim as submitted and later record an amount actually received. Each event is written to a private per-user audit trail with the receipt-storage, policy-check, and explicit-confirmation events. The saved policy snapshot shows when it was checked and is flagged after 30 days so the user can review the merchant's current terms before acting.

Claims created before these migrations remain available, but they cannot gain a historical receipt object or audit entries retroactively. Create a new QA claim to test the complete new flow.

## TinyFish rollout

TinyFish is started as a queued run and the UI polls its status, avoiding a serverless timeout while a policy page is inspected. It reads only the public URL supplied by the user. It will not log in, fill a form, or submit anything for real merchants.

### Supervised DemoMart sandbox

The deployed DemoMart India site is the one exception: it is an allowlisted fictional QA environment. Open a claim whose merchant is **DemoMart India** and order ID is **QA-ORDER-2026-1001**, then use **Start live DemoMart draft**. ClaimBack opens TinyFish's read-only live browser preview while it fills the sandbox form and stops on Step 3 before the consent checkbox or submit button.

After reviewing the preview, select **Submit reviewed sandbox request** and confirm the browser dialog. ClaimBack verifies that a review-ready draft was created within the previous 20 minutes, then starts a separate isolated TinyFish run that repeats the reviewed packet, checks the sandbox-only consent box, and submits exactly one test request. **Esc** or **Abort session** cancels an active run. Each action and sandbox request reference is stored in the user's private audit trail.

DemoMart currently stores requests in its own browser-local sandbox state and does not expose a tracking API, so ClaimBack can record the submission result but cannot poll a remote merchant status. A production merchant integration needs a documented server-side status API before cross-session tracking should be promised.

## QA test scenario

`api/demo-policy.js` deliberately serves a fictional public policy for an end-to-end QA run. It is labelled as a test policy and applies only to the ClaimBack sample receipt; do not use it for real claims. After deployment, use `https://YOUR-VERCEL-DOMAIN/api/demo-policy` as the policy URL with the supplied QA receipt, order ID `QA-ORDER-2026-1001`, amount `1299`, and issue `Product arrived damaged`.

## Security notes

- Never expose `GEMINI_API_KEY` or `TINYFISH_API_KEY` to the browser.
- Do not commit `.env.local`.
- The receipt limit is 2.8 MB because browser-to-serverless base64 uploads must remain below Vercel request limits.
- Use encrypted storage and a retention policy before retaining actual invoices or identities.
