/**
 * Tipper — autonomous goal-triggered payout agent.
 * Polls live World Cup scores; the instant a goal is detected in a match that
 * has an active reward pool, it autonomously triggers a payout split among
 * everyone staked in that pool. No human in the loop. Logs its reasoning for
 * every cycle (Sluice-style decision log) so a judge can see WHY it acted.
 *
 * Usage: node agents/tipper.js            (runs continuously)
 *        node agents/tipper.js --once      (single poll cycle, for a demo/CI run)
 */
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { detectNewGoals } from "../server/worldcup.js";

const BASE_URL = process.env.MATCHMESH_URL || `http://localhost:${process.env.PORT || 4021}`;
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;
const POLL_MS = Number(process.env.TIPPER_POLL_MS || 15_000);

async function getPool(matchId) {
  const res = await fetch(`${BASE_URL}/api/pool/${matchId}`);
  return res.json();
}

async function triggerPayout(matchId) {
  const res = await fetch(`${BASE_URL}/internal/pool/${matchId}/trigger-payout`, {
    method: "POST",
    headers: { "x-internal-secret": INTERNAL_SECRET },
  });
  return res.json();
}

export async function tick() {
  const goals = await detectNewGoals();
  if (goals.length === 0) {
    console.log(`[tipper] ${new Date().toISOString()} no new goals this cycle`);
    return [];
  }

  const decisions = [];
  for (const goal of goals) {
    console.log(`[tipper] GOAL: ${goal.homeTeam} ${goal.homeScore}-${goal.awayScore} ${goal.awayTeam} (match ${goal.matchId})`);
    const pool = await getPool(goal.matchId);
    if (!pool || !pool.members || pool.members.length === 0) {
      console.log(`[tipper]   -> no reward pool staked on this match, no action`);
      decisions.push({ matchId: goal.matchId, action: "skip", reason: "no pool" });
      continue;
    }
    if (pool.payoutTxHash) {
      console.log(`[tipper]   -> pool already paid out (${pool.payoutTxHash}), no action`);
      decisions.push({ matchId: goal.matchId, action: "skip", reason: "already paid" });
      continue;
    }
    console.log(`[tipper]   -> pool has ${pool.members.length} member(s), triggering autonomous payout`);
    const result = await triggerPayout(goal.matchId);
    console.log(`[tipper]   -> payout result:`, JSON.stringify(result));
    decisions.push({ matchId: goal.matchId, action: "payout", result });
  }
  return decisions;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!INTERNAL_SECRET) {
    console.error("Missing INTERNAL_SECRET in .env");
    process.exit(1);
  }
  const once = process.argv.includes("--once");
  if (once) {
    // Let the event loop drain naturally after the async tick — calling
    // process.exit() immediately after a fetch() can race undici's handle
    // cleanup on Windows and crash with a libuv assertion.
    tick()
      .then(() => { process.exitCode = 0; })
      .catch((err) => { console.error("[tipper] once-cycle failed:", err.message); process.exitCode = 1; });
  } else {
    console.log(`[tipper] watching for goals every ${POLL_MS}ms against ${BASE_URL}`);
    setInterval(() => tick().catch((e) => console.error("[tipper] cycle failed:", e.message)), POLL_MS);
  }
}
