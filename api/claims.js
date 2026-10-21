const tokenFrom = req => (req.headers.cookie || "").match(/(?:^|; )claimback_session=([^;]+)/)?.[1];
const baseUrl = () => process.env.SUPABASE_URL?.replace(/\/$/, "");
const receiptObjectPath = path => String(path || "").split("/").map(encodeURIComponent).join("/");

function configured() {
  return Boolean(baseUrl() && process.env.SUPABASE_ANON_KEY);
}

async function currentUser(req) {
  const token = tokenFrom(req);
  if (!token || !configured()) throw new Error("You need to sign in before viewing claims.");
  const response = await fetch(`${baseUrl()}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error("Your session has expired. Please sign in again.");
  return { token, user: await response.json() };
}

function present(row) {
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
    policyCheckedAt: row.policy_checked_at,
    submittedAt: row.submitted_at,
    recoveredAt: row.recovered_at,
    recoveredAmount: row.recovered_amount,
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    created: new Date(row.created_at).toLocaleDateString("en-IN"),
    createdAt: row.created_at
  };
}

export default async function handler(req, res) {
  if (!configured()) return res.status(503).json({ error: "Claim storage is not configured yet." });

  try {
    const { token } = await currentUser(req);
    const headers = { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` };

    if (req.method === "GET") {
      const response = await fetch(`${baseUrl()}/rest/v1/claims?select=*&order=created_at.desc`, { headers });
      const rows = await response.json();
      if (!response.ok) throw new Error(rows.message || "Could not load your saved claims.");
      return res.status(200).json({ claims: rows.map(present) });
    }

    if (req.method === "DELETE") {
      const claimId = typeof req.query?.claimId === "string" ? req.query.claimId : "";
      if (!claimId) return res.status(400).json({ error: "A claim ID is required." });
      const lookup = await fetch(`${baseUrl()}/rest/v1/claims?claim_id=eq.${encodeURIComponent(claimId)}&select=id,receipt_path`, { headers });
      const rows = await lookup.json();
      if (!lookup.ok) throw new Error(rows.message || "Could not find this claim packet.");
      if (!rows[0]) return res.status(404).json({ error: "Claim packet not found." });

      if (rows[0].receipt_path) {
        const deletedReceipt = await fetch(`${baseUrl()}/storage/v1/object/claimback-receipts/${receiptObjectPath(rows[0].receipt_path)}`, {
          method: "DELETE",
          headers
        });
        if (!deletedReceipt.ok && deletedReceipt.status !== 404) {
          const data = await deletedReceipt.json().catch(() => ({}));
          throw new Error(data.message || "Could not delete the private receipt, so the claim was kept unchanged.");
        }
      }

      const deletedClaim = await fetch(`${baseUrl()}/rest/v1/claims?id=eq.${encodeURIComponent(rows[0].id)}`, {
        method: "DELETE",
        headers: { ...headers, Prefer: "return=minimal" }
      });
      if (!deletedClaim.ok) throw new Error("The receipt was deleted, but the claim packet could not be removed. Please retry.");
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: "GET or DELETE only" });
  } catch (error) {
    return res.status(422).json({ error: error.message });
  }
}
