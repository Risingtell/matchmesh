/**
 * Browser-facing demo endpoint — the ONE thing on the landing page a human
 * visitor (no wallet, no terminal) can actually click and get a real result
 * from, instead of the site being a read-only dashboard. Pays from the same
 * budget-capped operator wallet the MCP tools use (see mcp/budget-guard.js) —
 * one shared daily cap across both entry points, not two independent risks.
 */
import { createInjectiveClient, parsePaymentResponseHeader } from "@injectivelabs/x402/client";
import { checkBudget, refundBudget } from "../mcp/budget-guard.js";
import { PRICE } from "./index.js";

function buildOperatorClient() {
  return createInjectiveClient({
    privateKey: process.env.MCP_OPERATOR_PRIVATE_KEY,
    rpcUrl: process.env.RPC_URL,
    preferredNetworks: [process.env.NETWORK ?? "eip155:1439"],
  });
}

export function mountDemo(app) {
  const operatorClient = buildOperatorClient();
  const railsUrl = process.env.MATCHMESH_URL || `http://localhost:${process.env.PORT || 4021}`;

  app.post("/demo/ask", async (req, res) => {
    const { question } = req.body || {};
    if (!question || typeof question !== "string" || question.length > 200) {
      return res.status(400).json({ error: "question required (max 200 chars)" });
    }
    const cost = BigInt(PRICE.query);
    let reserved = false;
    try {
      checkBudget(cost);
      reserved = true;
      const payRes = await operatorClient.fetch(`${railsUrl}/api/pay_per_query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const receipt = parsePaymentResponseHeader(payRes);
      const data = await payRes.json();
      if (!payRes.ok) throw new Error(data.error || `pay_per_query failed with ${payRes.status}`);
      res.json({ answer: data.answer, settledTx: receipt?.transaction ?? null, priceUsd: Number(PRICE.query) / 1e6 });
    } catch (err) {
      // Only refund a reservation we actually made — checkBudget() itself
      // throwing (cap already exhausted) never reserved anything.
      if (reserved) refundBudget(cost);
      res.status(502).json({ error: err.message });
    }
  });
}
