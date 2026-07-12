import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const DATA_DIR = new URL("./.data/", import.meta.url);
const DATA_FILE = new URL("./ledger.json", DATA_DIR);

function empty() {
  return {
    settlements: [],   // {id, kind, payer, amount, txHash, network, at, meta}
    cheers: {},        // team -> total USDC units
    pools: {},          // matchId -> { team, members: [{address, amountUnits}], payoutTxHash|null }
    passes: {},         // passId -> { tier, buyer, issuedAt, expiresAt }
    queries: [],         // {id, question, answer, payer, at}
  };
}

function load() {
  if (!existsSync(DATA_FILE)) return empty();
  try {
    return { ...empty(), ...JSON.parse(readFileSync(DATA_FILE, "utf8")) };
  } catch {
    return empty();
  }
}

let state = load();

function persist() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

export const store = {
  recordSettlement(entry) {
    state.settlements.push({ id: `s_${state.settlements.length + 1}`, at: new Date().toISOString(), ...entry });
    persist();
  },
  addCheer(team, amountUnits) {
    state.cheers[team] = (state.cheers[team] || 0) + Number(amountUnits);
    persist();
  },
  joinPool(matchId, team, address, amountUnits) {
    if (!state.pools[matchId]) state.pools[matchId] = { team, members: [], payoutTxHash: null };
    state.pools[matchId].members.push({ address, amountUnits: Number(amountUnits), paid: false, hash: null });
    persist();
  },
  getPool(matchId) {
    return state.pools[matchId] || null;
  },
  markPoolPaid(matchId, payoutTxHash) {
    if (state.pools[matchId]) state.pools[matchId].payoutTxHash = payoutTxHash;
    persist();
  },
  /**
   * Marks one member as paid the moment their individual payout confirms,
   * independent of whether the rest of the loop later succeeds or throws.
   * This is what makes a retry after a partial failure safe: a retry skips
   * members already marked paid instead of re-sending them real USDC.
   */
  markMemberPaid(matchId, address, hash) {
    const pool = state.pools[matchId];
    if (!pool) return;
    const member = pool.members.find((m) => m.address === address && !m.paid);
    if (member) {
      member.paid = true;
      member.hash = hash;
      persist();
    }
  },
  /**
   * Synchronously claims the right to pay out a pool, before any await runs.
   * Node's single-threaded event loop means this can't interleave with another
   * request's claim — the second concurrent caller always sees "processing" or
   * "paid" and bails, closing the double-pay race in the trigger-payout route.
   */
  claimPoolForPayout(matchId) {
    const pool = state.pools[matchId];
    if (!pool || pool.members.length === 0) return { ok: false, reason: "no members" };
    if (pool.payoutTxHash === "processing") return { ok: false, reason: "already processing" };
    if (pool.payoutTxHash) return { ok: false, reason: "already paid", payoutTxHash: pool.payoutTxHash };
    pool.payoutTxHash = "processing";
    persist();
    return { ok: true, pool };
  },
  addPass(passId, tier, buyer, expiresAt) {
    state.passes[passId] = { tier, buyer, issuedAt: new Date().toISOString(), expiresAt };
    persist();
  },
  getPass(passId) {
    return state.passes[passId] || null;
  },
  addQuery(question, answer, payer) {
    state.queries.push({ id: `q_${state.queries.length + 1}`, question, answer, payer, at: new Date().toISOString() });
    persist();
  },
  snapshot() {
    return state;
  },
};
