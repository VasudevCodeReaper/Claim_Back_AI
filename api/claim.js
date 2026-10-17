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

function policyRequest({ portalUrl, ...claim }) {
  let safeUrl;
  try { safeUrl = new URL(portalUrl); } catch { throw new Error("Add a valid public merchant policy URL first."); }
  if (safeUrl.protocol !== "https:") throw new Error("Use an HTTPS public policy link.");
  if (!process.env.TINYFISH_API_KEY) throw new Error("TinyFish is not configured yet. Add TINYFISH_API_KEY in Vercel.");

  return {
    url: safeUrl.href,
    goal: policyGoal(claim),
    browser_profile: "lite",
    agent_config: { max_duration_seconds: 55, max_steps: 18 }
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
    return res.status(200).json({
      status: "created",
      claimId: `CB-${Date.now().toString(36).toUpperCase()}`,
      message: "Your claim packet is created. It has not been sent to the merchant."
    });
  }

  return res.status(400).json({ error: "Unknown claim action." });
}
