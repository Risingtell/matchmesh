# MatchMesh

**The agent-commerce settlement layer for the 2026 World Cup, on Injective.**

Built for the [Injective Global Cup](https://www.hackquest.io/hackathons/The-Injective-Global-Cup) (HackQuest). Instead of shipping one more World Cup app, MatchMesh is the *rails* — a shared MCP + x402 settlement layer any World Cup app or agent can plug into — proven live with three real agents running on top of its own rails, against the actual 2026 tournament in progress right now.

**Live demo:** https://matchmesh.onrender.com
**Video:** _fill in demo video link_
**Verify it's real:** `npm run verify` — re-derives every settlement straight from Injective testnet USDC Transfer logs, independent of this app's own database. This is the authoritative proof; the live site's `/api/impact` dashboard reflects its own local ledger and resets on redeploy (Render free-tier disk is ephemeral), but the on-chain settlements themselves are permanent and don't depend on that ledger surviving.

## Capability map

| MatchMesh feature | Injective / hackathon-required capability |
|---|---|
| `pay_per_query`, `send_tip`, `join_pool`, `buy_pass` rails | `@injectivelabs/x402` — real x402 payments on Injective EVM |
| MCP tool surface (`ask_worldcup_stat`, `send_cheer`, `join_goal_pool`, `buy_fan_pass`) | MCP Server — any MCP-compatible agent can use the rails with zero wallet setup |
| `skills/matchmesh/SKILL.md` | Agent Skills — installable via `npx skills add <repo> --skill matchmesh`, same convention as `InjectiveLabs/agent-skills` |
| Cross-chain funding path (testnet USDC via Circle faucet + CCTP contracts) | USDC CCTP |
| Scout microservice paid by other agents, not humans | Agent-to-agent commerce, not just human-to-agent |
| `npm run verify` | On-chain proof — don't trust the numbers, re-derive them |

## Why rails, not another app

Every judging criterion on the hackathon page rewards this directly. *"Future contribution potential"* can't be scored by a one-off app — but infrastructure other builders can adopt after the event can. *"New Injective technology utilization"* is the actual product here, not a bolted-on requirement. Three real agents prove the rails aren't a spec doc:

1. **StatCaster** (`agents/statcaster.js`) — pays $0.001 per plain-English answer about a live match.
2. **Scout** (`agents/scout-server.js` + `agents/scout.js`) — an independently-payable microservice other agents hire for structured match data ($0.0005), demonstrating agent-to-agent commerce, not just human-to-agent.
3. **Tipper** (`agents/tipper.js`) — autonomously watches live scores and triggers a goal-reward-pool payout the instant a goal is scored, no human in the loop. Logs its reasoning every poll cycle.

All three run against **real, live 2026 World Cup data** (worldcup26.ir — verified live, not mocked) and settle real USDC on Injective EVM testnet.

## Architecture

```
                         ┌────────────────────┐
   fans / apps  ───pay──▶│  rails (server/)   │──x402──▶ Injective EVM testnet
   MCP clients  ───call─▶│  + MCP (mcp/)      │          (USDC transferWithAuthorization)
                         └────────┬───────────┘
                                  │ live World Cup data (worldcup26.ir)
                    ┌─────────────┼─────────────┐
              StatCaster       Tipper          Scout (separate paid service,
           (pay_per_query)  (autonomous,     hired agent-to-agent by other
                             goal-triggered)  agents for structured data)
```

## Run it

```bash
npm install
npm run genkeys      # generates treasury + 4 agent wallets (gitignored)
node scripts/build-env.js   # writes .env from the generated keys
# fund: faucet.circle.com (testnet USDC, Injective Testnet) for treasury/agent-scout (gas)
#       + agent-statcaster/mcp-operator (USDC) — see JUDGE-QUICKSTART.md for exactly which wallet needs what

npm start              # everything on one port: rails + Scout + MCP + dashboard (:4021, or $PORT)
# or run them separately for local dev:
#   npm run server        # rails on :4021
#   npm run mcp            # MCP server on :4023/mcp
#   node agents/scout-server.js   # Scout's own paid microservice on :4022

npm run agent:statcaster -- "how did Mexico do?"
node agents/scout.js Mexico
npm run agent:tipper           # watches live scores continuously
node agents/tipper.js --once   # single poll cycle, good for a demo/CI run

npm run verify         # on-chain proof, independent of the app's own database
npm run balances       # check every wallet's INJ/USDC balance
```

Deploys as a single Render web service (see `render.yaml`) — `npm start` runs `app.js`, which mounts the rails, Scout, and MCP server on one Express app/port and serves the landing page + live dashboard from `public/`.

## Tech

Injective EVM testnet (`eip155:1439`), `@injectivelabs/x402` (real x402 middleware/client/facilitator — not hand-rolled), native Circle USDC (`0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d`, EIP-3009), `@modelcontextprotocol/sdk` (Streamable HTTP transport, stateless), viem, Express.

## License

MIT
