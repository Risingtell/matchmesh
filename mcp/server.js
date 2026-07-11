/**
 * MatchMesh MCP Server — exposes the rails (pay_per_query, send_tip, join_pool,
 * buy_pass) as standard MCP tools so any MCP-compatible agent (Claude, or any
 * other client) can use them with zero wallet setup on the caller's side.
 *
 * Design: this server holds ONE funded "operator" wallet and pays the x402
 * rails on the caller's behalf for every tool call. That keeps the MCP
 * interface simple (a judge's MCP client just calls a tool, no crypto needed)
 * while still proving the full real-money settlement pipeline underneath —
 * every call still shows up as a real on-chain USDC transfer, verifiable via
 * `npm run verify`.
 *
 * Mountable on the same Express app as the rails (calls back into them over
 * loopback HTTP); can also run standalone via `node mcp/server.js`.
 */
import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createInjectiveClient, parsePaymentResponseHeader } from "@injectivelabs/x402/client";
import { PRICE } from "../server/index.js";
import { checkBudget } from "./budget-guard.js";

const RAILS_URL = process.env.MATCHMESH_URL || `http://localhost:${process.env.PORT || 4021}`;

// Budget guard is shared with /demo/ask (server/demo.js) since both pay from
// the same operator wallet — see mcp/budget-guard.js.

function buildOperatorClient() {
  return createInjectiveClient({
    privateKey: process.env.MCP_OPERATOR_PRIVATE_KEY,
    rpcUrl: process.env.RPC_URL,
    preferredNetworks: [process.env.NETWORK ?? "eip155:1439"],
  });
}

async function payRails(operatorClient, path, body, costUnits) {
  checkBudget(costUnits);
  const res = await operatorClient.fetch(`${RAILS_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const receipt = parsePaymentResponseHeader(res);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${path} failed with ${res.status}`);
  return { data, receipt };
}

function textResult(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

function buildServer(operatorClient) {
  const server = new McpServer({ name: "matchmesh", version: "1.0.0" });

  server.registerTool(
    "ask_worldcup_stat",
    {
      title: "Ask World Cup stat",
      description: "Ask a plain-English question about a live 2026 World Cup match. Pays $0.001 USDC via x402 under the hood.",
      inputSchema: { question: z.string().describe("e.g. 'how did Mexico do?' or 'what's the live score of Canada?'") },
    },
    async ({ question }) => {
      const { data, receipt } = await payRails(operatorClient, "/api/pay_per_query", { question }, BigInt(PRICE.query));
      return textResult({ answer: data.answer, settledTx: receipt?.transaction ?? null });
    }
  );

  server.registerTool(
    "send_cheer",
    {
      title: "Send a cheer/tip",
      description: "Send an instant $0.05 USDC cheer to a World Cup team via x402.",
      inputSchema: { team: z.string().describe("Team name, e.g. 'Mexico'") },
    },
    async ({ team }) => {
      const { data, receipt } = await payRails(operatorClient, "/api/send_tip", { team }, BigInt(PRICE.tip));
      return textResult({ team: data.team, totalCheerUnits: data.totalCheerUnits, settledTx: receipt?.transaction ?? null });
    }
  );

  server.registerTool(
    "join_goal_pool",
    {
      title: "Join a goal reward pool",
      description: "Stake $0.10 USDC into a match's goal reward pool. Payout splits automatically among members the instant that match's next goal is scored.",
      inputSchema: {
        matchId: z.string(),
        team: z.string(),
        payoutAddress: z.string().describe("EVM address to receive the payout"),
      },
    },
    async ({ matchId, team, payoutAddress }) => {
      const { data, receipt } = await payRails(operatorClient, "/api/join_pool", { matchId, team, payoutAddress }, BigInt(PRICE.pool));
      return textResult({ pool: data.pool, settledTx: receipt?.transaction ?? null });
    }
  );

  server.registerTool(
    "buy_fan_pass",
    {
      title: "Buy a fan-zone access pass",
      description: "Buy a timed (3h) fan-zone / highlight access pass for $0.20 USDC via x402.",
      inputSchema: { tier: z.string().optional().describe("Pass tier, defaults to 'standard'") },
    },
    async ({ tier }) => {
      const { data, receipt } = await payRails(operatorClient, "/api/buy_pass", { tier }, BigInt(PRICE.pass));
      return textResult({ passId: data.passId, expiresAt: data.expiresAt, settledTx: receipt?.transaction ?? null });
    }
  );

  return server;
}

export function mountMcp(app) {
  const operatorClient = buildOperatorClient();

  // Stateless mode: fresh MCP server+transport per request, per SDK guidance.
  app.post("/mcp", async (req, res) => {
    const server = buildServer(operatorClient);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[mcp] request failed:", err.message);
      if (!res.headersSent) res.status(500).json({ error: "internal error" });
    }
  });

  app.get("/mcp/health", (_req, res) => res.json({ ok: true, id: randomUUID(), railsUrl: RAILS_URL }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const MCP_PORT = Number(process.env.MCP_PORT || 4023);
  const app = express();
  app.use(express.json());
  mountMcp(app);
  app.listen(MCP_PORT, () => console.log(`MatchMesh MCP server listening on :${MCP_PORT}/mcp (rails at ${RAILS_URL})`));
}
