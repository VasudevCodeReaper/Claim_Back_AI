const BUCKET = "claimback-receipts";
const MAX_RECEIPT_SIZE = 2_800_000;
const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const tokenFrom = req => (req.headers.cookie || "").match(/(?:^|; )claimback_session=([^;]+)/)?.[1];
const baseUrl = () => process.env.SUPABASE_URL?.replace(/\/$/, "");

async function signedInUser(req) {
  const token = tokenFrom(req);
  if (!token || !baseUrl() || !process.env.SUPABASE_ANON_KEY) throw new Error("Sign in and configure Supabase before storing a receipt.");
  const response = await fetch(`${baseUrl()}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error("Your session has expired. Please sign in again.");
  return { token, user: await response.json() };
}

function objectPath(path) {
  return String(path || "").split("/").map(encodeURIComponent).join("/");
}

function safeFileName(name) {
  const cleaned = String(name || "receipt").replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(-120);
  return cleaned || "receipt";
}

function bytesFrom(receipt) {
  if (!receipt?.dataUrl || !SUPPORTED_TYPES.has(receipt.type)) throw new Error("Upload a JPEG, PNG, WEBP, or PDF receipt first.");
  const match = receipt.dataUrl.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[1] !== receipt.type) throw new Error("The receipt file could not be read. Upload it again.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_RECEIPT_SIZE || Number(receipt.size) > MAX_RECEIPT_SIZE) {
    throw new Error("Keep the receipt below 2.8 MB.");
  }
  return bytes;
}

function verifyOwner(path, userId) {
  if (!path || !String(path).startsWith(`${userId}/`)) throw new Error("You do not have access to that receipt.");
}

export default async function handler(req, res) {
  if (!baseUrl() || !process.env.SUPABASE_ANON_KEY) return res.status(503).json({ error: "Receipt storage is not configured yet." });
  try {
    const { token, user } = await signedInUser(req);

    if (req.method === "POST") {
      const receipt = req.body?.receipt;
      const bytes = bytesFrom(receipt);
      const path = `${user.id}/${Date.now().toString(36)}-${crypto.randomUUID()}-${safeFileName(receipt.name)}`;
      const response = await fetch(`${baseUrl()}/storage/v1/object/${BUCKET}/${objectPath(path)}`, {
        method: "POST",
        headers: {
          apikey: process.env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          "Content-Type": receipt.type,
          "x-upsert": "false"
        },
        body: bytes
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not securely store this receipt.");
      return res.status(201).json({ path, name: receipt.name, type: receipt.type, message: "Receipt stored privately with your claim packet." });
    }

    if (req.method === "GET") {
      const path = req.query?.path;
      verifyOwner(path, user.id);
      const response = await fetch(`${baseUrl()}/storage/v1/object/sign/${BUCKET}/${objectPath(path)}`, {
        method: "POST",
        headers: {
          apikey: process.env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ expiresIn: 60 })
      });
      const data = await response.json();
      if (!response.ok || !data.signedURL) throw new Error(data.message || "Could not open this stored receipt.");
      return res.status(200).json({ url: new URL(data.signedURL, baseUrl()).href, expiresInSeconds: 60 });
    }

    if (req.method === "DELETE") {
      const path = req.query?.path;
      verifyOwner(path, user.id);
      const response = await fetch(`${baseUrl()}/storage/v1/object/${BUCKET}/${objectPath(path)}`, {
        method: "DELETE",
        headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
      });
      if (!response.ok && response.status !== 404) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Could not remove the private receipt.");
      }
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: "GET, POST, or DELETE only" });
  } catch (error) {
    return res.status(422).json({ error: error.message });
  }
}
