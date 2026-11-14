/**
 * CLI for the Steve Momentum agent.
 *
 *   node dist/cli.js backtest [--days 90] [--seed 42] [--out reports/]
 *   node dist/cli.js live [--interval-ms 60000] [--bars 5m|1h]
 *   node dist/cli.js mcp [--port 3001]
 *
 * Everything is paper trading. No private keys, no signing, no real funds.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { DEFAULT_CONFIG, type Bar } from './config.js';
import { generateMockBars, fetchCoinGeckoSolPrice } from './feed.js';
import { equityOf, runBacktest, summarize } from './engine.js';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function cmdBacktest(): Promise<void> {
  const days = Number(arg('--days', '90'));
  const seed = Number(arg('--seed', '42'));
  const outDir = arg('--out', 'reports');
  const bars = days * 24;
  const startTime = Date.now() - bars * 3_600_000;
  const cfg = { ...DEFAULT_CONFIG };
  const feed = generateMockBars({
    seed,
    startPrice: 72,
    bars,
    hourlyVol: 0.012,
    startTime,
  });
  const st = runBacktest(feed, cfg);
  const lastPrice = feed[feed.length - 1].close;
  const summary = summarize(st, cfg, lastPrice);
  const buyHold = ((lastPrice - feed[0].open) / feed[0].open) * 100;
  // Buy & hold max drawdown over the same bars (honest comparison).
  let bhPeak = feed[0].open;
  let bhMaxDd = 0;
  for (const b of feed) {
    if (b.close > bhPeak) bhPeak = b.close;
    const dd = (bhPeak - b.close) / bhPeak;
    if (dd > bhMaxDd) bhMaxDd = dd;
  }

  console.log('=== Steve Momentum — backtest (paper, mock feed) ===');
  console.log(`pair            : ${cfg.pair} (long/flat momentum, SMA ${cfg.fastPeriod}/${cfg.slowPeriod} + RSI ${cfg.rsiPeriod})`);
  console.log(`bars            : ${bars} hourly bars (${days} days), seed ${seed}, start $${feed[0].open.toFixed(2)} -> $${lastPrice.toFixed(2)}`);
  console.log(`starting capital: $${cfg.startingCapitalUsdc.toFixed(2)} USDC (paper)`);
  console.log(`final equity    : $${summary.finalEquityUsdc.toFixed(2)} USDC`);
  console.log(`total return    : ${summary.totalReturnPct.toFixed(2)}%  (buy & hold: ${buyHold.toFixed(2)}%, B&H max DD ${(bhMaxDd * 100).toFixed(2)}%)`);
  console.log(`trades          : ${summary.trades} (wins ${summary.wins}, losses ${summary.losses}, win rate ${summary.winRatePct.toFixed(1)}%)`);
  console.log(`profit factor   : ${Number.isFinite(summary.profitFactor) ? summary.profitFactor.toFixed(2) : 'inf'}`);
  console.log(`max drawdown    : ${summary.maxDrawdownPct.toFixed(2)}% (breaker at ${cfg.maxDrawdown * 100}%, trips ${summary.breakerTrips})`);
  console.log(`fees paid       : $${summary.totalFeesUsdc.toFixed(2)} (paper)`);
  console.log(`blocked entries : ${summary.blockedEntries} (risk controls)`);
  console.log(`breaker trips   : ${summary.breakerTrips} (48h cooldown each; currently halted: ${summary.halted})`);
  console.log(`open position   : ${summary.openPosition}`);
  console.log('--- trades ---');
  for (const t of st.trades) {
    console.log(
      `  ${new Date(t.entryTime).toISOString().slice(0, 10)} $${t.entryPrice.toFixed(2)} -> ` +
        `${new Date(t.exitTime).toISOString().slice(0, 10)} $${t.exitPrice.toFixed(2)} ` +
        `qty ${t.qty.toFixed(3)} net ${t.netPnlUsdc >= 0 ? '+' : ''}$${t.netPnlUsdc.toFixed(2)} (${t.exitReason}, ${t.barsHeld} bars)`,
    );
  }

  mkdirSync(outDir, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'paper-backtest',
    feed: { type: 'mock', seed, bars, days, hourlyVol: 0.012, startPrice: 72 },
    config: cfg,
    summary,
    buyHoldReturnPct: buyHold,
    buyHoldMaxDrawdownPct: bhMaxDd * 100,
    equityCurve: st.equityCurve,
    trades: st.trades,
  };
  writeFileSync(`${outDir}/backtest.json`, JSON.stringify(report, null, 2));
  const md = [
    '# Steve Momentum — backtest report (paper trading)',
    '',
    `Generated: ${report.generatedAt} | Feed: deterministic mock, seed ${seed}, ${bars} hourly bars (${days} days)`,
    '',
    `- Starting capital: $${cfg.startingCapitalUsdc} USDC (paper)`,
    `- Final equity: $${summary.finalEquityUsdc.toFixed(2)} USDC`,
    `- Total return: ${summary.totalReturnPct.toFixed(2)}% (buy & hold: ${buyHold.toFixed(2)}%, B&H max DD ${(bhMaxDd * 100).toFixed(2)}%)`,
    `- Trades: ${summary.trades} — wins ${summary.wins}, losses ${summary.losses}, win rate ${summary.winRatePct.toFixed(1)}%`,
    `- Profit factor: ${Number.isFinite(summary.profitFactor) ? summary.profitFactor.toFixed(2) : 'inf'}`,
    `- Max drawdown: ${summary.maxDrawdownPct.toFixed(2)}% (breaker trips: ${summary.breakerTrips}, 48h cooldown each)`,
    '',
    '## Trades',
    '',
    '| Entry | Exit | Entry $ | Exit $ | Qty | Net PnL $ | Reason |',
    '|---|---|---|---|---|---|---|',
    ...st.trades.map(
      (t) =>
        `| ${new Date(t.entryTime).toISOString().slice(0, 10)} | ${new Date(t.exitTime).toISOString().slice(0, 10)} | ${t.entryPrice.toFixed(2)} | ${t.exitPrice.toFixed(2)} | ${t.qty.toFixed(3)} | ${t.netPnlUsdc.toFixed(2)} | ${t.exitReason} |`,
    ),
    '',
    '_Paper trading only. No real funds, no private keys, no on-chain transactions._',
    '',
  ].join('\n');
  writeFileSync(`${outDir}/backtest.md`, md);
  console.log(`\nreport written: ${outDir}/backtest.json, ${outDir}/backtest.md`);
}

async function cmdLive(): Promise<void> {
  const intervalMs = Number(arg('--interval-ms', '60000'));
  console.log('=== Steve Momentum — LIVE paper trading (read-only prices) ===');
  console.log('Mode: paper only. Prices from CoinGecko public API, fallback to mock feed.');
  console.log(`Poll interval: ${intervalMs}ms. Press Ctrl+C to stop.`);
  console.log('No private keys are loaded. No transactions are sent. Ever.');
  // Live loop: poll price, build 5-minute bars, run the strategy incrementally.
  // For the demo we keep it simple and robust: maintain a rolling bar series
  // in memory and re-run the engine over the full series each poll.
  const cfg = { ...DEFAULT_CONFIG };
  const bars: Bar[] = [];
  let mockPrice = 72;
  let mockTime = Date.now();
  const rand = (() => {
    let s = 123456789;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  })();
  // Seed 49 bars of history from the mock generator so indicators warm up.
  const seedBars = generateMockBars({ seed: 7, startPrice: 72, bars: 49, hourlyVol: 0.012, startTime: Date.now() - 49 * 300_000 });
  for (const b of seedBars) bars.push({ ...b, time: Date.now() - (49 - seedBars.indexOf(b)) * 300_000 });
  const tick = async () => {
    let price: number;
    let source = 'coingecko';
    try {
      const p = await fetchCoinGeckoSolPrice();
      price = p.priceUsdc;
    } catch {
      source = 'mock';
      mockPrice = mockPrice * Math.exp((rand() - 0.5) * 0.01);
      price = mockPrice;
    }
    const now = Date.now();
    const last = bars[bars.length - 1];
    if (now - last.time >= 300_000 || bars.length === 0) {
      bars.push({ time: now, open: price, high: price, low: price, close: price, volume: 0 });
    } else {
      last.close = price;
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
    }
    if (bars.length > 400) bars.splice(0, bars.length - 400);
    const st = runBacktest(bars, cfg);
    const eq = equityOf(st, price);
    const pos = st.position
      ? `LONG ${st.position.qty.toFixed(3)} SOL @ $${st.position.entryPrice.toFixed(2)} (stop $${st.position.stopPrice.toFixed(2)}, TP $${st.position.takeProfitPrice.toFixed(2)})`
      : 'FLAT';
    console.log(
      `[${new Date(now).toISOString().slice(11, 19)}] SOL $${price.toFixed(2)} (${source}) | equity $${eq.toFixed(2)} | ${pos} | trades ${st.trades.length} | halted ${st.risk.halted}`,
    );
    void mockTime;
  };
  await tick();
  setInterval(() => void tick(), intervalMs);
}

const cmd = process.argv[2];
if (cmd === 'backtest') await cmdBacktest();
else if (cmd === 'live') await cmdLive();
else if (cmd === 'mcp') {
  const { runMcpServer } = await import('./mcp.js');
  await runMcpServer(Number(arg('--port', '0')));
} else {
  console.log('usage: node dist/cli.js <backtest|live|mcp> [options]');
  console.log('  backtest [--days 90] [--seed 42] [--out reports]');
  console.log('  live [--interval-ms 60000]');
  console.log('  mcp [--port 0]  (0 = stdio transport)');
  process.exit(1);
}
