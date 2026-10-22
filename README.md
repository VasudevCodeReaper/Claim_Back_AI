# ClaimBack AI

ClaimBack is an evidence-first return and refund assistant. It extracts receipt facts only after user consent, checks a public policy with TinyFish, and saves a private claim packet. Its newest workflow helps people document and respond to customer-support chatbot friction—such as repeated deflection, vague policy references, or blocked access to a human agent.

## What it does

1. **Receipt evidence:** Gemini proposes visible receipt details. The user reviews and applies any suggestion before it is used.
2. **Public-policy check:** TinyFish reads only the public policy link supplied or approved by the user.
3. **Private claim packet:** The verified receipt, policy summary, and user-approved details are stored privately in Supabase.
4. **Supervised chatbot advocacy:** From a claim timeline, the user supplies the official merchant support-chat URL and an objective. After an explicit approval, TinyFish can hold a factual, limited conversation while the user watches its live preview.
5. **Persistent case memory:** Each completed conversation stores a compact summary, transcript notes, suspected return-friction patterns, and next step. When a TinyFish browser epoch ends, the user can continue in a new run with that memory injected.

## Safety boundaries

- ClaimBack never collects or sends passwords, OTPs, payment-card data, government ID, or facts absent from the approved claim packet.
- It will not buy, cancel, accept a waiver or store credit, book a return, submit a refund, or click a final confirmation.
- The chatbot agent stops when a login, CAPTCHA, sensitive information, payment, or irreversible decision is required.
- Runs are user-initiated and capped at eight chat turns. Press **Esc** or **Stop chat** to cancel an active run.
- “Persistent” means ClaimBack stores the private *case memory*, not that TinyFish keeps an immortal browser. A new run continues from the saved summary. A merchant-specific TinyFish Browser Context Profile can additionally preserve an already-authorized browser login if the user configures one directly in TinyFish.

## Deploy to Vercel

1. Push this repository to GitHub and import it into Vercel.
2. Add the environment variables from `.env.example` in **Settings → Environment Variables**.
3. In Supabase SQL Editor, run these files in order:
   - `supabase/claims_schema.sql`
   - `supabase/secure_receipt_storage.sql`
   - `supabase/roadmap_features.sql`
4. Redeploy the Vercel project.

Required environment variables:

```text
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.8-flash
TINYFISH_API_KEY=...
TINYFISH_AGENT_URL=https://agent.tinyfish.ai/v1/automation/run
TINYFISH_SSE_URL=https://agent.tinyfish.ai/v1/automation/run-sse
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
```

## Architecture

| Component | Role |
| --- | --- |
| `public/index.html` | Consent-first receipt workflow, claim hub, audit timeline, and live supervised-chat interface |
| `api/analyze.js` | Gemini receipt extraction and evidence verification |
| `api/claim.js` | Read-only TinyFish policy check and approved claim-packet creation |
| `api/chat-advocacy.js` | TinyFish live chatbot runs, abort support, durable case-memory updates, and audit logging |
| `api/auth.js`, `api/claims.js`, `api/claim-events.js`, `api/receipts.js` | Supabase-backed authentication, private storage, claims, deletion, and audit history |
| `supabase/roadmap_features.sql` | Audit trail, recovery state, and persistent chatbot-case memory with RLS |

## Test the chatbot workflow

1. Create a verified claim packet.
2. Open it from **Claims Hub**.
3. Paste the merchant’s official support-chat URL and a specific objective.
4. Tick the approval checkbox and choose **Start supervised chat**.
5. Watch TinyFish in the live preview. Stop it with **Esc** if required.
6. Inspect the saved conclusion, next action, and any recorded return-friction patterns.
7. Use **Continue with saved memory** if another short browser run is required.

For a safe, repeatable presentation, deploy first and use this built-in sandbox URL as the support-chat URL:

```text
https://YOUR-CLAIMBACK-DOMAIN/returnmaze-demo.html
```

It is a scripted e-commerce chatbot that models common return-friction behaviours and ends in a human-escalation reference. TinyFish interacts with its real visible chat interface; it does not use a fake API response.

Do not treat a chatbot response as legal advice, a guaranteed refund, or a binding merchant decision.
