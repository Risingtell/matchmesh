import express from "express";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { injectivePaymentMiddleware } from "@injectivelabs/x402/middleware";
import { config } from "./config.js";
import { store } from "./store.js";
import { answerQuestion, getGames } from "./worldcup.js";
import { payoutUsdc } from "./chain.js";

export const PRICE = {
  query: "1000",   // $0.001 — pay_per_query
  tip: "50000",    // $0.05  — send_tip
  pool: "100000",  // $0.10  — join_pool
  pass: "200000",  // $0.20  — buy_pass
};

function payerOf(req) {
  // x402 middleware attaches the verified payer address to the request.
  return req.x402?.payer || req.headers["x-payer-hint"] || "unknown";
}

/** Mounts the MatchMesh rails (paid + public routes) onto an existing Express app. */
export function mountRails(app) {
  app.use(
    injectivePaymentMiddleware(
      {
        "POST /api/pay_per_query": {
          description: "Ask a plain-English question about a live 2026 World Cup match",
          accepts: [{ network: config.network, asset: config.usdcAddress, amount: PRICE.query }],
        },
        "POST /api/send_tip": {
          description: "Send an instant cheer/tip to a team",
          accepts: [{ network: config.network, asset: config.usdcAddress, amount: PRICE.tip }],
        },
        "POST /api/join_pool": {
          description: "Join a match's goal reward pool",
          accepts: [{ network: config.network, asset: config.usdcAddress, amount: PRICE.pool }],
        },
        "POST /api/buy_pass": {
          description: "Buy a timed fan-zone / highlight access pass",
          accepts: [{ network: config.network, asset: config.usdcAddress, amount: PRICE.pass }],
        },
      },
      {
        facilitator: { privateKey: config.treasuryPrivateKey, rpcUrl: config.rpcUrl },
        settlementPolicy: "before",
      }
    )
  );

  app.post("/api/pay_per_query", async (req, res) => {
    const { question } = req.body || {};
    if (!question) return res.status(400).json({ error: "question required" });
    const answer = await answerQuestion(question);
    const payer = payerOf(req);
    store.addQuery(question, answer, payer);
    store.recordSettlement({ kind: "pay_per_query", payer, amount: PRICE.query, txHash: req.x402?.txHash || null, network: config.network, meta: { question } });
    res.json({ answer, payer });
  });

  app.post("/api/send_tip", async (req, res) => {
    const { team } = req.body || {};
    if (!team) return res.status(400).json({ error: "team required" });
    const payer = payerOf(req);
    store.addCheer(team, PRICE.tip);
    store.recordSettlement({ kind: "send_tip", payer, amount: PRICE.tip, txHash: req.x402?.txHash || null, network: config.network, meta: { team } });
    res.json({ ok: true, team, totalCheerUnits: store.snapshot().cheers[team] });
  });

  app.post("/api/join_pool", async (req, res) => {
    const { matchId, team, payoutAddress } = req.body || {};
    if (!matchId || !team || !payoutAddress) return res.status(400).json({ error: "matchId, team, payoutAddress required" });
    const payer = payerOf(req);
    store.joinPool(matchId, team, payoutAddress, PRICE.pool);
    store.recordSettlement({ kind: "join_pool", payer, amount: PRICE.pool, txHash: req.x402?.txHash || null, network: config.network, meta: { matchId, team } });
    res.json({ ok: true, matchId, pool: store.getPool(matchId) });
  });

  app.post("/api/buy_pass", async (req, res) => {
    const { tier } = req.body || {};
    const payer = payerOf(req);
    const passId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 3).toISOString(); // 3h pass
    store.addPass(passId, tier || "standard", payer, expiresAt);
    store.recordSettlement({ kind: "buy_pass", payer, amount: PRICE.pass, txHash: req.x402?.txHash || null, network: config.network, meta: { tier } });
    res.json({ ok: true, passId, expiresAt });
  });

  // --- Public, unpaid reads ---

  app.get("/api/health", (_req, res) => res.json({ ok: true, network: config.network }));

  app.get("/api/impact", (_req, res) => {
    const s = store.snapshot();
    res.json({
      network: config.network,
      totals: {
        settlements: s.settlements.length,
        queries: s.queries.length,
        cheers: s.cheers,
        pools: Object.keys(s.pools).length,
        passes: Object.keys(s.passes).length,
      },
      recent: s.settlements.slice(-25).reverse(),
    });
  });

  app.get("/api/pool/:matchId", (req, res) => {
    res.json(store.getPool(req.params.matchId) || { matchId: req.params.matchId, members: [] });
  });

  app.get("/api/games", async (_req, res) => {
    res.json({ games: await getGames() });
  });

  // --- Internal: called by the autonomous tipper agent when it detects a goal ---
  // Guarded by a shared secret so only our own agent can trigger real payouts.
  app.post("/internal/pool/:matchId/trigger-payout", async (req, res) => {
    if (req.headers["x-internal-secret"] !== config.internalSecret) {
      return res.status(403).json({ error: "forbidden" });
    }
    const pool = store.getPool(req.params.matchId);
    if (!pool || pool.members.length === 0) return res.status(404).json({ error: "no pool members" });
    if (pool.payoutTxHash) return res.json({ ok: true, alreadyPaid: pool.payoutTxHash });

    const total = pool.members.reduce((sum, m) => sum + m.amountUnits, 0);
    const share = Math.floor(total / pool.members.length);
    const results = [];
    for (const member of pool.members) {
      const { hash } = await payoutUsdc(member.address, BigInt(share));
      results.push({ to: member.address, amount: share, hash });
    }
    store.markPoolPaid(req.params.matchId, results[0]?.hash || null);
    store.recordSettlement({ kind: "pool_payout", payer: "treasury", amount: String(total), txHash: results[0]?.hash || null, network: config.network, meta: { matchId: req.params.matchId, results } });
    res.json({ ok: true, results });
  });
}

// Allow running standalone too: `node server/index.js`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = express();
  app.use(express.json());
  mountRails(app);
  app.listen(config.port, () => console.log(`MatchMesh rails listening on :${config.port} (${config.network})`));
}
