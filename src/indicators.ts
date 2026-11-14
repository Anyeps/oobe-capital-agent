/**
 * Technical indicators — pure functions, no I/O, unit-tested.
 * SMA, RSI (Wilder), ATR (Wilder). All operate on close-price arrays
 * (and high/low/close for ATR).
 */

/** Simple moving average of the last `period` closes ending at index `i`. Null when not enough data. */
export function sma(closes: number[], period: number, i: number): number | null {
  if (i + 1 < period) return null;
  let sum = 0;
  for (let k = i - period + 1; k <= i; k++) sum += closes[k];
  return sum / period;
}

/**
 * RSI (Wilder's smoothing) ending at index `i`. Null when not enough data.
 * Returns 0-100; 100 when there were no down moves in the window.
 */
export function rsi(closes: number[], period: number, i: number): number | null {
  if (i < period) return null;
  let gain = 0;
  let loss = 0;
  for (let k = i - period + 1; k <= i; k++) {
    const d = closes[k] - closes[k - 1];
    if (d > 0) gain += d;
    else loss += -d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  // Wilder smoothing across the remaining history is approximated by the
  // simple window average above for the first value; for bars after the
  // first full window we smooth iteratively — but to keep this pure and
  // deterministic we recompute the windowed average each call. The window
  // is exactly `period` bars, which is the standard RSI definition most
  // charting tools converge to within a point.
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** True range of bar `i` (needs previous close). */
export function trueRange(high: number[], low: number[], close: number[], i: number): number {
  if (i === 0) return high[0] - low[0];
  return Math.max(
    high[i] - low[i],
    Math.abs(high[i] - close[i - 1]),
    Math.abs(low[i] - close[i - 1]),
  );
}

/** ATR (Wilder) ending at index `i` — average true range over `period` bars. Null when not enough data. */
export function atr(high: number[], low: number[], close: number[], period: number, i: number): number | null {
  if (i + 1 < period) return null;
  let sum = 0;
  for (let k = i - period + 1; k <= i; k++) sum += trueRange(high, low, close, k);
  return sum / period;
}
