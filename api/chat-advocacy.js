import { randomUUID } from "node:crypto";

const tokenFrom = req => (req.headers.cookie || "").match(/(?:^|; )claimback_session=([^;]+)/)?.[1];
const supabaseUrl = () => process.env.SUPABASE_URL?.replace(/\/$/, "");
const workerUrl = () => process.env.AGENT_WORKER_URL?.replace(/\/$/, "");
const demoOrigin = () => process.env.ALLOWED_DEMO_ORIGIN?.replace(/\/$/, "");
const clean = (value, max = 1800) => typeof value === "string" ? value.trim().slice(0, max) : "";

async function signedInUser(req) {
  const token = tokenFrom(req);
  if (!token || !supabaseUrl() || !process.env.SUPABASE_ANON_KEY) throw new Error("Sign in and configure Supabase before starting the controlled demo.");
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
  if (!response.ok) throw new Error(rows.message || "Could not load the saved demo memory. Run roadmap_features.sql first.");
  return rows[0] || null;
}

async function saveCase({ claim, auth, headers, supportUrl, objective, memory, status, runId }) {
  const row = { claim_uuid: claim.id, user_id: auth.user.id, support_url: supportUrl, objective: clean(objective, 700), case_memory: memory || {}, status: clean(status, 80) || "ready", last_run_id: clean(runId, 200) || null, updated_at: new Date().toISOString() };
  const response = await fetch(`${supabaseUrl()}/rest/v1/claim_advocacy_cases?on_conflict=claim_uuid`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(row)
  });
  const rows = await response.json();
  if (!response.ok) throw new Error(rows.message || "Could not save private demo memory. Run roadmap_features.sql first.");
  return rows[0] || row;
}

async function audit({ claimUuid, userId, token, eventType, eventLabel, detail }) {
  const response = await fetch(`${supabaseUrl()}/rest/v1/claim_events`, {
    method: "POST", headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ claim_uuid: claimUuid, user_id: userId, event_type: eventType, event_label: eventLabel, detail })
  });
  if (!response.ok) throw new Error("Could not write the private demo audit event. Run roadmap_features.sql first.");
}

function claimMemory(claim, saved, objective) {
  const previous = saved?.case_memory && typeof saved.case_memory === "object" ? saved.case_memory : {};
  return {
    ...previous,
    claim: { merchant: clean(claim.merchant, 160), order_id: clean(claim.order_id, 160), issue: clean(claim.issue, 180), description: clean(claim.problem_details, 1200), amount: claim.amount, currency: claim.currency || "INR", policy_summary: clean(claim.policy_check?.eligibility_summary || claim.policy_check?.safe_next_step, 850) },
    objective: clean(objective || saved?.objective, 700), updated_at: new Date().toISOString()
  };
}

function sseEvent(res, event, value) { res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`); }
function parseResult(result) {
  if (typeof result === "string") { try { return JSON.parse(result.replace(/^```json\s*|\s*```$/g, "")); } catch { return { status: "needs_user", summary: clean(result, 1400), transcript: [], dark_patterns: [], next_user_action: "Review the demo transcript.", last_message: "" }; } }
  return result && typeof result === "object" ? result : { status: "needs_user", summary: "The demo ended without a structured conclusion.", transcript: [], dark_patterns: [], next_user_action: "Review the demo transcript.", last_message: "" };
}
function parseEventLine(buffer, onEvent) {
  const blocks = buffer.split(/\r?\n\r?\n/); const remainder = blocks.pop() || "";
  for (const block of blocks) {
    const data = block.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
    if (!data) continue; try { onEvent(JSON.parse(data)); } catch { /* ignore malformed upstream event */ }
  }
  return remainder;
}

function controlledDemoUrl(rawUrl) {
  if (!demoOrigin()) throw new Error("Set ALLOWED_DEMO_ORIGIN in Vercel before starting the CDP demo.");
  const allowed = new URL(demoOrigin()); const candidate = new URL(rawUrl || `${allowed.origin}/returnmaze-demo.html`);
  if (candidate.origin !== allowed.origin || candidate.pathname !== "/returnmaze-demo.html") throw new Error("This autonomous CDP flow is enabled only for the controlled ReturnMaze demo URL.");
  return candidate.href;
}

async function streamChat(res, { claim, auth, headers, saved, supportUrl, objective }) {
  if (!workerUrl() || !process.env.AGENT_WORKER_SECRET) throw new Error("Deploy the CDP worker and set AGENT_WORKER_URL plus AGENT_WORKER_SECRET in Vercel first.");
  const memory = claimMemory(claim, saved, objective); const runId = randomUUID();
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8"); res.setHeader("Cache-Control", "no-cache, no-transform"); res.setHeader("Connection", "keep-alive"); res.setHeader("X-Accel-Buffering", "no"); res.flushHeaders?.();
  sseEvent(res, "STATUS", { type: "STATUS", run_id: runId, message: "Starting the controlled CDP browser…" });
  let upstream;
  try {
    upstream = await fetch(`${workerUrl()}/runs`, { method: "POST", headers: { "Content-Type": "application/json", "X-ClaimBack-Worker-Secret": process.env.AGENT_WORKER_SECRET, Accept: "text/event-stream" }, signal: AbortSignal.timeout(55000), body: JSON.stringify({ runId, supportUrl, objective: clean(objective, 700), caseMemory: memory }) });
  } catch (error) {
    sseEvent(res, "error", { error: error.name === "TimeoutError" ? "The CDP worker did not respond within 55 seconds. Try again." : `Could not reach the CDP worker: ${error.message}` }); return res.end();
  }
  if (!upstream.ok || !upstream.body) { const body = await upstream.text(); sseEvent(res, "error", { error: `The CDP worker could not start: ${body.slice(0, 500)}` }); return res.end(); }
  let pending = "", started = false; const decoder = new TextDecoder();
  const handle = event => {
    if (event.type === "STARTED" && !started) { started = true; audit({ claimUuid: claim.id, userId: auth.user.id, token: auth.token, eventType: "chat_run_started", eventLabel: "You started the controlled ReturnMaze CDP demonstration.", detail: { run_id: runId, support_url: supportUrl, automated_submission: false, controlled_demo: true } }).catch(console.error); }
    if (event.type === "COMPLETE") {
      const result = parseResult(event.result); const complete = event.status === "COMPLETED";
      const newMemory = { ...memory, conversation: { status: clean(result.status, 80) || (complete ? "needs_user" : "blocked"), summary: clean(result.summary, 1600), transcript: Array.isArray(result.transcript) ? result.transcript.map(item => clean(item, 700)).filter(Boolean).slice(-16) : [], dark_patterns: Array.isArray(result.dark_patterns) ? result.dark_patterns.map(item => clean(item, 280)).filter(Boolean).slice(0, 10) : [], next_user_action: clean(result.next_user_action, 800), last_message: clean(result.last_message, 1000), completed_at: new Date().toISOString(), controlled_demo: true } };
      saveCase({ claim, auth, headers, supportUrl, objective, memory: newMemory, status: complete ? newMemory.conversation.status : "blocked", runId }).catch(console.error);
      const eventType = event.status === "CANCELLED" ? "chat_run_cancelled" : complete && newMemory.conversation.status === "concluded" ? "chat_conclusion" : complete ? "chat_run_completed" : "chat_run_failed";
      audit({ claimUuid: claim.id, userId: auth.user.id, token: auth.token, eventType, eventLabel: event.status === "CANCELLED" ? "You stopped the controlled CDP demonstration." : complete ? "Controlled ReturnMaze demo saved a conclusion for review." : "Controlled ReturnMaze demo did not finish.", detail: { run_id: runId, support_url: supportUrl, status: event.status, controlled_demo: true, conclusion: newMemory.conversation } }).catch(console.error);
    }
  };
  try { for await (const chunk of upstream.body) { const text = decoder.decode(chunk, { stream: true }); pending = parseEventLine(pending + text, handle); res.write(text); } parseEventLine(pending + decoder.decode(), handle); } finally { res.end(); }
}

export const config = { maxDuration: 60 };
export default async function handler(req, res) {
  try {
    const auth = await signedInUser(req); const headers = { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${auth.token}` };
    if (req.method === "GET") { const claim = await claimForUser(req.query?.claimId, headers); return res.status(200).json({ chatCase: await readCase(claim.id, headers) }); }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    const { claimId, action, approved, runId, supportUrl: rawUrl, objective } = req.body || {}; const claim = await claimForUser(claimId, headers);
    if (action === "abort") {
      if (!runId || typeof runId !== "string") return res.status(400).json({ error: "An active demo run ID is required to stop the chat." });
      if (!workerUrl() || !process.env.AGENT_WORKER_SECRET) throw new Error("The CDP worker is not configured.");
      const response = await fetch(`${workerUrl()}/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST", headers: { "X-ClaimBack-Worker-Secret": process.env.AGENT_WORKER_SECRET } });
      if (!response.ok && response.status !== 404) throw new Error("The CDP worker could not stop this run.");
      await audit({ claimUuid: claim.id, userId: auth.user.id, token: auth.token, eventType: "chat_run_cancelled", eventLabel: "You requested that the controlled CDP demo stop.", detail: { run_id: runId, controlled_demo: true } });
      return res.status(200).json({ cancelled: true });
    }
    if (!approved) return res.status(400).json({ error: "Explicit approval is required before starting the controlled demo." });
    const saved = await readCase(claim.id, headers); const supportUrl = controlledDemoUrl(rawUrl);
    await saveCase({ claim, auth, headers, supportUrl, objective, memory: claimMemory(claim, saved, objective), status: "running", runId: null });
    return streamChat(res, { claim, auth, headers, saved, supportUrl, objective });
  } catch (error) { return res.status(422).json({ error: error.message || "Could not run the controlled CDP demo." }); }
}
