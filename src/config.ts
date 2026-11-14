/**
 * Steve Momentum — autonomous capital agent on Solana (paper trading).
 *
 * Strategy v1 "Momentum Rider": long/flat trend-following on SOL/USDC.
 *  - Signal: fast SMA(12) crosses above slow SMA(48) AND RSI(14) > 55 -> LONG.
 *  - Exit: fast SMA crosses below slow SMA OR RSI(14) < 45, or stop / take-profit.
 *  - Risk: 1% of capital risked per trade, stop = 2x ATR(14), take-profit = 3x ATR,
 *    max position 25% of capital, daily loss limit 2%, max-drawdown breaker 5%.
 *  - Execution is PAPER ONLY: simulated fills with fee + slippage. No private
 *    keys, no signing, no real transactions, no real funds. Ever.
 *
 * Data: CoinGecko public price API (live, no key) with a deterministic
 * seeded mock feed as fallback / for backtests. OOBE Synapse SDK provides
 * the Solana tool kit + MCP server (see src/mcp.ts).
 */

export interface StrategyConfig {
  /** Trading pair, e.g. "SOL/USDC". */
  pair: string;
  /** Fast SMA period in bars. */
  fastPeriod: number;
  /** Slow SMA period in bars. */
  slowPeriod: number;
  /** RSI period in bars. */
  rsiPeriod: number;
  /** Enter long only when RSI is above this. */
  rsiLongThreshold: number;
  /** Exit when RSI falls below this. */
  rsiExitThreshold: number;
  /** ATR period in bars. */
  atrPeriod: number;
  /** Stop-loss distance in ATR multiples. */
  stopAtr: number;
  /** Take-profit distance in ATR multiples. */
  takeProfitAtr: number;
  /** Fraction of capital risked per trade (0.01 = 1%). */
  riskPerTrade: number;
  /** Max position size as fraction of capital. */
  maxPositionFraction: number;
  /** Max loss per day as fraction of starting capital; halt entries when hit. */
  dailyLossLimit: number;
  /** Max drawdown from peak equity as fraction; circuit breaker flattens + halts. */
  maxDrawdown: number;
  /** Simulated taker fee per fill (fraction of notional). */
  feeRate: number;
  /** Simulated slippage per fill (fraction of price). */
  slippageRate: number;
  /** Starting paper capital in USDC. */
  startingCapitalUsdc: number;
}

export const DEFAULT_CONFIG: StrategyConfig = {
  pair: 'SOL/USDC',
  fastPeriod: 12,
  slowPeriod: 48,
  rsiPeriod: 14,
  rsiLongThreshold: 55,
  rsiExitThreshold: 45,
  atrPeriod: 14,
  stopAtr: 2,
  takeProfitAtr: 3,
  riskPerTrade: 0.01,
  maxPositionFraction: 0.25,
  dailyLossLimit: 0.02,
  maxDrawdown: 0.05,
  feeRate: 0.001, // 0.10%
  slippageRate: 0.0005, // 0.05%
  startingCapitalUsdc: 1000,
};

/** Bar of OHLCV data (one interval of the pair). */
export interface Bar {
  /** Unix ms timestamp of bar open. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Side = 'long' | 'flat';

export interface Position {
  side: 'long';
  entryPrice: number;
  /** Quantity of SOL held. */
  qty: number;
  /** Stop-loss price. */
  stopPrice: number;
  /** Take-profit price. */
  takeProfitPrice: number;
  /** USDC risked on this trade (for sizing audit). */
  riskUsdc: number;
  entryTime: number;
  entryBar: number;
}

export interface Fill {
  time: number;
  bar: number;
  action: 'BUY' | 'SELL';
  price: number;
  qty: number;
  notionalUsdc: number;
  feeUsdc: number;
  reason: string;
}

export interface ClosedTrade {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  grossPnlUsdc: number;
  feesUsdc: number;
  netPnlUsdc: number;
  returnPct: number;
  exitReason: string;
  barsHeld: number;
}
