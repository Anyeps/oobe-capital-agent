# Steve Momentum — Autonomous Capital Agent on Solana

An autonomous capital agent for Solana, built for the
[OOBE Protocol bounty on Superteam Earn](https://superteam.fun/earn/listing/build-an-autonomous-capital-agent-on-solana-and-compete-for-dollar500-in-rewards)
("Build an Autonomous Capital Agent on Solana & Compete for $500 in Rewards").

**Paper trading only.** This agent never holds private keys, never signs a
transaction, and never moves real funds. It reads public market data, decides
with a transparent momentum strategy, and simulates execution with fees and
slippage. The code is the product: a clean, tested, reproducible agent that
plugs into the OOBE Synapse SDK and exposes its tools over MCP.

- **Live dashboard:** https://anyeps.github.io/oobe-capital-agent/
- **Strategy:** "Momentum Rider" — long/flat trend-following on SOL/USDC
  (SMA 12/48 crossover + RSI(14) filter, ATR-based stop/take-profit).
- **Stack:** TypeScript, Node ≥ 20, `@oobe-protocol-labs/synapse-client-sdk`
  v2.0.6 (SynapseAgentKit + MCP server), zero other runtime dependencies.

## Strategy (v1)

| Piece | Rule |
|---|---|
| Signal | LONG when fast SMA(12) > slow SMA(48) **and** RSI(14) > 55. Flat when SMA flips or RSI(14) < 45. Long/flat only — no shorts. |
| Sizing | Risk 1% of capital per trade; stop = entry − 2× ATR(14); take-profit = entry + 3× ATR(14); max position 25% of capital. |
| Guardrails | Daily loss limit 2% (no new entries that day); max-drawdown circuit breaker at 5% (flatten + 48h cooldown, then resume). |
| Costs | 0.10% taker fee + 0.05% slippage per simulated fill. |
| Data | CoinGecko public price API (live, no key); deterministic seeded mock feed as fallback and for backtests. |

## Backtest (paper, deterministic mock feed)

90 days of hourly bars, $1,000 paper capital, seed 42:

| Metric | Steve Momentum | Buy & hold |
|---|---:|---:|
| Total return | **+11.21%** | +18.06% |
| Max drawdown | **6.34%** | 40.39% |
| Trades | 93 (50.5% win) | — |
| Profit factor | 2.17 | — |
| Fees (paper) | $49.34 | — |

The strategy gives up upside in strong uptrends to cap drawdown — worst
drawdown 6.34% vs 40.39% for buy & hold. Multi-seed robustness (same config):

| Seed | Return | Profit factor | Max DD | Trades |
|---:|---:|---:|---:|---:|
| 42 | +11.21% | 2.17 | 6.34% | 93 |
| 7 | +14.93% | 3.05 | 1.91% | 80 |
| 123 | +20.47% | 3.53 | 2.52% | 92 |
| 2026 | +11.42% | 2.05 | 4.76% | 102 |

Mean return across seeds: **+14.5%**. All seeds positive. Full trade log in
[`reports/backtest.md`](reports/backtest.md).

## Run it

```bash
npm install
npm test            # 10 unit tests (indicators + engine)
npm run backtest    # 90-day paper backtest, deterministic (seed 42)
npm run backtest -- --seed 7 --days 30 --out reports/seed7
npm run live        # live paper trading: polls CoinGecko every 60s
npm run mcp         # MCP server on stdio — 85 OOBE Synapse tools
```

No `.env`, no keys, no wallet needed. `npm run live` only ever *reads*
public prices.

## MCP

`npm run mcp` starts the OOBE `SynapseMcpServer` (stdio) with the
`SynapseAgentKit` — Token (22), DeFi (43) and Misc (20) plugins, 85 tools
across 19 Solana protocols (Jupiter, Raydium, Orca, Meteora, Drift, Adrena,
Metaplex, Pyth, CoinGecko, SNS, …). Verify with any MCP client:

```json
{"jsonrpc": "2.0", "id": 1, "method": "initialize",
 "params": {"protocolVersion": "2024-11-05", "capabilities": {},
 "clientInfo": {"name": "smoke", "version": "0.1"}}}
```

then `tools/list` returns the 85 tools. (Note: in SDK 2.0.6 the SSE
transport `startSse` is private, so this repo ships stdio only.)

## Project layout

```
src/
  config.ts      strategy + risk parameters (single source of truth)
  indicators.ts  SMA / RSI / ATR (pure, unit-tested)
  feed.ts        mock feed (seeded) + CoinGecko live prices
  engine.ts      strategy, risk manager, paper broker, backtest runner
  cli.ts         backtest | live | mcp
  mcp.ts         SynapseAgentKit + SynapseMcpServer wiring
test/            node:test suites (run against dist/)
scripts/
  gen-dashboard.ts  builds docs/ from reports/backtest.json
docs/            GitHub Pages dashboard (index.html + data/)
reports/         backtest.json / backtest.md (generated)
```

## What this is NOT (honest scope)

- **Not a Steve Capital deployment.** Deploying a funded agent on
  [Steve Capital](https://steve.oobeprotocol.ai/) and earning Arena XP
  requires a funded agent wallet (min. 20 USDC per the bounty) and a
  Steve Capital account — real money, out of scope for this repo. The
  agent here is the strategy + execution engine a funded deployment
  would run; its paper results are the evidence.
- **Not financial advice.** Simulated past performance on simulated
  data is not a promise of future results.
- **Not a trading bot that touches mainnet.** There is no signing code,
  no key handling, and no `sendTransaction` anywhere in this repo.

## License

MIT. See [LICENSE](LICENSE).
