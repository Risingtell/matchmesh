import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { publicClient, usdcBalanceOf } from "../server/chain.js";

const roles = ["treasury", "agent-statcaster", "agent-scout", "agent-tipper", "mcp-operator"];

for (const role of roles) {
  const path = new URL(`../keys/${role}.json`, import.meta.url);
  if (!existsSync(path)) continue;
  const { address } = JSON.parse(readFileSync(path, "utf8"));
  const [inj, usdc] = await Promise.all([
    publicClient.getBalance({ address }),
    usdcBalanceOf(address),
  ]);
  console.log(`${role.padEnd(18)} ${address}  INJ=${Number(inj) / 1e18}  USDC=${Number(usdc) / 1e6}`);
}
