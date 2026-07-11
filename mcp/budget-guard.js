/**
 * Shared spend guard for the MCP operator wallet — used by both the MCP tool
 * surface and the browser-facing /demo/ask endpoint, since they pay from the
 * SAME wallet. One shared counter, not two independent caps, or the effective
 * daily drain risk would double.
 */
const DAILY_BUDGET_UNITS = BigInt(Math.round(Number(process.env.MCP_DAILY_BUDGET_USD || 2) * 1e6));
let spentToday = 0n;
let budgetWindowStart = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

export function checkBudget(costUnits) {
  if (Date.now() - budgetWindowStart > DAY_MS) {
    spentToday = 0n;
    budgetWindowStart = Date.now();
  }
  if (spentToday + costUnits > DAILY_BUDGET_UNITS) {
    const remaining = Number(DAILY_BUDGET_UNITS - spentToday) / 1e6;
    throw new Error(`Shared demo/MCP daily spend cap reached (remaining: $${remaining.toFixed(4)}). This guards the operator wallet against abuse — try again after the daily window resets, or call the x402 rails directly with your own funded wallet.`);
  }
  spentToday += costUnits;
}
