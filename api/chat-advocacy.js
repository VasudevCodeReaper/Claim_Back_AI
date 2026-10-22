const tokenFrom = req => (req.headers.cookie || "").match(/(?:^|; )claimback_session=([^;]+)/)?.[1];
const supabaseUrl = () => process.env.SUPABASE_URL?.replace(/\/$/, "");
const agentSseUrl = () => process.env.TINYFISH_SSE_URL || "https://agent.tinyfish.ai/v1/automation/run-sse";
const agentRunsUrl = () => process.env.TINYFISH_AGENT_URL || "https://agent.tinyfish.ai/v1/automation/run";
const clean = (value, max = 1800) => typeof value === "string" ? value.trim().slice(0, max) : "";

async function signedInUser(req) {
  const token = tokenFrom(req);
  if (!token || !supabaseUrl() || !process.env.SUPABASE_ANON_KEY) throw new Error("Sign in and configure Supabase before starting an advocacy chat.");
  const response = await fetch(`${supabaseUrl()}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("Your session has expired. Please sign in again.");
  return { token, user: await response.json() };
}

async function claimForUser(claimId, headers) {
  if (!claimId || typeof claimId !== "string") throw new Error("Choose a claim packet first.");
  const response = await fetch(`${supabaseUrl()}/rest/v1/claims?claim_id=eq.${encodeURIComponent(claimId)}&select=*`, { headers });
  const rows = await response.json();
  if (!response.ok) throw new Error(rows.message || "Could not read this claim packet.");
  if (!rows[0]) throw new Error("Claim packet not found.");
  return rows[0];
}

async function readCase(claimUuid, headers) {
  const response = await fetch(`${supabaseUrl()}/rest/v1/claim_advocacy_cases?claim_uuid=eq.${encodeURIComponent(claimUuid)}&select=*&limit=1`, { headers });
  const rows = await response.json();
  if (!response.ok) throw new Error(rows.message || "Could not load the saved chat memory. Run the latest roadmap_features.sql first.");
  return rows[0] || null;
}

async function saveCase({ claim, auth, headers, supportUrl, objective, memory, status, runId }) {
  const row = {
    claim_uuid: claim.id,
    user_id: auth.user.id,
    support_url: supportUrl,
    objective: clean(objective, 700),
    case_memory: memory || {},
    status: clean(status, 80) || "ready",
    last_run_id: clean(runId, 200) || null,
    updated_at: new Date().toISOString()
  };
  const response = await fetch(`${supabaseUrl()}/rest/v1/claim_advocacy_cases?on_conflict=claim_uuid`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row)
  });
  const rows = await response.json();
  if (!response.ok) throw new Error(rows.message || "Could not save the private chat memory. Run the latest roadmap_features.sql first.");
  return rows[0] || row;
}

async function audit({ claimUuid, userId, token, eventType, eventLabel, detail }) {
  const response = await fetch(`${supabaseUrl()}/rest/v1/claim_events`, {
    method: "POST",
    headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ claim_uuid: claimUuid, user_id: userId, event_type: eventType, event_label: eventLabel, detail })
  });
  if (!response.ok) throw new Error("Could not write the private chat audit event. Run the latest roadmap_features.sql first.");
}

function claimMemory(claim, saved) {
  const previous = saved?.case_memory && typeof saved.case_memory === "object" ? saved.case_memory : {};
  return {
    ...previous,
    claim: {
      merchant: clean(claim.merchant, 160), order_id: clean(claim.order_id, 160), issue: clean(claim.issue, 180),
      description: clean(claim.problem_details, 1200), amount: claim.amount, currency: claim.currency || "INR",
      policy_summary: clean(claim.policy_check?.eligibility_summary || claim.policy_check?.safe_next_step, 850)
    },
    objective: clean(saved?.objective, 700),
    updated_at: new Date().toISOString()
  };
}

function goalFor({ memory, supportUrl }) {
  return `You are a consumer-support advocacy assistant acting only on a user's explicit request. Open ${supportUrl} and use only that merchant's existing customer-support chat experience. Persistent case memory, supplied by the user-controlled ClaimBack record: ${JSON.stringify(memory)}.

Your task is to continue a calm, factual return/refund conversation until the chatbot gives a clear next step, offers a human escalation, or cannot proceed. You may send short factual messages based only on the case memory. If the bot tries to delay, deflect, repeatedly restate a policy, hide escalation, demand irrelevant information, or creates excessive steps, record it as a possible return-friction pattern. Ask once for the written policy basis and a human-support escalation when appropriate.

Hard boundaries: never enter passwords, one-time codes, payment details, government ID, or any fact not present in the memory; never agree to a paid plan, store credit, waiver, contract, cancellation, return shipment, refund, purchase, or final confirmation; never threaten, impersonate, bypass a safety control, or navigate to an unrelated site. Stop immediately if a user decision, sensitive information, login, CAPTCHA, payment, or final confirmation is required. Work for at most 8 chat turns in this run.

Return ONLY JSON: {"status":"concluded|needs_user|blocked","summary":"factual short summary","transcript":["short turn summaries"],"dark_patterns":["possible friction pattern"],"next_user_action":"what the user should do next","last_message":"latest merchant message"}.`;
}

function sseEvent(res, event, value) { res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`); }

function parseResult(result) {
  if (typeof result === "string") { try { return JSON.parse(result.replace(/^```json\s*|\s*```$/g, "")); } catch { return { status: "needs_user", summary: clean(result, 1400), transcript: [], dark_patterns: [], next_user_action: "Review the live chat before continuing.", last_message: "" }; } }
  return result && typeof result === "object" ? result : { status: "needs_user", summary: "The chat ended without a structured conclusion.", transcript: [], dark_patterns: [], next_user_action: "Review the live chat before continuing.", last_message: "" };
}

function parseEventLine(buffer, onEvent) {
  const blocks = buffer.split(/\r?\n\r?\n/); const remainder = blocks.pop() || "";
  for (const block of blocks) {
    const data = block.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
    if (!data) continue; try { onEvent(JSON.parse(data)); } catch { /* relay provider event even if it has no JSON payload */ }
  }
  return remainder;
}

async function streamChat(res, { claim, auth, headers, saved, supportUrl, objective }) {
  if (!process.env.TINYFISH_API_KEY) throw new Error("Add TINYFISH_API_KEY in Vercel before starting an advocacy chat.");
  const memory = claimMemory(claim, { ...saved, objective });
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8"); res.setHeader("Cache-Control", "no-cache, no-transform"); res.setHeader("Connection", "keep-alive"); res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  sseEvent(res, "STATUS", { type: "STATUS", message: "Connecting to TinyFish live browser…" });
  let upstream;
  try {
    upstream = await fetch(agentSseUrl(), {
      method: "POST",
      headers: { "X-API-Key": process.env.TINYFISH_API_KEY, "Content-Type": "application/json", Accept: "text/event-stream" },
      signal: AbortSignal.timeout(50000),
      body: JSON.stringify({
        url: supportUrl,
        goal: goalFor({ memory, supportUrl }),
        browser_profile: "lite",
        agent_config: { mode: "strict", cursor_style: "fish", max_duration_seconds: 55 },
        capture_config: { screenshots: true, snapshots: true, recording: false, html: false },
        output_schema: { type: "object", properties: { status: { type: "string" }, summary: { type: "string" }, transcript: { type: "array", items: { type: "string" } }, dark_patterns: { type: "array", items: { type: "string" } }, next_user_action: { type: "string" }, last_message: { type: "string" } }, required: ["status", "summary", "next_user_action"] }
      })
    });
  } catch (error) {
    sseEvent(res, "error", { error: error.name === "TimeoutError" ? "TinyFish did not open a live browser within 50 seconds. Try again in a moment." : `TinyFish connection failed: ${error.message}` });
    return res.end();
  }
  if (!upstream.ok || !upstream.body) { const body = await upstream.text(); sseEvent(res, "error", { error: `TinyFish could not start the chat: ${body.slice(0, 500)}` }); return res.end(); }

  let pending = "", runId = "", started = false; const decoder = new TextDecoder();
  const handle = event => {
    if (event.run_id) runId = event.run_id;
    if (event.type === "STARTED" && !started) { started = true; audit({ claimUuid: claim.id, userId: auth.user.id, token: auth.token, eventType: "chat_run_started", eventLabel: "You started a supervised merchant-chat session.", detail: { run_id: runId || null, support_url: supportUrl, automated_submission: false } }).catch(console.error); }
    if (event.type === "COMPLETE") {
      const result = parseResult(event.result); const complete = event.status === "COMPLETED";
      const newMemory = { ...memory, conversation: { status: clean(result.status, 80) || (complete ? "needs_user" : "blocked"), summary: clean(result.summary, 1600), transcript: Array.isArray(result.transcript) ? result.transcript.map(item => clean(item, 700)).filter(Boolean).slice(-12) : [], dark_patterns: Array.isArray(result.dark_patterns) ? result.dark_patterns.map(item => clean(item, 280)).filter(Boolean).slice(0, 10) : [], next_user_action: clean(result.next_user_action, 800), last_message: clean(result.last_message, 1000), completed_at: new Date().toISOString() } };
      saveCase({ claim, auth, headers, supportUrl, objective, memory: newMemory, status: complete ? newMemory.conversation.status : "blocked", runId: runId || event.run_id }).catch(console.error);
      const eventType = event.status === "CANCELLED" ? "chat_run_cancelled" : complete && newMemory.conversation.status === "concluded" ? "chat_conclusion" : complete ? "chat_run_completed" : "chat_run_failed";
      const eventLabel = event.status === "CANCELLED" ? "Merchant-chat session was stopped by you." : complete && newMemory.conversation.status === "concluded" ? "Merchant chat reached a recorded conclusion for your review." : complete ? "Merchant-chat session paused with a saved next step." : "Merchant-chat session did not finish.";
      audit({ claimUuid: claim.id, userId: auth.user.id, token: auth.token, eventType, eventLabel, detail: { run_id: runId || event.run_id || null, support_url: supportUrl, status: event.status, conclusion: newMemory.conversation } }).catch(console.error);
    }
  };
  try { for await (const chunk of upstream.body) { const text = decoder.decode(chunk, { stream: true }); pending = parseEventLine(pending + text, handle); res.write(text); } parseEventLine(pending + decoder.decode(), handle); } finally { res.end(); }
}

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  try {
    const auth = await signedInUser(req); const headers = { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${auth.token}` };
    if (req.method === "GET") {
      const claim = await claimForUser(req.query?.claimId, headers); const saved = await readCase(claim.id, headers);
      return res.status(200).json({ chatCase: saved });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    const { claimId, action, approved, runId, supportUrl: rawUrl, objective } = req.body || {}; const claim = await claimForUser(claimId, headers);
    if (action === "abort") {
      if (!runId || typeof runId !== "string") return res.status(400).json({ error: "A TinyFish run ID is required to stop a chat." });
      const response = await fetch(`${agentRunsUrl().replace(/\/automation\/run(?:-async)?$/, "/runs")}/${encodeURIComponent(runId)}`, { method: "DELETE", headers: { "X-API-Key": process.env.TINYFISH_API_KEY } });
      if (!response.ok && response.status !== 404) throw new Error("TinyFish could not stop this chat session.");
      await audit({ claimUuid: claim.id, userId: auth.user.id, token: auth.token, eventType: "chat_run_cancelled", eventLabel: "You stopped the active merchant-chat session.", detail: { run_id: runId } });
      return res.status(200).json({ cancelled: true });
    }
    if (!approved) return res.status(400).json({ error: "Explicit approval is required before ClaimBack can send messages to a merchant chatbot." });
    const saved = await readCase(claim.id, headers);
    let supportUrl = rawUrl || saved?.support_url;
    try { supportUrl = new URL(supportUrl); } catch { return res.status(400).json({ error: "Add the HTTPS link to the merchant's official support chat first." }); }
    if (supportUrl.protocol !== "https:") return res.status(400).json({ error: "Use an HTTPS merchant-support link." });
    await saveCase({ claim, auth, headers, supportUrl: supportUrl.href, objective, memory: claimMemory(claim, saved), status: "running", runId: null });
    return streamChat(res, { claim, auth, headers, saved, supportUrl: supportUrl.href, objective });
  } catch (error) { return res.status(422).json({ error: error.message || "Could not run the advocacy chat." }); }
}
