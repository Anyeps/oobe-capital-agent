/**
 * Price feeds.
 *
 * - MockFeed: deterministic seeded random-walk with regime shifts (uptrend /
 *   downtrend / range). Used for backtests so results are reproducible.
 * - CoinGeckoFeed: live SOL/USDC price from the public CoinGecko API
 *   (no key, read-only). Used by live paper-trading mode.
 * - Feed selection is explicit: backtest always uses MockFeed; live mode
 *   tries CoinGecko and falls back to MockFeed with a loud warning.
 */
import type { Bar } from './config.js';

/** mulberry32 — tiny deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Regime = 'up' | 'down' | 'range';

export interface MockFeedOptions {
  seed: number;
  /** Starting price in USDC. */
  startPrice: number;
  /** Number of hourly bars to generate. */
  bars: number;
  /** Hourly volatility (std dev of log returns), e.g. 0.012 = 1.2%/h. */
  hourlyVol: number;
  /** Start time (unix ms) of the first bar. */
  startTime: number;
}

/**
 * Generate hourly OHLC bars. Regimes rotate every ~14 days:
 * up (+0.15%/h drift), down (-0.12%/h), range (0 drift), which gives the
 * momentum strategy both trending and choppy stretches to prove itself in.
 */
export function generateMockBars(opts: MockFeedOptions): Bar[] {
  const rand = mulberry32(opts.seed);
  const bars: Bar[] = [];
  const regimeLen = 14 * 24; // ~14 days of hourly bars
  const regimes: Regime[] = ['up', 'range', 'down', 'range', 'up', 'down', 'range', 'up'];
  let price = opts.startPrice;
  for (let i = 0; i < opts.bars; i++) {
    const regime = regimes[Math.floor(i / regimeLen) % regimes.length];
    const drift = regime === 'up' ? 0.0015 : regime === 'down' ? -0.0012 : 0;
    const shock = (rand() + rand() + rand() - 1.5) / 1.5; // approx normal in [-1, 1]
    const ret = drift + opts.hourlyVol * shock;
    const open = price;
    const close = open * Math.exp(ret);
    const high = Math.max(open, close) * (1 + Math.abs(rand() - 0.5) * opts.hourlyVol * 0.8);
    const low = Math.min(open, close) * (1 - Math.abs(rand() - 0.5) * opts.hourlyVol * 0.8);
    const volume = 800 + rand() * 2400; // mock SOL volume
    bars.push({
      time: opts.startTime + i * 3_600_000,
      open,
      high,
      low,
      close,
      volume,
    });
    price = close;
  }
  return bars;
}

export interface LivePrice {
  symbol: string;
  priceUsdc: number;
  fetchedAt: number;
  source: 'coingecko' | 'mock';
}

/** Fetch SOL/USDC from CoinGecko public API (no key). Throws on failure. */
export async function fetchCoinGeckoSolPrice(): Promise<LivePrice> {
  const url =
    'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd';
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const data = (await res.json()) as { solana?: { usd?: number } };
  const price = data?.solana?.usd;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    throw new Error('CoinGecko returned no SOL price');
  }
  return { symbol: 'SOL/USDC', priceUsdc: price, fetchedAt: Date.now(), source: 'coingecko' };
}
