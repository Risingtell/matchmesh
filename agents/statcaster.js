/**
 * StatCaster — pay-per-query World Cup analytics agent.
 * Pays $0.001 USDC via x402 for each plain-English answer about the live 2026 tournament.
 *
 * Usage: node agents/statcaster.js "how did Mexico do?"
 */
import { fileURLToPath } from "node:url";
import { makeClient, BASE_URL, withRetry } from "./shared.js";
import { parsePaymentResponseHeader } from "@injectivelabs/x402/client";

const client = makeClient("STATCASTER_PRIVATE_KEY");

export async function ask(question) {
  return withRetry(async () => {
    const res = await client.fetch(`${BASE_URL}/api/pay_per_query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!res.ok) throw new Error(`pay_per_query failed: ${res.status} ${await res.text()}`);
    const receipt = parsePaymentResponseHeader(res);
    const data = await res.json();
    return { ...data, receipt };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const question = process.argv.slice(2).join(" ") || "how did Mexico do?";
  ask(question)
    .then(({ answer, receipt }) => {
      console.log(`Q: ${question}`);
      console.log(`A: ${answer}`);
      if (receipt) console.log(`Paid on-chain: ${receipt.transaction} (${receipt.network})`);
    })
    .catch((err) => {
      console.error("StatCaster failed:", err.message);
      process.exitCode = 1;
    });
}
