import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

const KEYS_DIR = new URL("../keys/", import.meta.url);
const ENV_PATH = new URL("../.env", import.meta.url);

function loadKey(role) {
  return JSON.parse(readFileSync(new URL(`${role}.json`, KEYS_DIR), "utf8"));
}

const treasury = loadKey("treasury");
const statcaster = loadKey("agent-statcaster");
const scout = loadKey("agent-scout");
const tipper = loadKey("agent-tipper");
const mcpOperator = loadKey("mcp-operator");

const lines = [
  "# MatchMesh — Injective testnet config. Gitignored, never commit.",
  "NETWORK=eip155:1439",
  "RPC_URL=https://testnet.evm.archival.chain.virtual.json-rpc.injective.network",
  "USDC_ADDRESS=0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d",
  "PORT=4021",
  "",
  `TREASURY_PRIVATE_KEY=${treasury.privateKey}`,
  `TREASURY_ADDRESS=${treasury.address}`,
  `INTERNAL_SECRET=${randomBytes(24).toString("hex")}`,
  "",
  `STATCASTER_PRIVATE_KEY=${statcaster.privateKey}`,
  `STATCASTER_ADDRESS=${statcaster.address}`,
  "",
  `SCOUT_PRIVATE_KEY=${scout.privateKey}`,
  `SCOUT_ADDRESS=${scout.address}`,
  "",
  `TIPPER_PRIVATE_KEY=${tipper.privateKey}`,
  `TIPPER_ADDRESS=${tipper.address}`,
  "",
  `MCP_OPERATOR_PRIVATE_KEY=${mcpOperator.privateKey}`,
  `MCP_OPERATOR_ADDRESS=${mcpOperator.address}`,
  "",
];

if (existsSync(ENV_PATH)) {
  console.log(".env already exists, not overwriting.");
} else {
  writeFileSync(ENV_PATH, lines.join("\n"));
  console.log(".env written.");
}
