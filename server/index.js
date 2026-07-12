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

/**
 * Rejects structurally-invalid paid requests BEFORE the payment middleware
 * ever runs, so nobody is charged for a request that was always going to
 * 400. (An earlier attempt used the SDK's settlementPolicy: "after-success"
 * instead, which only settles post-handler — but that setting's
 * response-buffering path produces a malformed HTTP response that Node's
 * own client rejects with "Response does not match the HTTP/1.1 protocol",
 * confirmed by direct testing. That's a real bug in the vendored
 * @injectivelabs/x402 dependency, not something to work around by shipping
 * broken responses. Validating up front sidesteps it entirely and keeps the
 * known-good settlementPolicy: "before" response path.)
 */
function validatePaidBody(req, res, next) {
  const b = req.body || {};
  if (req.method === "POST" && req.path === "/api/pay_per_query" && !b.question) {
    return res.status(400).json({ error: "question required" });
  }
  if (req.method === "POST" && req.path === "/api/send_tip" && !b.team) {
    return res.status(400).json({ error: "team required" });
  }
  if (req.method === "POST" && req.path === "/api/join_pool") {
    if (!b.matchId || !b.team || !b.payoutAddress) {
      return res.status(400).json({ error: "matchId, team, payoutAddress required" });
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(b.payoutAddress)) {
      return res.status(400).json({ error: "payoutAddress must be a valid EVM address" });
    }
    const existing = store.getPool(b.matchId);
    if (existing && existing.team !== b.team) {
      return res.status(400).json({ error: `pool ${b.matchId} is already staked on ${existing.team}, not ${b.team}` });
    }
  }
  next();
}

/** Mounts the MatchMesh rails (paid + public routes) onto an existing Express app. */
export function mountRails(app) {
  app.use(validatePaidBody);

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
    const answer = await answerQuestion(question);
    const payer = payerOf(req);
    store.addQuery(question, answer, payer);
    store.recordSettlement({ kind: "pay_per_query", payer, amount: PRICE.query, txHash: req.x402?.txHash || null, network: config.network, meta: { question } });
    res.json({ answer, payer });
  });

  app.post("/api/send_tip", async (req, res) => {
    const { team } = req.body || {};
    const payer = payerOf(req);
    store.addCheer(team, PRICE.tip);
    store.recordSettlement({ kind: "send_tip", payer, amount: PRICE.tip, txHash: req.x402?.txHash || null, network: config.network, meta: { team } });
    res.json({ ok: true, team, totalCheerUnits: store.snapshot().cheers[team] });
  });

  app.post("/api/join_pool", async (req, res) => {
    const { matchId, team, payoutAddress } = req.body || {};
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
    // Synchronous claim BEFORE any await closes the double-pay race: a second
    // concurrent call for the same matchId sees "processing"/"already paid"
    // and bails, instead of both callers reading payoutTxHash:null and both
    // running the payout loop.
    const claim = store.claimPoolForPayout(req.params.matchId);
    if (!claim.ok) {
      if (claim.reason === "no members") return res.status(404).json({ error: "no pool members" });
      return res.json({ ok: true, alreadyPaid: claim.payoutTxHash ?? "in progress" });
    }
    const pool = claim.pool;

    try {
      const total = pool.members.reduce((sum, m) => sum + m.amountUnits, 0);
      const share = Math.floor(total / pool.members.length);
      const results = [];
      for (const member of pool.members) {
        // A previous attempt may have already paid this member before a
        // later member's payout threw — skip them instead of paying twice.
        // Without this check, releasing the claim on failure (below) let a
        // retry re-run the whole loop from scratch and double-pay everyone
        // who'd already been sent real USDC before the failure point.
        if (member.paid) {
          results.push({ to: member.address, amount: share, hash: member.hash, skipped: true });
          continue;
        }
        const { hash } = await payoutUsdc(member.address, BigInt(share));
        store.markMemberPaid(req.params.matchId, member.address, hash);
        results.push({ to: member.address, amount: share, hash });
      }
      const anyHash = results.find((r) => r.hash)?.hash || null;
      store.markPoolPaid(req.params.matchId, anyHash);
      store.recordSettlement({ kind: "pool_payout", payer: "treasury", amount: String(total), txHash: anyHash, network: config.network, meta: { matchId: req.params.matchId, results } });
      res.json({ ok: true, results });
    } catch (err) {
      // Release the claim on failure so a retry is possible instead of the
      // pool being stuck "processing" forever after a transient chain error.
      // Members already marked paid (above) stay marked paid across the
      // release, so the retry's skip check prevents double-payment.
      store.markPoolPaid(req.params.matchId, null);
      res.status(500).json({ error: "payout_failed", message: err.message });
    }
  });
}

// Allow running standalone too: `node server/index.js`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = express();
  app.use(express.json());
  mountRails(app);
  app.listen(config.port, () => console.log(`MatchMesh rails listening on :${config.port} (${config.network})`));
}
