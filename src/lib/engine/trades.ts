import type { Trade } from './types';
import { daysBetween, taxYearOf } from './dates';
import { sum } from './money';

export function realizedGain(t: Trade): number {
  return t.proceeds - t.costBasis;
}

export function realizedPct(t: Trade): number {
  return t.costBasis === 0 ? 0 : realizedGain(t) / t.costBasis;
}

/** Per-share buy price for this close — cost basis ÷ shares. Null when the
 * share count wasn't recorded (trades closed before the shares column). */
export function tradeBuyPrice(t: Trade): number | null {
  return t.shares && t.shares > 0 ? t.costBasis / t.shares : null;
}

/** Per-share sell price — proceeds ÷ shares. Net of sell-side fees, so it
 * matches the recorded gain. Null when the share count is unknown. */
export function tradeSellPrice(t: Trade): number | null {
  return t.shares && t.shares > 0 ? t.proceeds / t.shares : null;
}

export function tradeDaysHeld(t: Trade): number {
  return daysBetween(t.openDate, t.closeDate);
}

export function stLt(t: Trade): 'ST' | 'LT' {
  return tradeDaysHeld(t) > 365 ? 'LT' : 'ST';
}

export function tradeTaxYear(t: Trade): number {
  return taxYearOf(t.closeDate);
}

export interface TradeStats {
  count: number;
  wins: number;
  losses: number;
  /** Wins / count; breakeven trades count as neither win nor loss. */
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  /** avgWin / |avgLoss| — how much a winner pays for each loser. */
  payoff: number | null;
  avgHoldDays: number | null;
  best: Trade | null;
  worst: Trade | null;
}

/** Know thyself: the pattern behind the closed trades. All trades count —
 * the wash flag is a tax matter, not a performance one. */
export function tradeStats(trades: Trade[]): TradeStats {
  if (trades.length === 0) {
    return {
      count: 0, wins: 0, losses: 0, winRate: null, avgWin: null, avgLoss: null,
      avgWinPct: null, avgLossPct: null, payoff: null, avgHoldDays: null, best: null, worst: null,
    };
  }
  const winners = trades.filter((t) => realizedGain(t) > 0);
  const losers = trades.filter((t) => realizedGain(t) < 0);
  const avg = (xs: number[]) => (xs.length > 0 ? sum(xs) / xs.length : null);
  const avgWin = avg(winners.map(realizedGain));
  const avgLoss = avg(losers.map(realizedGain));
  const byGain = [...trades].sort((a, b) => realizedGain(a) - realizedGain(b));
  return {
    count: trades.length,
    wins: winners.length,
    losses: losers.length,
    winRate: winners.length + losers.length > 0 ? winners.length / trades.length : null,
    avgWin,
    avgLoss,
    avgWinPct: avg(winners.map(realizedPct)),
    avgLossPct: avg(losers.map(realizedPct)),
    payoff: avgWin != null && avgLoss != null && avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : null,
    avgHoldDays: avg(trades.map(tradeDaysHeld)),
    best: byGain[byGain.length - 1] ?? null,
    worst: byGain[0] ?? null,
  };
}

/** Net realized for a tax year, excluding wash-sale-disallowed losses. */
export function netRealizedYTD(trades: Trade[], year: number, asOf?: string): number {
  return sum(
    trades
      .filter(
        (t) =>
          tradeTaxYear(t) === year && !t.washSale && (asOf === undefined || t.closeDate <= asOf),
      )
      .map(realizedGain),
  );
}
