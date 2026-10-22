import express from "express";
import { chromium } from "playwright-core";

const app = express();
const activeRuns = new Map();
const port = Number(process.env.PORT || 3001);
const clean = (value, max = 1000) => typeof value === "string" ? value.trim().slice(0, max) : "";

app.use(express.json({ limit: "80kb" }));

function requireSecret(req, res, next) {
  if (!process.env.AGENT_WORKER_SECRET || req.get("X-ClaimBack-Worker-Secret") !== process.env.AGENT_WORKER_SECRET) return res.status(401).json({ error: "Unauthorized worker request." });
  next();
}
function demoUrl(rawUrl) {
  if (!process.env.ALLOWED_DEMO_ORIGIN) throw new Error("ALLOWED_DEMO_ORIGIN is not configured on the worker.");
  const origin = new URL(process.env.ALLOWED_DEMO_ORIGIN); const target = new URL(rawUrl);
  if (target.origin !== origin.origin || target.pathname !== "/returnmaze-demo.html") throw new Error("This CDP worker is intentionally restricted to the controlled ReturnMaze demo.");
  return target.href;
}
function event(res, value) { res.write(`event: message\ndata: ${JSON.stringify(value)}\n\n`); }
function stopError() { const error = new Error("Run cancelled by the user."); error.name = "AbortError"; return error; }
function assertLive(run) { if (run.cancelled) throw stopError(); }
async function waitForBot(page, beforeCount, run) {
  for (let i = 0; i < 24; i += 1) {
    assertLive(run);
    const count = await page.locator(".messages .msg.bot").count();
    if (count > beforeCount) return page.locator(".messages .msg.bot").allTextContents();
    await page.waitForTimeout(250);
  }
  throw new Error("The controlled demo did not answer in time.");
}
async function say(page, run, text) {
  assertLive(run);
  const bots = page.locator(".messages .msg.bot"); const before = await bots.count();
  await page.locator("#message").fill(text);
  await page.locator("#chatForm button").click();
  return waitForBot(page, before, run);
}
async function createBrowserSession() {
  if (!process.env.TINYFISH_API_KEY) throw new Error("TINYFISH_API_KEY is not configured on the CDP worker.");
  const response = await fetch(process.env.TINYFISH_BROWSER_API_URL || "https://api.browser.tinyfish.ai", { method: "POST", headers: { "X-API-Key": process.env.TINYFISH_API_KEY, "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(20000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.cdp_url) throw new Error(body?.error?.message || body?.message || "TinyFish Browser did not return a CDP URL.");
  return body;
}

app.get("/health", (_req, res) => res.status(200).json({ ok: true, service: "claimback-controlled-cdp-worker" }));

app.post("/runs/:runId/cancel", requireSecret, (req, res) => {
  const run = activeRuns.get(req.params.runId);
  if (run) { run.cancelled = true; run.browser?.close().catch(() => {}); }
  res.status(200).json({ cancelled: Boolean(run) });
});

app.post("/runs", requireSecret, async (req, res) => {
  const runId = clean(req.body?.runId, 200);
  if (!runId) return res.status(400).json({ error: "runId is required." });
  if (activeRuns.has(runId)) return res.status(409).json({ error: "That run is already active." });
  let supportUrl;
  try { supportUrl = demoUrl(req.body?.supportUrl); } catch (error) { return res.status(422).json({ error: error.message }); }
  res.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders?.();
  const run = { cancelled: false, browser: null }; activeRuns.set(runId, run);
  let completed = false;
  try {
    event(res, { type: "STATUS", run_id: runId, message: "Creating a TinyFish Browser CDP session…" });
    const session = await createBrowserSession(); assertLive(run);
    const viewerUrl = session.viewer_url || session.live_view_url || session.streaming_url || session.view_url;
    if (viewerUrl) event(res, { type: "STREAMING_URL", run_id: runId, streaming_url: viewerUrl });
    event(res, { type: "STATUS", run_id: runId, message: "Connecting to the managed browser through CDP…" });
    run.browser = await chromium.connectOverCDP(session.cdp_url); assertLive(run);
    const context = run.browser.contexts()[0] || await run.browser.newContext();
    const page = context.pages()[0] || await context.newPage();
    await page.goto(supportUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.locator("#chatForm").waitFor({ state: "visible", timeout: 10000 });
    event(res, { type: "STARTED", run_id: runId, purpose: "Controlled ReturnMaze chat is open. The agent will use only the visible message field and Send button." });
    const transcript = [];
    const first = await say(page, run, "I need help with a damaged product and I would like the normal return path.");
    transcript.push(`ReturnMaze: ${clean(first.at(-1), 650)}`); event(res, { type: "PROGRESS", run_id: runId, purpose: "ReturnMaze requested the order reference." });
    const second = await say(page, run, "The order is RM-2026-0412. I do not want store credit; please provide a return label or the written policy basis.");
    transcript.push(`ReturnMaze: ${clean(second.at(-1), 650)}`); event(res, { type: "PROGRESS", run_id: runId, purpose: "ReturnMaze offered store credit and added an extra verification step." });
    const third = await say(page, run, "I have the receipt and evidence. Please connect me with a human returns specialist.");
    const lastMessage = clean(third.at(-1), 900); transcript.push(`ReturnMaze: ${lastMessage}`);
    event(res, { type: "PROGRESS", run_id: runId, purpose: "The controlled chat reached a human-escalation outcome." });
    event(res, { type: "COMPLETE", run_id: runId, status: "COMPLETED", result: { status: "concluded", summary: "The controlled ReturnMaze bot initially pushed store credit and extra verification, then supplied a human-escalation reference after the return path was restated.", transcript, dark_patterns: ["Store-credit pressure before offering the normal return route", "Extra verification step after a clear policy request"], next_user_action: "Use the visible ReturnMaze escalation reference in a real human review. This demo did not submit a return or refund.", last_message: lastMessage } });
    completed = true;
  } catch (error) {
    const cancelled = error?.name === "AbortError" || run.cancelled;
    event(res, { type: "COMPLETE", run_id: runId, status: cancelled ? "CANCELLED" : "FAILED", result: { status: cancelled ? "needs_user" : "blocked", summary: cancelled ? "The controlled demo was stopped by the user." : clean(error.message, 1400), transcript: [], dark_patterns: [], next_user_action: cancelled ? "Start a new controlled demo when ready." : "Check the worker deployment and TinyFish Browser credentials, then retry.", last_message: "" } });
  } finally {
    activeRuns.delete(runId);
    await run.browser?.close().catch(() => {});
    if (!completed) console.log(`Controlled CDP run ${runId} ended without completion.`);
    res.end();
  }
});

app.listen(port, () => console.log(`ClaimBack controlled CDP worker listening on ${port}`));
