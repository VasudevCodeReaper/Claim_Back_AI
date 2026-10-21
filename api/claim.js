function policyGoal({ merchant, issue, orderId, transactionDate }) {
  return `Read this public refund, cancellation, returns, or consumer-redress policy page for ${merchant || "the merchant"}. Do not log in, fill forms, contact support, or submit anything. Determine only whether the page has a policy that may apply to this consumer issue: ${issue || "not specified"}. The order reference is ${orderId || "not visible"}; transaction date is ${transactionDate || "not visible"}. Return ONLY one valid JSON object in this exact shape: {"policy_found":true,"eligible_to_continue":true,"eligibility_summary":"short factual summary","relevant_policy_text":"short supporting text","required_evidence":["item"],"deadline_or_limit":"text or Not stated","safe_next_step":"one safe next step"}. Set eligible_to_continue false if the page excludes the issue, the deadline is clearly missed, or eligibility cannot be determined from the public policy. Quote only the policy text required to support the conclusion.`;
}

function verifiedPolicyResult(raw) {
  let result = raw;
  if (typeof result === "string") {
    try { result = JSON.parse(result.replace(/^```json\s*|\s*```$/g, "")); } catch { throw new Error("TinyFish did not return a readable policy result. Try another public policy page."); }
  }
  if (!result || typeof result !== "object" || typeof result.policy_found !== "boolean" || typeof result.eligible_to_continue !== "boolean") {
    throw new Error("TinyFish did not return a complete policy result. Try another public policy page.");
  }
  return result;
}

function tinyFishUrls() {
  const runUrl = process.env.TINYFISH_AGENT_URL || "https://agent.tinyfish.ai/v1/automation/run";
  const queueUrl = runUrl.replace(/\/run(?:-async)?$/, "/run-async");
  const runsBase = runUrl.replace(/\/v1\/automation\/run(?:-async)?$/, "/v1/runs");
  return { queueUrl, runsBase };
}

const tokenFrom = req => (req.headers.cookie || "").match(/(?:^|; )claimback_session=([^;]+)/)?.[1];
const supabaseUrl = () => process.env.SUPABASE_URL?.replace(/\/$/, "");
const compactText = (value, max = 600) => typeof value === "string" ? value.trim().slice(0, max) : null;
const compactEvidence = value => Array.isArray(value) ? value.filter(item => typeof item === "string").slice(0, 12).map(item => item.slice(0, 500)) : [];

async function signedInUser(req) {
  const token = tokenFrom(req);
  if (!token || !supabaseUrl() || !process.env.SUPABASE_ANON_KEY) {
    throw new Error("Sign in and configure Supabase before saving claim packets.");
  }
  const response = await fetch(`${supabaseUrl()}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error("Your session has expired. Please sign in again.");
  return { token, user: await response.json() };
}

function presentClaim(row) {
  return {
    claimId: row.claim_id,
    status: row.status,
    merchant: row.merchant,
    orderId: row.order_id,
    issue: row.issue,
    problemDetails: row.problem_details,
    amount: row.amount,
    currency: row.currency,
    transactionDate: row.transaction_date,
    portalUrl: row.policy_url,
    receiptName: row.receipt_name,
    receiptPath: row.receipt_path,
    receiptContentType: row.receipt_content_type,
    receiptCheck: row.receipt_check,
    policyCheck: row.policy_check,
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    created: new Date(row.created_at).toLocaleDateString("en-IN"),
    createdAt: row.created_at
  };
}

async function persistClaim(req, input, claimId) {
  const { token, user } = await signedInUser(req);
  const amount = Number(input.amount);
  const record = {
    user_id: user.id,
    claim_id: claimId,
    status: "Claim packet ready",
    merchant: compactText(input.merchant, 160),
    order_id: compactText(input.orderId, 160),
    issue: compactText(input.issue, 160),
    problem_details: compactText(input.problemDetails, 3000),
    amount: Number.isFinite(amount) && amount >= 0 ? amount : null,
    currency: compactText(input.currency, 12) || "INR",
    transaction_date: /^\d{4}-\d{2}-\d{2}$/.test(input.transactionDate || "") ? input.transactionDate : null,
    policy_url: compactText(input.portalUrl, 2000),
    receipt_name: compactText(input.receiptName, 255),
    receipt_path: compactText(input.receiptPath, 600),
    receipt_content_type: compactText(input.receiptContentType, 100),
    receipt_check: compactText(input.receiptCheck, 40),
    policy_check: input.policyCheck && typeof input.policyCheck === "object" ? input.policyCheck : null,
    evidence: compactEvidence(input.evidence)
  };
  const response = await fetch(`${supabaseUrl()}/rest/v1/claims`, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(record)
  });
  const rows = await response.json();
  if (!response.ok || !rows[0]) throw new Error(rows.message || "Could not save your claim packet. Make sure the claims table has been created in Supabase.");
  return presentClaim(rows[0]);
}

function policyRequest({ portalUrl, ...claim }) {
  let safeUrl;
  try { safeUrl = new URL(portalUrl); } catch { throw new Error("Add a valid public merchant policy URL first."); }
  if (safeUrl.protocol !== "https:") throw new Error("Use an HTTPS public policy link.");
  if (!process.env.TINYFISH_API_KEY) throw new Error("TinyFish is not configured yet. Add TINYFISH_API_KEY in Vercel.");

  return {
    url: safeUrl.href,
    goal: policyGoal(claim),
    browser_profile: "lite",
    // `max_steps` is a TinyFish beta-only option. Keep the ordinary time bound
    // so all TinyFish accounts can run this read-only policy check.
    agent_config: { max_duration_seconds: 55 }
  };
}

async function queueTinyFish(claim) {
  const { queueUrl } = tinyFishUrls();
  const response = await fetch(queueUrl, {
    method: "POST",
    headers: { "X-API-Key": process.env.TINYFISH_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(policyRequest(claim))
  });
  const data = await response.json();
  if (!response.ok || !data.run_id) throw new Error(data.error?.message || data.error || "TinyFish could not start the policy check.");
  return data.run_id;
}

async function getTinyFishRun(runId) {
  if (!runId || typeof runId !== "string") throw new Error("A valid TinyFish run ID is required.");
  const { runsBase } = tinyFishUrls();
  const response = await fetch(`${runsBase}/${encodeURIComponent(runId)}`, {
    headers: { "X-API-Key": process.env.TINYFISH_API_KEY }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || data.error || "TinyFish could not read that policy page.");
  if (["FAILED", "CANCELLED"].includes(data.status)) throw new Error(data.error?.message || "TinyFish could not complete the policy check.");
  const finished = data.status === "COMPLETED";
  return { status: data.status || "PENDING", runId: data.run_id || runId, policyCheck: finished ? verifiedPolicyResult(data.result) : null };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { action, approved, ...claim } = req.body || {};

  if (action === "policy_check") {
    try {
      const runId = await queueTinyFish(claim);
      return res.status(202).json({ status: "PENDING", runId, message: "TinyFish is reading the public policy. Nothing was submitted." });
    } catch (error) {
      return res.status(422).json({ error: error.message });
    }
  }

  if (action === "policy_status") {
    try {
      const result = await getTinyFishRun(claim.runId);
      return res.status(200).json(result);
    } catch (error) {
      return res.status(422).json({ error: error.message });
    }
  }

  if (action === "create_claim") {
    if (!approved) return res.status(400).json({ error: "Explicit approval is required to create a claim." });
    if (claim.receiptCheck !== "verified" || !claim.eligibleToProceed || !claim.policyEligible) {
      return res.status(400).json({ error: "Verified receipt evidence and a matching public policy check are required before creating a claim." });
    }
    try {
      const claimId = `CB-${Date.now().toString(36).toUpperCase()}`;
      const savedClaim = await persistClaim(req, claim.claim || {}, claimId);
      return res.status(200).json({
        status: "created",
        claimId,
        claim: savedClaim,
        message: "Your claim packet is saved securely to your account. It has not been sent to the merchant."
      });
    } catch (error) {
      return res.status(422).json({ error: error.message });
    }
  }

  return res.status(400).json({ error: "Unknown claim action." });
}
