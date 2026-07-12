/**
 * MatchMesh — single deployable entry point. Mounts the rails, Scout, and MCP
 * server on ONE Express app/port (simpler, more reliable to deploy than three
 * separate services) and serves the public landing page + live dashboard.
 * Scout keeps its own wallet/facilitator config, so the economic separation
 * that matters for the agent-to-agent story is preserved even though it now
 * shares a process with the rails.
 */
import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./server/config.js";
import { mountRails } from "./server/index.js";
import { mountScout } from "./agents/scout-server.js";
import { mountMcp } from "./mcp/server.js";
import { mountDemo } from "./server/demo.js";
import { tick as tipperTick } from "./agents/tipper.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

mountRails(app);
mountScout(app);
mountMcp(app);
mountDemo(app);

app.listen(config.port, () => {
  console.log(`MatchMesh listening on :${config.port} (rails + scout + mcp, ${config.network})`);
});

// Run Tipper's autonomous goal-watch loop IN this process, not just as a
// script someone happens to run manually. render.yaml only deploys this one
// web service — without this, "autonomous, no human in the loop" was true
// of the code but not of the actual live deployment.
const TIPPER_POLL_MS = Number(process.env.TIPPER_POLL_MS || 15_000);
console.log(`[tipper] autonomous poller starting (every ${TIPPER_POLL_MS}ms)`);
setInterval(() => {
  tipperTick().catch((err) => console.error("[tipper] cycle failed:", err.message));
}, TIPPER_POLL_MS);
