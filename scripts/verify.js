/**
 * On-chain settlement verifier — re-derives real USDC movement for every
 * MatchMesh wallet directly from Injective EVM testnet Transfer logs,
 * independent of the app's own ledger.json. "Don't trust our numbers,
 * re-derive them." (Same pattern as Sluice's `npm run verify`.)
 */
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { publicClient, ERC20_ABI } from "../server/chain.js";
import { config } from "../server/config.js";

const CHUNK_BLOCKS = 5000n; // chunk eth_getLogs in case the RPC caps block ranges

function loadKeys() {
  const roles = ["treasury", "agent-statcaster", "agent-scout", "agent-tipper", "mcp-operator"];
  const wallets = {};
  for (const role of roles) {
    const path = new URL(`../keys/${role}.json`, import.meta.url);
    if (existsSync(path)) {
      const { address } = JSON.parse(readFileSync(path, "utf8"));
      wallets[role] = address.toLowerCase();
    }
  }
  return wallets;
}

async function getAllTransferLogs(fromBlock, toBlock) {
  const logs = [];
  let start = fromBlock;
  while (start <= toBlock) {
    const end = start + CHUNK_BLOCKS - 1n > toBlock ? toBlock : start + CHUNK_BLOCKS - 1n;
    try {
      const chunk = await publicClient.getLogs({
        address: config.usdcAddress,
        event: ERC20_ABI.find((f) => f.type === "event" && f.name === "Transfer"),
        fromBlock: start,
        toBlock: end,
      });
      logs.push(...chunk);
    } catch (err) {
      console.error(`  getLogs(${start}-${end}) failed: ${err.shortMessage || err.message}`);
    }
    start = end + 1n;
  }
  return logs;
}

async function main() {
  const wallets = loadKeys();
  console.log("MatchMesh on-chain verifier — Injective EVM testnet");
  console.log("USDC:", config.usdcAddress);
  console.log("Wallets:", wallets);

  const latest = await publicClient.getBlockNumber();
  // Injective EVM blocks land roughly every ~0.65-0.85s, so 20k blocks is
  // ~4-5 hours of lookback — plenty for a single build/demo session. Override
  // with VERIFY_LOOKBACK_BLOCKS if verifying long after the fact.
  const genesisWindow = BigInt(process.env.VERIFY_LOOKBACK_BLOCKS || 20_000);
  const fromBlock = latest > genesisWindow ? latest - genesisWindow : 0n;

  console.log(`Scanning blocks ${fromBlock} -> ${latest} ...`);
  const logs = await getAllTransferLogs(fromBlock, latest);
  console.log(`Found ${logs.length} total USDC Transfer events in range.`);

  const addrToRole = Object.fromEntries(Object.entries(wallets).map(([role, addr]) => [addr, role]));
  const relevant = logs.filter((l) => addrToRole[l.args.from?.toLowerCase()] || addrToRole[l.args.to?.toLowerCase()]);

  let totalIn = 0n;
  let totalOut = 0n;
  const perWallet = {};
  for (const log of relevant) {
    const from = log.args.from.toLowerCase();
    const to = log.args.to.toLowerCase();
    const value = log.args.value;
    if (addrToRole[to]) {
      perWallet[addrToRole[to]] = perWallet[addrToRole[to]] || { in: 0n, out: 0n };
      perWallet[addrToRole[to]].in += value;
      totalIn += value;
    }
    if (addrToRole[from]) {
      perWallet[addrToRole[from]] = perWallet[addrToRole[from]] || { in: 0n, out: 0n };
      perWallet[addrToRole[from]].out += value;
      totalOut += value;
    }
  }

  console.log(`\nReal on-chain settlements touching MatchMesh wallets: ${relevant.length}`);
  console.log(`Total in:  ${totalIn} units (${Number(totalIn) / 1e6} USDC)`);
  console.log(`Total out: ${totalOut} units (${Number(totalOut) / 1e6} USDC)`);
  for (const [role, sums] of Object.entries(perWallet)) {
    console.log(`  ${role.padEnd(18)} in=${sums.in} out=${sums.out}`);
  }

  const ledgerPath = new URL("../server/.data/ledger.json", import.meta.url);
  if (existsSync(ledgerPath)) {
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
    console.log(`\nApp's own ledger claims ${ledger.settlements.length} settlements.`);
    console.log(relevant.length >= ledger.settlements.length ? "OK: chain confirms at least as many transfers as the app claims." : "WARNING: app claims MORE settlements than the chain shows — investigate.");
  } else {
    console.log("\nNo local ledger.json found yet (server hasn't recorded any settlements) — chain-only numbers above are authoritative.");
  }
}

main().catch((err) => {
  console.error("Verify failed:", err);
  process.exitCode = 1;
});
