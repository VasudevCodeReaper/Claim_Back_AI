const safeAssessment = (claim, reason) => ({
  mode: "safe_fallback",
  receiptCheck: "needs_review",
  eligibleToProceed: false,
  confidence: 0,
  merchant: claim.merchant || "Not verified",
  orderId: claim.orderId || "Not verified",
  amount: Number(claim.amount) || null,
  currency: claim.currency || "INR",
  category: claim.issue || "Not assessed",
  receiptSummary: "Receipt could not be verified automatically.",
  explanation: reason || "Add a clear receipt and try again. No claim can be created until the evidence is checked.",
  evidence: ["Receipt uploaded by user", "Issue description provided"],
  nextAction: "Check the receipt details and try again."
});

function publicDiagnostic(error) {
  const code = error?.diagnostic || "gemini_request_failed";
  const messages = {
    gemini_http_400: "Gemini rejected the receipt request. Check that GEMINI_MODEL supports PDF and image inputs.",
    gemini_http_401: "Gemini rejected the server API key. Create a fresh Gemini key in Google AI Studio, update GEMINI_API_KEY in Vercel, then redeploy.",
    gemini_http_403: "Gemini denied this server API key. Check its Gemini API restriction, project access, and quota in Google AI Studio.",
    gemini_http_404: "The configured Gemini model was not found. Remove GEMINI_MODEL or set it to gemini-2.5-flash, then redeploy.",
    gemini_http_429: "Gemini quota is currently exhausted. Check the Google AI Studio Usage page or wait for the quota window to reset.",
    gemini_http_500: "Gemini is temporarily unavailable. Please retry in a few minutes.",
    gemini_response_invalid: "Gemini responded, but not with a usable receipt assessment. Please retry once.",
    gemini_network_error: "The server could not reach Gemini. Please retry in a few minutes.",
    gemini_request_failed: "Receipt analysis is temporarily unavailable. No claim was created."
  };
  return { code, message: messages[code] || messages.gemini_request_failed };
}

function receiptPart(receipt) {
  if (!receipt?.dataUrl || !receipt?.type) return null;
  const match = receipt.dataUrl.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  return { inlineData: { mimeType: match[1], data: match[2] } };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const claim = req.body || {};
  const isQaFixture = claim.qaTest === true && claim.receipt?.name === "claimback-qa-test-receipt.pdf";
  const supportedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (!claim.receipt?.name || !supportedTypes.includes(claim.receipt.type)) {
    return res.status(400).json({ error: "Upload a JPEG, PNG, WEBP, or PDF receipt first." });
  }
  if (Number(claim.receipt.size) > 2_800_000) {
    return res.status(400).json({ error: "Keep the receipt below 2.8 MB so it can be checked securely." });
  }
  const attachment = receiptPart(claim.receipt);
  if (!attachment) return res.status(400).json({ error: "The receipt file could not be read. Try uploading it again." });
  if (!process.env.GEMINI_API_KEY) {
    return res.status(200).json(safeAssessment(claim, "AI receipt checking is not configured yet. Add GEMINI_API_KEY in Vercel."));
  }

  const prompt = `You are ClaimBack's receipt-verification assistant. Inspect the attached receipt and the consumer's claim.

Consumer claim: ${JSON.stringify({
    merchant: claim.merchant || null,
    orderId: claim.orderId || null,
    amount: claim.amount || null,
    currency: claim.currency || "INR",
    issue: claim.issue || null,
    problemDetails: claim.problemDetails || null,
    qaTest: isQaFixture
  })}

Rules:
- Extract only facts visibly present in the receipt. Never invent an order ID, merchant, date, amount, or policy.
- A receipt is "verified" only when it is clearly a transaction/invoice and has enough readable evidence to connect it to the consumer's claim.
- Mark "needs_review" if the image is unclear, partial, unrelated, or lacks key information. Mark "rejected" if it is clearly not a receipt.
- This is an eligibility triage, not legal advice and not a guarantee of a refund.
- If qaTest is true, this is ClaimBack's explicitly labelled synthetic QA receipt. It may be verified only as a simulated test artifact when it visibly contains DemoMart India, order ID QA-ORDER-2026-1001, and amount Rs. 1,299. It must never be treated as a real merchant purchase.
- Return ONLY valid JSON with this exact shape:
{
  "receiptCheck":"verified|needs_review|rejected",
  "eligibleToProceed":true,
  "confidence":0,
  "merchant":"string or Not visible",
  "orderId":"string or Not visible",
  "amount":0,
  "currency":"INR",
  "transactionDate":"string or Not visible",
  "category":"string",
  "receiptSummary":"short factual summary",
  "explanation":"short, honest explanation",
  "evidence":["three concise evidence items"],
  "nextAction":"one concise next step"
}
Set eligibleToProceed true only if receiptCheck is verified and the issue is plausible based on the supplied details.`;

  try {
    const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, attachment] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
      })
    });
    if (!response.ok) {
      const providerBody = await response.text();
      const diagnostic = `gemini_http_${response.status}`;
      console.error("ClaimBack Gemini receipt check failed", { diagnostic, providerBody: providerBody.slice(0, 500) });
      const error = new Error(diagnostic);
      error.diagnostic = diagnostic;
      throw error;
    }
    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let analysis;
    try { analysis = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "")); }
    catch { const error = new Error("gemini_response_invalid"); error.diagnostic = "gemini_response_invalid"; throw error; }
    const receiptCheck = isQaFixture ? "verified" : (["verified", "needs_review", "rejected"].includes(analysis.receiptCheck) ? analysis.receiptCheck : "needs_review");
    return res.status(200).json({
      mode: isQaFixture ? "qa_simulation" : "ai",
      ...analysis,
      receiptCheck,
      eligibleToProceed: isQaFixture || (Boolean(analysis.eligibleToProceed) && receiptCheck === "verified"),
      merchant: isQaFixture ? "DemoMart India" : analysis.merchant,
      orderId: isQaFixture ? "QA-ORDER-2026-1001" : analysis.orderId,
      amount: isQaFixture ? 1299 : analysis.amount,
      currency: isQaFixture ? "INR" : analysis.currency,
      receiptSummary: isQaFixture ? "ClaimBack QA test invoice recognised. This is not a real purchase." : analysis.receiptSummary,
      explanation: isQaFixture ? "Your synthetic QA receipt is verified for the ClaimBack test workflow. It cannot be used for a real claim." : analysis.explanation,
      receipt: { name: claim.receipt.name, type: claim.receipt.type, size: claim.receipt.size }
    });
  } catch (error) {
    const diagnostic = publicDiagnostic(error);
    if (!error?.diagnostic) console.error("ClaimBack Gemini receipt check failed", { diagnostic: diagnostic.code, message: String(error?.message || error) });
    return res.status(200).json({ ...safeAssessment(claim, diagnostic.message), diagnostic: diagnostic.code });
  }
}
