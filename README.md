# ClaimBack AI

ClaimBack is an evidence-first return and refund workspace. Gemini extracts visible receipt facts only after consent; TinyFish reads a public policy; Supabase holds a private claim packet and its audit timeline.

The project also includes a **controlled CDP demonstration**. It launches a TinyFish Browser session from a separate worker, uses Playwright locators to chat with ClaimBack's built-in ReturnMaze page, records the return-friction patterns it encounters, and saves a compact conclusion to the claim's private memory.

## Important boundary

The CDP worker is deliberately limited to this project's own `returnmaze-demo.html` page. It cannot be given an arbitrary merchant URL, use credentials, accept an offer, submit a request, or click a final action. This is a safe, repeatable demo of the technical pattern—not a real-world merchant automation product.

## How the controlled demo works

1. A signed-in user opens a verified claim and checks **I approve this controlled demo run**.
2. Vercel verifies the user and claim, then sends only the claim context plus a generated run ID to the private worker.
3. The worker creates a TinyFish Browser session, connects to its `cdp_url` with Playwright, and opens `returnmaze-demo.html`.
4. Gemini reads each live ReturnMaze reply and plans the next allowed message. The worker validates every proposed message against a strict policy before it can use the rendered `#message` field and Send button. If Gemini is temporarily unavailable, a safe deterministic message keeps the demonstration usable.
5. The worker returns a low-bandwidth live CDP screencast plus SSE progress and transcript events, so ClaimBack shows the remote browser while the conversation runs.
6. The user may press **Esc** or **Stop demo**. The worker closes the CDP connection and stores a cancelled result.
7. ClaimBack stores the transcript summary, result, and possible friction patterns in Supabase. No receipt content, login, payment, return label, or refund submission is sent to the demo.

## Deploy

### 1. Deploy ClaimBack to Vercel

Push the repository, import it into Vercel, then configure these variables from `.env.example`:

```text
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.8-flash
TINYFISH_API_KEY=...
TINYFISH_AGENT_URL=https://agent.tinyfish.ai/v1/automation/run
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
ALLOWED_DEMO_ORIGIN=https://YOUR-CLAIMBACK-DOMAIN
AGENT_WORKER_URL=https://YOUR-WORKER-DOMAIN
AGENT_WORKER_SECRET=<long random shared secret>
```

Run the Supabase scripts in this order:

1. `supabase/claims_schema.sql`
2. `supabase/secure_receipt_storage.sql`
3. `supabase/roadmap_features.sql`

### 2. Deploy the CDP worker to Railway or Render

Do **not** deploy `worker/` to Vercel: Vercel functions are short-lived, whereas a CDP connection must remain open for the complete browser run.

1. Create a new Railway service or Render Web Service from this repository.
2. Set its root directory to `worker`.
3. Use build command `npm install` and start command `npm start`.
4. Add the values from `worker/.env.example`:

```text
TINYFISH_API_KEY=<your TinyFish key>
TINYFISH_BROWSER_API_URL=https://api.browser.tinyfish.ai
AGENT_WORKER_SECRET=<the same long random secret used in Vercel>
GEMINI_API_KEY=<the same Gemini key used in Vercel>
GEMINI_MODEL=gemini-3.8-flash
ALLOWED_DEMO_ORIGIN=https://YOUR-CLAIMBACK-DOMAIN
```

5. Copy the public worker URL into Vercel as `AGENT_WORKER_URL`, then redeploy Vercel.
6. Visit `https://YOUR-WORKER-DOMAIN/health`; it should return `{ "ok": true }`.

## Demonstrate it

1. Sign in, create a verified claim packet, then open it in **Claims Hub**.
2. In the timeline, open **Controlled CDP demo**.
3. Read the fixed ReturnMaze URL and objective, approve the run, and select **Start controlled demo**.
4. Watch the status log; if TinyFish supplies a viewer link, the live frame becomes available too.
5. Let it reach the human-escalation reference, then inspect the saved conclusion and private audit trail.

## Project map

| Component | Role |
| --- | --- |
| `public/index.html` | Consent-first claim UI, private timeline, and controlled-demo controls |
| `public/returnmaze-demo.html` | Scripted e-commerce chatbot used exclusively for the demo |
| `api/analyze.js` | Gemini receipt extraction |
| `api/claim.js` | Read-only TinyFish public-policy check and claim creation |
| `api/chat-advocacy.js` | Authenticated Vercel proxy, URL allowlist, SSE relay, auditing, and saved case memory |
| `worker/server.js` | Persistent TinyFish Browser CDP session and safe Playwright-only ReturnMaze interaction |
| `supabase/roadmap_features.sql` | Audit history and persistent case-memory table with RLS |

Never treat output from this project as a guaranteed refund, legal advice, or a merchant decision.
