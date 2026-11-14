/**
 * Strategy + risk manager + paper broker.
 *
 * Strategy (v1 "Momentum Rider", long/flat only):
 *   LONG  when fast SMA > slow SMA and RSI > rsiLongThreshold
 *   FLAT  when fast SMA < slow SMA or RSI < rsiExitThreshold
 *
 * Risk manager (hard guardrails, checked before every order):
 *   - position sizing: risk `riskPerTrade` of capital, stop at `stopAtr` x ATR
 *   - max position `maxPositionFraction` of capital
 *   - daily loss limit `dailyLossLimit` (halt new entries for the day)
 *   - max drawdown `maxDrawdown` from peak equity (circuit breaker: flatten + halt)
 *
 * Paper broker: simulated fills at the bar close with fee + slippage.
 * No keys, no signing, no chain calls. The broker is deliberately boring:
 * it can only lose paper money.
 */
import { atr, rsi, sma } from './indicators.js';
import type {
  Bar,
  ClosedTrade,
  Fill,
  Position,
  StrategyConfig,
} from './config.js';

export type Signal = 'long' | 'flat';

/** Pure signal function: what should the agent want at bar `i`? */
export function signalAt(
  closes: number[],
  highs: number[],
  lows: number[],
  cfg: StrategyConfig,
  i: number,
): { signal: Signal; fast: number | null; slow: number | null; rsi: number | null; atr: number | null } {
  const fast = sma(closes, cfg.fastPeriod, i);
  const slow = sma(closes, cfg.slowPeriod, i);
  const r = rsi(closes, cfg.rsiPeriod, i);
  const a = atr(highs, lows, closes, cfg.atrPeriod, i);
  if (fast === null || slow === null || r === null) {
    return { signal: 'flat', fast, slow, rsi: r, atr: a };
  }
  const signal: Signal = fast > slow && r > cfg.rsiLongThreshold ? 'long' : 'flat';
  return { signal, fast, slow, rsi: r, atr: a };
}

export interface RiskState {
  /** Peak equity seen (USDC). */
  peakEquityUsdc: number;
  /** Equity at the start of the current UTC day (USDC). */
  dayStartEquityUsdc: number;
  /** Current UTC day string (YYYY-MM-DD). */
  dayKey: string;
  /** Circuit breaker latched. */
  halted: boolean;
  haltReason: string | null;
  /** Breaker auto-resets at this time (ms); 0 = not halted. */
  haltUntilMs: number;
  /** How many times the breaker has tripped. */
  breakerTrips: number;
}

export function newRiskState(startingCapitalUsdc: number, dayKey: string): RiskState {
  return {
    peakEquityUsdc: startingCapitalUsdc,
    dayStartEquityUsdc: startingCapitalUsdc,
    dayKey,
    halted: false,
    haltReason: null,
    haltUntilMs: 0,
    breakerTrips: 0,
  };
}

export function dayKeyOf(timeMs: number): string {
  return new Date(timeMs).toISOString().slice(0, 10);
}

/**
 * Size a new long: risk `riskPerTrade` of equity, stop `stopAtr` x ATR below
 * entry. Returns quantity of SOL (0 when the trade is not allowed).
 */
export function sizePosition(
  cfg: StrategyConfig,
  equityUsdc: number,
  entryPrice: number,
  atrValue: number,
): { qty: number; stopPrice: number; takeProfitPrice: number; riskUsdc: number } {
  const riskUsdc = equityUsdc * cfg.riskPerTrade;
  const stopDistance = cfg.stopAtr * atrValue;
  const qtyByRisk = riskUsdc / stopDistance;
  const qtyByCap = (equityUsdc * cfg.maxPositionFraction) / entryPrice;
  const qty = Math.min(qtyByRisk, qtyByCap);
  return {
    qty: Math.max(0, qty),
    stopPrice: entryPrice - stopDistance,
    takeProfitPrice: entryPrice + cfg.takeProfitAtr * atrValue,
    riskUsdc,
  };
}

export interface EngineState {
  cashUsdc: number;
  position: Position | null;
  fills: Fill[];
  trades: ClosedTrade[];
  equityCurve: { time: number; equityUsdc: number }[];
  risk: RiskState;
  /** Bars processed. */
  barsSeen: number;
  /** Entries blocked by risk controls (audit). */
  blockedEntries: { time: number; reason: string }[];
}

/** Run the strategy over a full bar series (backtest). Mutates nothing outside. */
export function runBacktest(bars: Bar[], cfg: StrategyConfig): EngineState {
  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const st: EngineState = {
    cashUsdc: cfg.startingCapitalUsdc,
    position: null,
    fills: [],
    trades: [],
    equityCurve: [],
    risk: newRiskState(cfg.startingCapitalUsdc, bars.length ? dayKeyOf(bars[0].time) : ''),
    barsSeen: 0,
    blockedEntries: [],
  };

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    // --- daily rollover ---
    const key = dayKeyOf(bar.time);
    if (key !== st.risk.dayKey) {
      st.risk.dayKey = key;
      st.risk.dayStartEquityUsdc = equityOf(st, bar.close);
    }
    // --- manage open position: stop / take-profit checked on the bar range ---
    if (st.position) {
      const p = st.position;
      let exitPrice: number | null = null;
      let reason = '';
      if (bar.low <= p.stopPrice) {
        exitPrice = Math.max(bar.low, p.stopPrice * (1 - cfg.slippageRate));
        reason = 'stop-loss';
      } else if (bar.high >= p.takeProfitPrice) {
        exitPrice = Math.min(bar.high, p.takeProfitPrice * (1 - cfg.slippageRate));
        reason = 'take-profit';
      }
      if (exitPrice !== null) {
        closePosition(st, cfg, bar, i, exitPrice, reason);
      }
    }
    // --- signal at close ---
    const { signal, atr: atrValue } = signalAt(closes, highs, lows, cfg, i);
    const equity = equityOf(st, bar.close);
    // --- risk: drawdown breaker (48h cooldown, then resume from current equity) ---
    if (st.risk.halted && bar.time >= st.risk.haltUntilMs) {
      st.risk.halted = false;
      st.risk.haltReason = null;
      st.risk.haltUntilMs = 0;
      st.risk.peakEquityUsdc = equity;
    }
    if (!st.risk.halted && equity > st.risk.peakEquityUsdc) st.risk.peakEquityUsdc = equity;
    if (!st.risk.halted && st.risk.peakEquityUsdc > 0) {
      const dd = (st.risk.peakEquityUsdc - equity) / st.risk.peakEquityUsdc;
      if (dd >= cfg.maxDrawdown) {
        st.risk.halted = true;
        st.risk.haltReason = `max drawdown ${(dd * 100).toFixed(2)}% >= ${(cfg.maxDrawdown * 100).toFixed(0)}%`;
        st.risk.haltUntilMs = bar.time + 48 * 3_600_000; // 48h cooldown
        st.risk.breakerTrips++;
        if (st.position) closePosition(st, cfg, bar, i, bar.close, 'drawdown-breaker');
      }
    }
    const dayLoss = st.risk.dayStartEquityUsdc - equity;
    const dayLimitHit = dayLoss >= cfg.dailyLossLimit * cfg.startingCapitalUsdc;
    // --- entries / signal exits ---
    if (!st.position && signal === 'long' && atrValue !== null && atrValue > 0) {
      if (st.risk.halted) {
        st.blockedEntries.push({ time: bar.time, reason: `halted: ${st.risk.haltReason}` });
      } else if (dayLimitHit) {
        st.blockedEntries.push({ time: bar.time, reason: 'daily-loss-limit' });
      } else {
        const sizing = sizePosition(cfg, equity, bar.close, atrValue);
        if (sizing.qty > 0) openPosition(st, cfg, bar, i, sizing);
      }
    } else if (st.position && signal === 'flat') {
      closePosition(st, cfg, bar, i, bar.close, 'signal-flip');
    }
    st.equityCurve.push({ time: bar.time, equityUsdc: equityOf(st, bar.close) });
    st.barsSeen++;
  }
  // Close any open position at the last bar (mark-to-market for reporting).
  return st;
}

export function equityOf(st: EngineState, price: number): number {
  return st.cashUsdc + (st.position ? st.position.qty * price : 0);
}

function openPosition(
  st: EngineState,
  cfg: StrategyConfig,
  bar: Bar,
  i: number,
  sizing: { qty: number; stopPrice: number; takeProfitPrice: number; riskUsdc: number },
): void {
  const fillPrice = bar.close * (1 + cfg.slippageRate);
  const notional = sizing.qty * fillPrice;
  const fee = notional * cfg.feeRate;
  st.cashUsdc -= notional + fee;
  st.position = {
    side: 'long',
    entryPrice: fillPrice,
    qty: sizing.qty,
    stopPrice: sizing.stopPrice,
    takeProfitPrice: sizing.takeProfitPrice,
    riskUsdc: sizing.riskUsdc,
    entryTime: bar.time,
    entryBar: i,
  };
  st.fills.push({
    time: bar.time,
    bar: i,
    action: 'BUY',
    price: fillPrice,
    qty: sizing.qty,
    notionalUsdc: notional,
    feeUsdc: fee,
    reason: 'signal-long',
  });
}

function closePosition(
  st: EngineState,
  cfg: StrategyConfig,
  bar: Bar,
  i: number,
  exitPrice: number,
  reason: string,
): void {
  const p = st.position;
  if (!p) return;
  const sellPrice = exitPrice * (1 - cfg.slippageRate);
  const notional = p.qty * sellPrice;
  const fee = notional * cfg.feeRate;
  st.cashUsdc += notional - fee;
  const grossPnl = p.qty * (sellPrice - p.entryPrice);
  const buyFee = st.fills.filter((f) => f.action === 'BUY').slice(-1)[0]?.feeUsdc ?? 0;
  st.trades.push({
    entryTime: p.entryTime,
    exitTime: bar.time,
    entryPrice: p.entryPrice,
    exitPrice: sellPrice,
    qty: p.qty,
    grossPnlUsdc: grossPnl,
    feesUsdc: buyFee + fee,
    netPnlUsdc: grossPnl - buyFee - fee,
    returnPct: (sellPrice - p.entryPrice) / p.entryPrice,
    exitReason: reason,
    barsHeld: i - p.entryBar,
  });
  st.fills.push({
    time: bar.time,
    bar: i,
    action: 'SELL',
    price: sellPrice,
    qty: p.qty,
    notionalUsdc: notional,
    feeUsdc: fee,
    reason,
  });
  st.position = null;
}

/** Summary metrics for a finished run. */
export function summarize(st: EngineState, cfg: StrategyConfig, lastPrice: number) {
  const finalEquity = equityOf(st, lastPrice);
  const totalReturn = (finalEquity - cfg.startingCapitalUsdc) / cfg.startingCapitalUsdc;
  const wins = st.trades.filter((t) => t.netPnlUsdc > 0);
  const losses = st.trades.filter((t) => t.netPnlUsdc <= 0);
  const grossWin = wins.reduce((s, t) => s + t.netPnlUsdc, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnlUsdc, 0));
  let peak = cfg.startingCapitalUsdc;
  let maxDd = 0;
  for (const p of st.equityCurve) {
    if (p.equityUsdc > peak) peak = p.equityUsdc;
    const dd = (peak - p.equityUsdc) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  const totalFees = st.fills.reduce((s, f) => s + f.feeUsdc, 0);
  return {
    startingCapitalUsdc: cfg.startingCapitalUsdc,
    finalEquityUsdc: finalEquity,
    totalReturnPct: totalReturn * 100,
    trades: st.trades.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: st.trades.length ? (wins.length / st.trades.length) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDrawdownPct: maxDd * 100,
    totalFeesUsdc: totalFees,
    blockedEntries: st.blockedEntries.length,
    halted: st.risk.halted,
    haltReason: st.risk.haltReason,
    breakerTrips: st.risk.breakerTrips,
    openPosition: st.position !== null,
  };
}
