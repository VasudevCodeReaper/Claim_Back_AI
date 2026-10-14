export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { approved, orderId, platform = "merchant portal", portalUrl } = req.body || {};
  if (!approved) return res.status(400).json({ error: "Explicit user approval is required." });
  if (!process.env.TINYFISH_API_KEY) {
    return res.status(200).json({ status: "ready", runId: `demo_${Date.now()}`, message: `Claim packet ready. Add TINYFISH_API_KEY in Vercel to run the live policy check.` });
  }
  let safeUrl;
  try { safeUrl = new URL(portalUrl); } catch { return res.status(400).json({ error: "Add a valid public policy URL first." }); }
  if (safeUrl.protocol !== "https:") return res.status(400).json({ error: "Use a secure HTTPS policy link." });
  const goal = `Read this public ${platform} policy page. Do not log in, fill forms, contact support, or submit anything. Check eligibility for a refund concerning order ${orderId || "not provided"}. Return JSON only with eligibility_summary, required_evidence, relevant_policy_text, and safe_next_step.`;
  try {
    const response = await fetch(process.env.TINYFISH_AGENT_URL || "https://agent.tinyfish.ai/v1/automation/run", {
      method: "POST",
      headers: { "X-API-Key": process.env.TINYFISH_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ url: safeUrl.href, goal, browser_profile: "lite" })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "TinyFish check failed");
    return res.status(200).json({ status: data.status || "COMPLETED", runId: data.run_id, policyCheck: data.result, message: "Live policy check done. Nothing was submitted." });
  } catch {
    return res.status(502).json({ error: "TinyFish could not complete the policy check. Try again." });
  }
}
