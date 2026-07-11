# Judge quickstart — verify this in under 5 minutes

## 1. Confirm it's built on real Injective x402, not a mock (30s)

```bash
grep -r "injectivePaymentMiddleware\|createInjectiveClient" server/ agents/ mcp/
```

You'll see the official `@injectivelabs/x402` middleware/client used directly in the rails server, the MCP server, and every agent — not a hand-rolled payment scheme.

## 2. Confirm it's real live 2026 World Cup data, not fixtures (30s)

```bash
curl -s https://worldcup26.ir/health
curl -s http://localhost:4021/api/games | head -c 500   # once the server is running
```

`worldcup26.ir` is the actual public API tracking the real 2026 tournament (started June 11, 2026) — not a static JSON file we shipped.

## 3. Run it end-to-end (3 min)

```bash
npm install
node scripts/genkeys.js          # generates 5 wallets (treasury + 4 agents), printed to console
node scripts/build-env.js        # writes .env

# fund the 5 printed addresses (testnet, free):
#   faucet.circle.com          -> testnet USDC (20/2hr/address)
#   testnet.faucet.injective.network -> INJ for gas

npm run server &                 # rails, :4021
node agents/scout-server.js &    # Scout's own paid service, :4022
npm run mcp &                    # MCP server, :4023/mcp

npm run agent:statcaster -- "how did Mexico do?"
node agents/scout.js Mexico       # agent-to-agent payment: StatCaster's wallet pays Scout's wallet
```

Each command prints a real on-chain transaction hash on Injective EVM testnet.

## 4. Verify the numbers independently of our own app (30s)

```bash
npm run verify
```

This re-derives every settlement straight from Injective testnet USDC `Transfer` event logs via RPC — it does not read our database. If our `/api/impact` feed ever claimed more than the chain shows, this command would say so.

## 5. Confirm the MCP tool surface with any MCP client (1 min)

```bash
curl -s -X POST http://localhost:4023/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Returns `ask_worldcup_stat`, `send_cheer`, `join_goal_pool`, `buy_fan_pass` — the same rails, exposed as standard MCP tools any agent can call with zero wallet setup on their side.

## 6. Confirm it's packaged as an Agent Skill

```
skills/matchmesh/SKILL.md
```

Follows the exact same frontmatter/structure convention as `InjectiveLabs/agent-skills` — installable the same way other Injective skills are.
