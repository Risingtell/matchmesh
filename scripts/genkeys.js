import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";

const KEYS_DIR = new URL("../keys/", import.meta.url);
if (!existsSync(KEYS_DIR)) mkdirSync(KEYS_DIR, { recursive: true });

const roles = ["treasury", "agent-statcaster", "agent-scout", "agent-tipper", "mcp-operator"];

const out = {};
for (const role of roles) {
  const path = new URL(`${role}.json`, KEYS_DIR);
  if (existsSync(path)) {
    console.log(`skip ${role} (already exists)`);
    continue;
  }
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  writeFileSync(path, JSON.stringify({ role, address: account.address, privateKey }, null, 2));
  out[role] = account.address;
  console.log(`${role.padEnd(18)} ${account.address}`);
}

console.log("\nFund each address with testnet USDC (faucet.circle.com, Injective Testnet, 20 USDC/2hr) and INJ gas (testnet.faucet.injective.network).");
console.log("Keys saved under keys/ — gitignored, never commit.");
