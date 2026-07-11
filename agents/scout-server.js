/**
 * Scout — a paid data-lookup microservice with its OWN wallet as payee,
 * economically independent of the main rails treasury. Other agents (e.g.
 * StatCaster) hire Scout for structured match facts and pay it directly —
 * this is the agent-to-agent leg of the mesh, distinct from the fan-facing
 * rails. (Mountable on the same Express app as the rails for deployment
 * simplicity; the separation that matters is the wallet, not the process.)
 */
import express from "express";
import { fileURLToPath } from "node:url";
import { injectivePaymentMiddleware } from "@injectivelabs/x402/middleware";
import "dotenv/config";
import { lookupTeamMatches } from "../server/worldcup.js";

const NETWORK = process.env.NETWORK ?? "eip155:1439";
const USDC = process.env.USDC_ADDRESS;
const SCOUT_KEY = process.env.SCOUT_PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL;

export function mountScout(app) {
  app.use(
    injectivePaymentMiddleware(
      {
        "POST /scout/lookup": {
          description: "Structured World Cup 2026 match facts for a team (scorers, dates, groups) — hired by other agents",
          accepts: [{ network: NETWORK, asset: USDC, amount: "500" }], // $0.0005 per lookup
        },
      },
      { facilitator: { privateKey: SCOUT_KEY, rpcUrl: RPC_URL }, settlementPolicy: "before" }
    )
  );

  app.post("/scout/lookup", async (req, res) => {
    const { team } = req.body || {};
    if (!team) return res.status(400).json({ error: "team required" });
    const matches = await lookupTeamMatches(team);
    res.json({ team, matches, hiredBy: req.x402?.payer || "unknown" });
  });

  app.get("/scout/health", (_req, res) => res.json({ ok: true, role: "scout" }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const PORT = Number(process.env.SCOUT_PORT || 4022);
  const app = express();
  app.use(express.json());
  mountScout(app);
  app.listen(PORT, () => console.log(`Scout listening on :${PORT} (${NETWORK})`));
}
