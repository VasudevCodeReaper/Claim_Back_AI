export default async function handler(req, res) {
  const token = (req.headers.cookie || "").match(/(?:^|; )claimback_session=([^;]+)/)?.[1];
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  if (!token || !base || !process.env.SUPABASE_ANON_KEY) return res.status(401).json({ user: null });
  try {
    const response = await fetch(`${base}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
    if (!response.ok) return res.status(401).json({ user: null });
    const user = await response.json();
    return res.status(200).json({ user: { email: user.email } });
  } catch { return res.status(401).json({ user: null }); }
}
