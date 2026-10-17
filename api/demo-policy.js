export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DemoMart QA Test Policy</title>
<style>body{font:16px system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 24px;line-height:1.65;color:#17202a}header{padding:20px;border-radius:14px;background:#fff1dd;color:#873b00}h1{line-height:1.15}article{margin-top:30px;padding:26px;border:1px solid #e2e3de;border-radius:16px}strong{color:#5c41d4}</style></head>
<body><header><strong>QA TEST POLICY ONLY</strong><br>This is a fictional policy used solely to test ClaimBack. It is not a merchant policy and cannot be used for a real purchase.</header>
<article><h1>DemoMart India QA Return and Refund Policy</h1><p>This test policy applies only to the fictional receipt titled <strong>"SAMPLE / QA ONLY - NOT A REAL PURCHASE"</strong> from DemoMart India.</p>
<h2>Eligibility</h2><p>A QA claim is eligible when it includes order ID <strong>QA-ORDER-2026-1001</strong>, a receipt marked as a ClaimBack QA test document, and a report that the wireless earbuds arrived damaged, were missing, or were incorrectly charged. The sample invoice date is 17 Oct 2026.</p>
<h2>Time limit</h2><p>Submit the QA test within 30 days of the sample invoice date.</p>
<h2>Required evidence</h2><ul><li>The QA test receipt</li><li>The sample order ID</li><li>A short description of the reported issue</li></ul>
<h2>Safe next step</h2><p>Create a ClaimBack test claim packet for the simulated workflow. Do not contact a merchant and do not submit a real refund request.</p></article></body></html>`);
}
