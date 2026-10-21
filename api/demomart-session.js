const DEMOMART_URL = "https://demomart-india-wc95.vercel.app/";
const tokenFrom = req => (req.headers.cookie || "").match(/(?:^|; )claimback_session=([^;]+)/)?.[1];
const supabaseUrl = () => process.env.SUPABASE_URL?.replace(/\/$/, "");
const agentSseUrl = () => process.env.TINYFISH_SSE_URL || "https://agent.tinyfish.ai/v1/automation/run-sse";
const agentRunsUrl = () => process.env.TINYFISH_AGENT_URL || "https://agent.tinyfish.ai/v1/automation/run";

const clean = (value, max = 1200) => typeof value === "string" ? value.trim().slice(0, max) : "";

async function signedInUser(req) {
  const token = tokenFrom(req);
  if (!token || !supabaseUrl() || !process.env.SUPABASE_ANON_KEY) throw new Error("Sign in and configure Supabase before starting an assisted session.");
  const response = await fetch(`${supabaseUrl()}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error("Your session has expired. Please sign in again.");
  return { token, user: await response.json() };
}

async function claimForUser(claimId, headers) {
  if (!claimId || typeof claimId !== "string") throw new Error("Choose a claim packet first.");
  const response = await fetch(`${supabaseUrl()}/rest/v1/claims?claim_id=eq.${encodeURIComponent(claimId)}&select=*`, { headers });
  const rows = await response.json();
  if (!response.ok) throw new Error(rows.message || "Could not read this claim packet.");
  if (!rows[0]) throw new Error("Claim packet not found.");
  const claim = rows[0];
  if (String(claim.merchant || "").trim().toLowerCase() !== "demomart india" || claim.order_id !== "QA-ORDER-2026-1001") {
    throw new Error("Assisted automation is enabled only for the DemoMart India QA sandbox claim.");
  }
  return claim;
}

async function audit({ claimUuid, userId, token, eventType, eventLabel, detail }) {
  const response = await fetch(`${supabaseUrl()}/rest/v1/claim_events`, {
    method: "POST",
    headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ claim_uuid: claimUuid, user_id: userId, event_type: eventType, event_label: eventLabel, detail })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || "Could not update the private audit trail. Run roadmap_features.sql first.");
  }
}

async function hasRecentReviewedDraft(claimUuid, headers) {
  const query = new URLSearchParams({
    claim_uuid: `eq.${claimUuid}`,
    event_type: "eq.sandbox_draft_ready",
    select: "created_at",
    order: "created_at.desc",
    limit: "1"
  });
  const response = await fetch(`${supabaseUrl()}/rest/v1/claim_events?${query}`, { headers });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error("Could not confirm the reviewed DemoMart draft. Run the latest roadmap_features.sql first.");
  const createdAt = rows?.[0]?.created_at ? new Date(rows[0].created_at).getTime() : 0;
  return Number.isFinite(createdAt) && Date.now() - createdAt < 20 * 60 * 1000;
}

function packetFor(claim) {
  return {
    merchant: "DemoMart India",
    orderId: claim.order_id,
    issue: clean(claim.issue, 200),
    description: clean(claim.problem_details, 1000),
    amount: Number(claim.amount) || 1299,
    evidence: clean((claim.evidence || []).join("; "), 800) || "ClaimBack QA receipt verified."
  };
}

function goalFor(claim, mode) {
  const packet = packetFor(claim);
  const packetText = JSON.stringify(packet);
  const shared = `You are operating ONLY the DemoMart India sandbox at ${DEMOMART_URL}. This is a fictional QA environment, not a real merchant. Use only the documented sandbox route and test IDs. Do not navigate to any other domain. Claim packet: ${packetText}. Go to /refund-request. Verify order ${packet.orderId}, select the exact refund reason, fill the description, amount, and evidence summary. Use the page's normal controls and verify each value on the review page.`;
  if (mode === "prepare") {
    return `${shared} STOP on Step 3, Refund Review. Do NOT check #customer-consent. Do NOT click #submit-refund-request. Return ONLY JSON: {"phase":"review_ready","stopped_before_submission":true,"order_id":"string","reason":"string","amount":number,"review_visible":true}.`;
  }
  return `${shared} This run has explicit user approval to submit ONE sandbox request. On Step 3, check #customer-consent and click #submit-refund-request. Confirm the success route is /requests/REQ-2026-... and the page shows the sandbox confirmation panel. Return ONLY JSON: {"phase":"submitted","sandbox_only":true,"request_id":"string","status":"string","order_id":"string"}.`;
}

function sseEvent(res, event, value) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
}

function parseEventLine(buffer, onEvent) {
  const blocks = buffer.split(/\r?\n\r?\n/);
  const remainder = blocks.pop() || "";
  for (const block of blocks) {
    const data = block.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
    if (!data) continue;
    try { onEvent(JSON.parse(data)); } catch { /* Keep relaying malformed provider text safely. */ }
  }
  return remainder;
}

async function streamRun(req, res, claim, auth, mode) {
  if (!process.env.TINYFISH_API_KEY) throw new Error("Add TINYFISH_API_KEY in Vercel before using DemoMart assisted sessions.");
  const upstream = await fetch(agentSseUrl(), {
    method: "POST",
    headers: { "X-API-Key": process.env.TINYFISH_API_KEY, "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      url: DEMOMART_URL,
      goal: goalFor(claim, mode),
      browser_profile: "lite",
      agent_config: { mode: "strict", cursor_style: "fish", max_steps: 40, max_duration_seconds: 55 },
      capture_config: { screenshots: true, snapshots: true, recording: false, html: false },
      output_schema: mode === "prepare"
        ? { type: "object", properties: { phase: { type: "string" }, stopped_before_submission: { type: "boolean" }, order_id: { type: "string" }, reason: { type: "string" }, amount: { type: "number" }, review_visible: { type: "boolean" } }, required: ["phase", "stopped_before_submission", "review_visible"] }
        : { type: "object", properties: { phase: { type: "string" }, sandbox_only: { type: "boolean" }, request_id: { type: "string" }, status: { type: "string" }, order_id: { type: "string" } }, required: ["phase", "sandbox_only", "request_id", "status"] }
    })
  });
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  if (!upstream.ok || !upstream.body) {
    const body = await upstream.text();
    sseEvent(res, "error", { error: `TinyFish could not start the sandbox run: ${body.slice(0, 500)}` });
    return res.end();
  }

  const decoder = new TextDecoder();
  let pending = "";
  let runId = "";
  let startedLogged = false;
  const headers = { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${auth.token}` };
  const onProviderEvent = event => {
    if (event.run_id) runId = event.run_id;
    if (event.type === "STARTED" && !startedLogged) {
      startedLogged = true;
      audit({ claimUuid: claim.id, userId: auth.user.id, token: auth.token, eventType: "sandbox_run_started", eventLabel: `DemoMart sandbox ${mode} run started.`, detail: { run_id: runId || null, mode, target: DEMOMART_URL, automated_submission: false } }).catch(error => console.error("ClaimBack audit failure", error));
    }
    if (event.type === "COMPLETE") {
      const result = event.result && typeof event.result === "object" ? event.result : {};
      const completed = event.status === "COMPLETED";
      const eventType = event.status === "CANCELLED" ? "sandbox_run_cancelled" : completed && mode === "prepare" ? "sandbox_draft_ready" : completed ? "sandbox_submitted" : "sandbox_run_failed";
      const eventLabel = event.status === "CANCELLED" ? "DemoMart sandbox run was aborted." : completed && mode === "prepare" ? "DemoMart draft is ready for your review." : completed ? "DemoMart sandbox refund request submitted after your confirmation." : "DemoMart sandbox run did not finish.";
      audit({ claimUuid: claim.id, userId: auth.user.id, token: auth.token, eventType, eventLabel, detail: { run_id: runId || event.run_id || null, mode, status: event.status, request_id: clean(result.request_id, 120) || null, provider_result: result } }).catch(error => console.error("ClaimBack audit failure", error));
      if (completed && mode === "submit") {
        fetch(`${supabaseUrl()}/rest/v1/claims?id=eq.${encodeURIComponent(claim.id)}`, { method: "PATCH", headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ status: "DemoMart sandbox submitted", submitted_at: new Date().toISOString() }) }).catch(error => console.error("ClaimBack status failure", error));
      }
    }
  };
  try {
    for await (const chunk of upstream.body) {
      const text = decoder.decode(chunk, { stream: true });
      pending = parseEventLine(pending + text, onProviderEvent);
      res.write(text);
    }
    parseEventLine(pending + decoder.decode(), onProviderEvent);
  } finally {
    res.end();
  }
}

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const { claimId, action, runId, approved } = req.body || {};
    const auth = await signedInUser(req);
    const headers = { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${auth.token}` };
    const claim = await claimForUser(claimId, headers);
    if (action === "prepare") return streamRun(req, res, claim, auth, "prepare");
    if (action === "submit") {
      if (approved !== true) return res.status(400).json({ error: "Your explicit sandbox submission approval is required." });
      if (claim.status === "DemoMart sandbox submitted") return res.status(409).json({ error: "This DemoMart sandbox claim was already submitted." });
      if (!await hasRecentReviewedDraft(claim.id, headers)) {
        return res.status(409).json({ error: "Start a live DemoMart draft, review its Step 3 page, then submit within 20 minutes." });
      }
      return streamRun(req, res, claim, auth, "submit");
    }
    if (action === "abort") {
      if (!runId || typeof runId !== "string") return res.status(400).json({ error: "A TinyFish run ID is required to abort." });
      const response = await fetch(`${agentRunsUrl().replace(/\/automation\/run(?:-async)?$/, "/runs")}/${encodeURIComponent(runId)}`, { method: "DELETE", headers: { "X-API-Key": process.env.TINYFISH_API_KEY } });
      if (!response.ok && response.status !== 404) throw new Error("TinyFish could not abort this sandbox run.");
      await audit({ claimUuid: claim.id, userId: auth.user.id, token: auth.token, eventType: "sandbox_run_cancelled", eventLabel: "You aborted the DemoMart sandbox run.", detail: { run_id: runId, mode: "user_abort" } });
      return res.status(200).json({ cancelled: true });
    }
    return res.status(400).json({ error: "Unknown DemoMart action." });
  } catch (error) {
    return res.status(422).json({ error: error.message || "Could not run DemoMart automation." });
  }
}
