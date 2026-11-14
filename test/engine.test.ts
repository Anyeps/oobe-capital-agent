/** Unit tests for the strategy engine (node:test). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../dist/config.js';
import { generateMockBars } from '../dist/feed.js';
import { equityOf, runBacktest, signalAt, sizePosition, summarize } from '../dist/engine.js';

function bars(n: number, seed = 1) {
  return generateMockBars({ seed, startPrice: 100, bars: n, hourlyVol: 0.01, startTime: 1_700_000_000_000 });
}

test('mock feed is deterministic for the same seed', () => {
  const a = bars(100, 42);
  const b = bars(100, 42);
  assert.deepEqual(a, b);
  const c = bars(100, 43);
  assert.notDeepEqual(a, c);
});

test('engine: never loses more than the account on a 90-day run', () => {
  const feed = bars(90 * 24, 42);
  const st = runBacktest(feed, DEFAULT_CONFIG);
  const eq = equityOf(st, feed[feed.length - 1].close);
  assert.ok(eq > 0, `equity=${eq}`);
  assert.ok(st.trades.length > 0, 'should have traded');
  // every closed trade's exit must come after its entry
  for (const t of st.trades) assert.ok(t.exitTime > t.entryTime);
});

test('engine: fees are always charged and positions respect the cap', () => {
  const feed = bars(90 * 24, 7);
  const st = runBacktest(feed, DEFAULT_CONFIG);
  assert.ok(st.fills.every((f) => f.feeUsdc > 0));
  // Sizing caps each position at 25% of *current* equity, so compare
  // against peak equity, not starting capital.
  const peakEquity = Math.max(...st.equityCurve.map((p) => p.equityUsdc));
  const maxNotional = Math.max(...st.fills.map((f) => f.notionalUsdc), 0);
  assert.ok(maxNotional <= peakEquity * DEFAULT_CONFIG.maxPositionFraction * 1.05,
    `maxNotional=${maxNotional} peakEquity=${peakEquity}`);
});

test('sizePosition: risks ~1% of equity with a 2x ATR stop', () => {
  const s = sizePosition(DEFAULT_CONFIG, 1000, 100, 2);
  // risk $10, stop distance $4 -> qty 2.5 SOL, notional $250 = 25% cap
  assert.ok(Math.abs(s.qty - 2.5) < 1e-9, `qty=${s.qty}`);
  assert.equal(s.stopPrice, 96);
  assert.equal(s.takeProfitPrice, 106);
});

test('summarize: metrics are internally consistent', () => {
  const feed = bars(90 * 24, 42);
  const st = runBacktest(feed, DEFAULT_CONFIG);
  const m = summarize(st, DEFAULT_CONFIG, feed[feed.length - 1].close);
  assert.equal(m.trades, st.trades.length);
  assert.equal(m.wins + m.losses, st.trades.length);
  assert.ok(m.maxDrawdownPct >= 0 && m.maxDrawdownPct <= 100);
});

test('signalAt: flat when there is not enough history', () => {
  const feed = bars(10, 1);
  const closes = feed.map((b) => b.close);
  const s = signalAt(closes, feed.map((b) => b.high), feed.map((b) => b.low), DEFAULT_CONFIG, 5);
  assert.equal(s.signal, 'flat');
});
