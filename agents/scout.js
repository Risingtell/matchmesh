/**
 * Client helper any agent can use to HIRE Scout for structured match data,
 * paying from the caller's own wallet — this is the agent-to-agent commerce leg.
 *
 * Usage as a library: hireScout(team, "STATCASTER_PRIVATE_KEY")
 * Usage as CLI:       node agents/scout.js Mexico
 */
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { createInjectiveClient, parsePaymentResponseHeader } from "@injectivelabs/x402/client";

const SCOUT_URL = process.env.SCOUT_URL || `http://localhost:${process.env.SCOUT_PORT || 4022}`;

export async function hireScout(team, buyerPrivateKeyEnv = "SCOUT_HIRER_PRIVATE_KEY") {
  const privateKey = process.env[buyerPrivateKeyEnv];
  if (!privateKey) throw new Error(`Missing ${buyerPrivateKeyEnv} in .env`);
  const client = createInjectiveClient({ privateKey, rpcUrl: process.env.RPC_URL, preferredNetworks: [process.env.NETWORK ?? "eip155:1439"] });

  const res = await client.fetch(`${SCOUT_URL}/scout/lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ team }),
  });
  if (!res.ok) throw new Error(`scout lookup failed: ${res.status} ${await res.text()}`);
  const receipt = parsePaymentResponseHeader(res);
  const data = await res.json();
  return { ...data, receipt };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const team = process.argv.slice(2).join(" ") || "Mexico";
  hireScout(team, "STATCASTER_PRIVATE_KEY")
    .then(({ matches, receipt }) => {
      console.log(`Scout report for ${team}:`, JSON.stringify(matches, null, 2));
      if (receipt) console.log(`Agent-to-agent payment: ${receipt.transaction}`);
    })
    .catch((err) => {
      console.error("Hiring Scout failed:", err.message);
      process.exitCode = 1;
    });
}
