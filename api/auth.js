const json = (res, code, body) => res.status(code).json(body);
const supabaseUrl = () => process.env.SUPABASE_URL?.replace(/\/$/, "");
const headers = () => ({ apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`, "Content-Type": "application/json" });

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  if (!supabaseUrl() || !process.env.SUPABASE_ANON_KEY) return json(res, 503, { error: "Authentication is not configured yet. Add SUPABASE_URL and SUPABASE_ANON_KEY in Vercel." });
  const { action, email, password } = req.body || {};
  if (action === "logout") {
    res.setHeader("Set-Cookie", "claimback_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    return json(res, 200, { ok: true });
  }
  if (!email || !password || password.length < 8) return json(res, 400, { error: "Use a valid email and a password with at least 8 characters." });
  const endpoint = action === "signup" ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password";
  try {
    const response = await fetch(`${supabaseUrl()}${endpoint}`, { method: "POST", headers: headers(), body: JSON.stringify({ email, password }) });
    const data = await response.json();
    if (!response.ok) return json(res, response.status, { error: data.msg || data.error_description || "Could not authenticate." });
    if (action === "signup" && !data.access_token) return json(res, 200, { needsConfirmation: true, message: "Check your email to confirm your account, then sign in." });
    res.setHeader("Set-Cookie", `claimback_session=${data.access_token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${data.expires_in || 3600}`);
    return json(res, 200, { user: { email: data.user?.email || email } });
  } catch { return json(res, 502, { error: "Authentication service is unavailable." }); }
}
