const tokenFrom = req => (req.headers.cookie || "").match(/(?:^|; )claimback_session=([^;]+)/)?.[1];
const baseUrl = () => process.env.SUPABASE_URL?.replace(/\/$/, "");

async function signedInUser(req) {
  const token = tokenFrom(req);
  if (!token || !baseUrl() || !process.env.SUPABASE_ANON_KEY) throw new Error("Sign in and configure Supabase before changing a claim.");
  const response = await fetch(`${baseUrl()}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("Your session has expired. Please sign in again.");
  return { token, user: await response.json() };
}

async function claimForUser(claimId, headers) {
  if (!claimId || typeof claimId !== "string") throw new Error("A claim ID is required.");
  const response = await fetch(`${baseUrl()}/rest/v1/claims?claim_id=eq.${encodeURIComponent(claimId)}&select=*`, { headers });
  const rows = await response.json();
  if (!response.ok) throw new Error(rows.message || "Could not read this claim.");
  if (!rows[0]) throw new Error("Claim packet not found.");
  return rows[0];
}

const clean = (value, max = 600) => typeof value === "string" ? value.trim().slice(0, max) : null;

async function writeEvent({ claimUuid, userId, token, eventType, eventLabel, detail }) {
  const response = await fetch(`${baseUrl()}/rest/v1/claim_events`, {
    method: "POST",
    headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ claim_uuid: claimUuid, user_id: userId, event_type: eventType, event_label: eventLabel, detail })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || "Could not write the claim audit event. Run roadmap_features.sql first.");
  }
}

export default async function handler(req, res) {
  try {
    const { token, user } = await signedInUser(req);
    const headers = { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` };

    if (req.method === "GET") {
      const claim = await claimForUser(req.query?.claimId, headers);
      const response = await fetch(`${baseUrl()}/rest/v1/claim_events?claim_uuid=eq.${encodeURIComponent(claim.id)}&select=event_type,event_label,detail,created_at&order=created_at.asc`, { headers });
      const events = await response.json();
      if (!response.ok) throw new Error(events.message || "Could not load the claim timeline.");
      return res.status(200).json({ events });
    }

    if (req.method === "POST") {
      const { claimId, action, approved, recoveryAmount } = req.body || {};
      if (!approved) return res.status(400).json({ error: "Your explicit confirmation is required." });
      const claim = await claimForUser(claimId, headers);
      const now = new Date().toISOString();
      let patch, eventType, eventLabel, detail;

      if (action === "mark_submitted") {
        if (claim.submitted_at) return res.status(409).json({ error: "This claim is already marked as submitted." });
        patch = { status: "Submitted by you", submitted_at: now };
        eventType = "submission_confirmed";
        eventLabel = "You confirmed that you submitted this claim to the merchant.";
        detail = { submission_method: "user-confirmed", automated_submission: false };
      } else if (action === "mark_recovered") {
        const amount = Number(String(recoveryAmount ?? "").replace(/[₹,\s]/g, ""));
        if (!claim.submitted_at) return res.status(400).json({ error: "Mark the claim as submitted first, after you submit it yourself to the merchant." });
        if (claim.recovered_at) return res.status(409).json({ error: "This claim is already marked as refunded." });
        if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Enter the refund amount you actually received." });
        patch = { status: "Refund received", recovered_at: now, recovered_amount: amount };
        eventType = "refund_received";
        eventLabel = "You recorded a refund as received.";
        detail = { amount, currency: claim.currency || "INR" };
      } else {
        return res.status(400).json({ error: "Unknown claim action." });
      }

      const updated = await fetch(`${baseUrl()}/rest/v1/claims?id=eq.${encodeURIComponent(claim.id)}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify(patch)
      });
      const rows = await updated.json();
      if (!updated.ok || !rows[0]) throw new Error(rows.message || "Could not update this claim.");
      await writeEvent({ claimUuid: claim.id, userId: user.id, token, eventType, eventLabel, detail });
      return res.status(200).json({ claim: rows[0] });
    }

    return res.status(405).json({ error: "GET or POST only" });
  } catch (error) {
    return res.status(422).json({ error: error.message });
  }
}
