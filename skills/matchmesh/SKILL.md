---
name: matchmesh
description: Agent-commerce settlement layer for World Cup apps on Injective — pay-per-query stats, fan cheers, goal-triggered reward pools, and fan-zone passes over x402 + MCP.
license: MIT
metadata:
  author: Risingtell
  version: "1.0.0"
---

# MatchMesh, Skill Guide

MatchMesh is a shared settlement layer for World Cup 2026 apps and agents on Injective. Instead of every builder wiring their own x402 payments, an agent connects to one MCP server and gets four ready-made, real-money tools — proven live against the actual 2026 tournament, not mocked data.

## When to apply

- When an agent needs to answer a question about a live 2026 World Cup match and should pay per query instead of needing its own API key.
- When a fan-facing app wants to let users send an instant cheer/tip to a team without building payment rails from scratch.
- When a project wants to run a "goal reward pool" — fans stake in, and the pool pays out automatically the moment that match's next goal is scored — without building the payout automation itself.
- When an app needs to gate content behind a timed access pass paid in USDC.
- When another agent (not just a human-facing app) wants to buy World Cup data programmatically — MatchMesh's `scout` service is built for agent-to-agent purchases.

## Activities

### Connect to the MatchMesh MCP server

MatchMesh exposes a streamable HTTP MCP endpoint. Point any MCP client at:

```
http://<matchmesh-host>/mcp
```

No wallet setup needed on the caller's side — the server holds its own funded operator wallet and settles the underlying x402 payment on your behalf. Every call still produces a real on-chain USDC transfer on Injective EVM (testnet by default), independently verifiable.

### Available tools

- `ask_worldcup_stat({ question })` — plain-English answer about a live match. $0.001 USDC.
- `send_cheer({ team })` — instant tip to a team. $0.05 USDC.
- `join_goal_pool({ matchId, team, payoutAddress })` — stake into a match's goal reward pool. $0.10 USDC. Autonomously pays out, split evenly among members, the instant that match's next goal is detected.
- `buy_fan_pass({ tier? })` — buy a 3-hour fan-zone access pass. $0.20 USDC.

### Call the rails directly (no MCP client)

Every tool is also a plain x402-gated HTTP endpoint, for agents that speak x402 natively via `@injectivelabs/x402/client` instead of MCP:

```
POST /api/pay_per_query   { question }
POST /api/send_tip        { team }
POST /api/join_pool       { matchId, team, payoutAddress }
POST /api/buy_pass        { tier }
```

See `createInjectiveClient` in the [`@injectivelabs/x402`](https://github.com/InjectiveLabs/x402) package — it handles the 402 → sign → retry flow automatically.

### Hire Scout for structured data (agent-to-agent)

Scout is a separate, independently-payable microservice for agents that want raw structured facts (not prose) about a team's matches — the primitive other agents in the mesh pay to consume, demonstrating real agent-to-agent commerce rather than only human-to-agent.

```
POST /scout/lookup   { team }   -> $0.0005 USDC, paid FROM the caller's own wallet TO Scout directly
```

### Verify the mesh is real, not a mock

```
npm run verify
```

Re-derives every settlement total straight from on-chain USDC Transfer logs on Injective EVM testnet, independent of MatchMesh's own database — don't trust the numbers, re-derive them.
