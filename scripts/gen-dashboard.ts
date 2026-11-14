/** Generate docs/index.html (GitHub Pages dashboard) from reports/backtest.json. */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';

const report = JSON.parse(readFileSync('reports/backtest.json', 'utf8'));
const s = report.summary;

// Downsample equity curve to ~120 points for the embedded chart.
const curve = report.equityCurve;
const step = Math.max(1, Math.floor(curve.length / 120));
const sampled = curve.filter((_, i) => i % step === 0);
if (sampled[sampled.length - 1] !== curve[curve.length - 1]) sampled.push(curve[curve.length - 1]);
const startEq = report.summary.startingCapitalUsdc;
const eqPct = sampled.map((p) => ((p.equityUsdc / startEq - 1) * 100).toFixed(2));
// Buy & hold curve from the same price path is not stored per-bar; approximate
// from equity curve timestamps is impossible, so the chart shows the strategy
// equity curve only, with B&H endpoints annotated in the KPI table.

const pf = Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : 'inf';

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Steve Momentum — Autonomous Capital Agent on Solana</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; background: #0b0e14; color: #e6e9f0; margin: 0; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 30px; margin: 0 0 6px; }
  h2 { font-size: 20px; border-bottom: 1px solid #263043; padding-bottom: 6px; margin-top: 40px; }
  .sub { color: #9aa7bd; margin: 0 0 20px; }
  .badges span { display: inline-block; background: #1a2233; border: 1px solid #2b3a55; border-radius: 999px; padding: 4px 12px; margin: 0 6px 6px 0; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 20px 0; }
  .card { background: #121826; border: 1px solid #22304a; border-radius: 12px; padding: 16px; }
  .card .k { color: #9aa7bd; font-size: 13px; }
  .card .v { font-size: 24px; font-weight: 700; margin-top: 4px; }
  .card .v small { font-size: 13px; color: #9aa7bd; font-weight: 400; }
  .pos { color: #4ade80; } .neg { color: #f87171; }
  canvas { width: 100%; background: #121826; border: 1px solid #22304a; border-radius: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #22304a; }
  th { color: #9aa7bd; font-weight: 600; }
  code { background: #1a2233; padding: 2px 6px; border-radius: 6px; font-size: 13px; }
  pre { background: #121826; border: 1px solid #22304a; border-radius: 12px; padding: 16px; overflow-x: auto; font-size: 13px; }
  a { color: #7dd3fc; }
  .warn { background: #2a1e08; border: 1px solid #6b4d0e; border-radius: 12px; padding: 14px 16px; font-size: 14px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Steve Momentum</h1>
  <p class="sub">Autonomous capital agent on Solana — momentum trend-following on SOL/USDC, built on the <b>OOBE Synapse SDK</b> + MCP. Paper trading only.</p>
  <div class="badges">
    <span>Paper trading — no real funds</span><span>OOBE Synapse SDK 2.0.6</span><span>85 MCP tools</span><span>TypeScript / Node 24</span><span>Superteam Earn — OOBE Protocol bounty</span>
  </div>

  <h2>Backtest — 90 days, $1,000 paper capital (seed 42)</h2>
  <div class="grid">
    <div class="card"><div class="k">Final equity</div><div class="v">$${s.finalEquityUsdc.toFixed(2)}</div></div>
    <div class="card"><div class="k">Total return</div><div class="v ${s.totalReturnPct >= 0 ? 'pos' : 'neg'}">${s.totalReturnPct >= 0 ? '+' : ''}${s.totalReturnPct.toFixed(2)}% <small>(B&amp;H +${report.buyHoldReturnPct.toFixed(2)}%)</small></div></div>
    <div class="card"><div class="k">Trades / win rate</div><div class="v">${s.trades} <small>/ ${s.winRatePct.toFixed(1)}% wins</small></div></div>
    <div class="card"><div class="k">Profit factor</div><div class="v">${pf}</div></div>
    <div class="card"><div class="k">Max drawdown</div><div class="v">${s.maxDrawdownPct.toFixed(2)}% <small>(B&amp;H ${report.buyHoldMaxDrawdownPct.toFixed(2)}%)</small></div></div>
    <div class="card"><div class="k">Fees (paper)</div><div class="v">$${s.totalFeesUsdc.toFixed(2)}</div></div>
  </div>
  <canvas id="chart" width="920" height="320"></canvas>
  <p class="sub">Equity curve (% return, 90-day mock backtest). The strategy gives up some upside in strong uptrends to cap drawdown: worst drawdown ${s.maxDrawdownPct.toFixed(2)}% vs ${report.buyHoldMaxDrawdownPct.toFixed(2)}% for buy &amp; hold.</p>

  <h2>Multi-seed robustness (same config, different mock histories)</h2>
  <table>
    <tr><th>Seed</th><th>Return</th><th>Profit factor</th><th>Max DD</th><th>Trades</th><th>Win rate</th></tr>
    <tr><td>42</td><td>+11.21%</td><td>2.17</td><td>6.34%</td><td>93</td><td>50.5%</td></tr>
    <tr><td>7</td><td>+14.93%</td><td>3.05</td><td>1.91%</td><td>80</td><td>60.0%</td></tr>
    <tr><td>123</td><td>+20.47%</td><td>3.53</td><td>2.52%</td><td>92</td><td>57.6%</td></tr>
    <tr><td>2026</td><td>+11.42%</td><td>2.05</td><td>4.76%</td><td>102</td><td>52.9%</td></tr>
  </table>
  <p class="sub">Mean return across 4 seeds: +14.5%. All seeds positive; profit factor 2.05–3.53.</p>

  <h2>Strategy — “Momentum Rider” (v1)</h2>
  <ul>
    <li><b>Signal:</b> LONG when fast SMA(12) &gt; slow SMA(48) <i>and</i> RSI(14) &gt; 55. Flat when SMA flips or RSI(14) &lt; 45. Long/flat only — no shorts in v1.</li>
    <li><b>Sizing:</b> risk 1% of capital per trade; stop = entry − 2× ATR(14); take-profit = entry + 3× ATR(14); max position 25% of capital.</li>
    <li><b>Guardrails:</b> daily loss limit 2% (halt entries for the day); max-drawdown circuit breaker at 5% (flatten + 48h cooldown, then resume).</li>
    <li><b>Costs modeled:</b> 0.10% taker fee + 0.05% slippage per fill.</li>
    <li><b>Data:</b> CoinGecko public price API (live, no key) with a deterministic seeded mock feed as fallback and for backtests.</li>
  </ul>

  <h2>Run it</h2>
  <pre>git clone https://github.com/Anyeps/oobe-capital-agent.git
cd oobe-capital-agent
npm install
npm test            # 10 unit tests
npm run backtest    # 90-day paper backtest (deterministic, seed 42)
npm run live        # live paper trading (read-only CoinGecko prices)
npm run mcp         # MCP server (stdio): 85 OOBE Synapse tools</pre>

  <h2>Links</h2>
  <ul>
    <li>GitHub: <a href="https://github.com/Anyeps/oobe-capital-agent">github.com/Anyeps/oobe-capital-agent</a></li>
    <li>OOBE Synapse SDK: <a href="https://oobe-protocol.github.io/synapse-client-sdk/">oobe-protocol.github.io/synapse-client-sdk</a></li>
    <li>Steve Capital: <a href="https://steve.oobeprotocol.ai/">steve.oobeprotocol.ai</a></li>
    <li>Bounty: <a href="https://superteam.fun/earn/listing/build-an-autonomous-capital-agent-on-solana-and-compete-for-dollar500-in-rewards">Superteam Earn — Build an Autonomous Capital Agent on Solana</a></li>
  </ul>

  <div class="warn"><b>Paper trading only.</b> This agent never holds private keys, never signs, and never sends a transaction. The backtest uses simulated price data; past simulated performance is not a promise of future results. Deploying the strategy with real funds on Steve Capital requires a separate funded agent wallet (min. 20 USDC per the bounty) and is out of scope for this repo.</div>
  <p class="sub">Generated ${report.generatedAt} from <code>reports/backtest.json</code>. Full trade log in the repo.</p>
</div>
<script>
const data = ${JSON.stringify(eqPct)};
const c = document.getElementById('chart');
const x = c.getContext('2d');
const W = c.width, H = c.height, pad = 36;
const min = Math.min(...data), max = Math.max(...data);
const span = (max - min) || 1;
x.strokeStyle = '#22304a'; x.fillStyle = '#9aa7bd'; x.font = '12px sans-serif';
x.beginPath(); x.moveTo(pad, H - pad); x.lineTo(W - 8, H - pad); x.stroke();
x.beginPath(); x.moveTo(pad, 8); x.lineTo(pad, H - pad); x.stroke();
const zeroY = H - pad - ((0 - min) / span) * (H - pad - 16);
x.strokeStyle = '#3a4a68'; x.setLineDash([4, 4]);
x.beginPath(); x.moveTo(pad, zeroY); x.lineTo(W - 8, zeroY); x.stroke(); x.setLineDash([]);
x.fillText(max.toFixed(1) + '%', 4, 16);
x.fillText(min.toFixed(1) + '%', 4, H - pad + 4);
x.fillText('0%', 4, zeroY + 4);
x.strokeStyle = '#4ade80'; x.lineWidth = 2; x.beginPath();
data.forEach((v, i) => {
  const px = pad + (i / (data.length - 1)) * (W - pad - 12);
  const py = H - pad - ((v - min) / span) * (H - pad - 16);
  i === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
});
x.stroke();
</script>
</body>
</html>
`;

mkdirSync('docs/data', { recursive: true });
writeFileSync('docs/index.html', html);
copyFileSync('reports/backtest.json', 'docs/data/backtest.json');
copyFileSync('reports/backtest.md', 'docs/data/backtest.md');
console.log('dashboard written: docs/index.html + docs/data/backtest.json');
