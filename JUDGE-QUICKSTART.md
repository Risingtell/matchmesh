# Judge quickstart — verify this in under 5 minutes

Live deployment, no setup needed: **https://matchmesh.onrender.com**

## 1. Confirm it's built on real Injective x402, not a mock (30s)

```bash
grep -r "injectivePaymentMiddleware\|createInjectiveClient" server/ agents/ mcp/
```

You'll see the official `@injectivelabs/x402` middleware/client used directly in the rails server, the MCP server, and every agent — not a hand-rolled payment scheme.

## 2. Confirm it's real live 2026 World Cup data, not fixtures (30s)

```bash
curl -s https://worldcup26.ir/health
curl -s https://matchmesh.onrender.com/api/games | head -c 500
```

`worldcup26.ir` is the actual public API tracking the real 2026 tournament (started June 11, 2026, currently in the Round of 16 / quarterfinals) — not a static JSON file we shipped.

## 3. Make a real paid call against the live deployment (1 min)

No local setup needed — clone the repo just for the client script, point it at the live URL:

```bash
git clone https://github.com/Risingtell/matchmesh && cd matchmesh && npm install
cp .env.example .env
# .env.example already has the correct NETWORK/RPC_URL/USDC_ADDRESS filled in —
# just replace STATCASTER_PRIVATE_KEY with any funded Injective testnet key
# (the rails don't care who pays; get free testnet USDC at faucet.circle.com)
MATCHMESH_URL=https://matchmesh.onrender.com npm run agent:statcaster -- "how did Mexico do?"
```

Prints a real on-chain transaction hash on Injective EVM testnet.

## 4. Verify the numbers independently of our own app (30s)

```bash
npm run verify
```

This re-derives every settlement straight from Injective testnet USDC `Transfer` event logs via RPC — it does not read our database. If our `/api/impact` feed ever claimed more than the chain shows, this command would say so. (Note: the live site's own `/api/impact` dashboard reflects its own ledger file, which resets on redeploy since Render's free tier disk is ephemeral — the on-chain settlements themselves are permanent regardless, which is exactly why this verifier exists.)

## 5. Confirm the MCP tool surface with any MCP client (30s)

```bash
curl -s -X POST https://matchmesh.onrender.com/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Returns `ask_worldcup_stat`, `send_cheer`, `join_goal_pool`, `buy_fan_pass` — the same rails, exposed as standard MCP tools any agent can call with zero wallet setup on their side (the deployed server holds its own funded operator wallet and pays on the caller's behalf).

## 6. Confirm it's packaged as an Agent Skill

```
skills/matchmesh/SKILL.md
```

Follows the exact same frontmatter/structure convention as `InjectiveLabs/agent-skills` — installable the same way other Injective skills are.

## Full local run (optional — only needed to run your own agents, not to verify the deployment)

```bash
npm run genkeys && node scripts/build-env.js   # generates 5 wallets, writes .env
npm run balances                                # shows which wallets still need funding
# treasury + agent-scout need INJ gas (testnet.faucet.injective.network)
# agent-statcaster + mcp-operator need USDC (faucet.circle.com, Injective Testnet)
# agent-tipper needs nothing — it doesn't sign any transaction in the current code
npm start                                       # rails + Scout + MCP + dashboard, one process
```
