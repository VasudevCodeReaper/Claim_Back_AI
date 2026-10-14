const fallback = (order) => ({
  mode: "demo",
  verdict: "Likely eligible",
  confidence: 92,
  amount: order.amount || 349,
  currency: order.currency || "INR",
  category: "Missing item",
  explanation: "The order details indicate a missing paid item. ClaimBack has assembled the evidence and recommends a refund request.",
  evidence: ["Invoice / order reference", "Reported missing item", "Merchant policy check queued"],
  nextAction: "Review and approve a refund request"
});

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const order = req.body || {};
  if (!process.env.GEMINI_API_KEY) return res.status(200).json(fallback(order));
  const prompt = `You are ClaimBack, a consumer-claim assistant. Analyze the transaction below. Return ONLY valid JSON with: verdict, confidence (0-100), amount (number), currency, category, explanation, evidence (string array of 3), nextAction. Never invent a policy or advise fraud. Transaction: ${JSON.stringify(order)}`;
  try {
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: "application/json" } })
    });
    if (!response.ok) throw new Error("LLM request failed");
    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const clean = raw.replace(/^```json\s*|\s*```$/g, "");
    res.status(200).json({ mode: "ai", ...JSON.parse(clean) });
  } catch (error) {
    res.status(200).json({ ...fallback(order), warning: "AI analysis is temporarily unavailable; showing a safe demo assessment." });
  }
}
