const tokenFrom = req => (req.headers.cookie || "").match(/(?:^|; )claimback_session=([^;]+)/)?.[1];
const baseUrl = () => process.env.SUPABASE_URL?.replace(/\/$/, "");

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
    receiptCheck: row.receipt_check,
    policyCheck: row.policy_check,
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    created: new Date(row.created_at).toLocaleDateString("en-IN"),
    createdAt: row.created_at
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  if (!configured()) return res.status(503).json({ error: "Claim storage is not configured yet." });

  try {
    const { token } = await currentUser(req);
    const response = await fetch(`${baseUrl()}/rest/v1/claims?select=*&order=created_at.desc`, {
      headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
    });
    const rows = await response.json();
    if (!response.ok) throw new Error(rows.message || "Could not load your saved claims.");
    return res.status(200).json({ claims: rows.map(present) });
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }
}
