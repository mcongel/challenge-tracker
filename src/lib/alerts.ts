import type {
  CashEvent, LossCarryforward, MilestoneRecord, ParkedPosition, PositionLot, Trade, WatchlistItem,
} from './engine';
import {
  accountTotal, concentration, daysBetween, formatQuarterLabel, milestoneTable, quartersEnded,
  computeCheck, skimDueNow, type PriceMap,
} from './engine';
import { formatCurrency } from './utils';

/** Price per ticker. Precedence: pinned manual override > API quote > the
 * lots' weighted avg cost (unrealized reads 0, never -100%, with no quote). */
export function priceMapFor(
  lots: PositionLot[],
  overrides: Record<string, number>,
  quotes: Record<string, number> = {},
): PriceMap {
  const map: PriceMap = { ...quotes, ...overrides };
  const byTicker = new Map<string, { shares: number; cost: number }>();
  for (const lot of lots) {
    const acc = byTicker.get(lot.ticker) ?? { shares: 0, cost: 0 };
    acc.shares += lot.shares;
    acc.cost += lot.shares * lot.avgCost;
    byTicker.set(lot.ticker, acc);
  }
  for (const [ticker, acc] of byTicker) {
    if (map[ticker] === undefined && acc.shares > 0) map[ticker] = acc.cost / acc.shares;
  }
  return map;
}

export interface AppAlert {
  kind: 'MILESTONE' | 'TAX' | 'CAP' | 'TARGET' | 'ENTRY' | 'CALENDAR';
  /** Stable episode identity (same convention as the email alerts' keys) —
   * dismissals key off this, NOT the message, whose prices move every tick.
   * An id stays dismissed only while it keeps firing; once it clears, a
   * re-cross alerts again. */
  id: string;
  message: string;
  to: string;
}

/** How many days before a lot's calendar exit the alert starts firing. */
export const CALENDAR_ALERT_DAYS = 2;

/** Calendar exits closing in (or blown past): earliest exit date per ticker
 * within CALENDAR_ALERT_DAYS, plus anything overdue. Price-independent — the
 * date is the rule. daysLeft can be negative (overdue). */
export function calendarHits(
  lots: PositionLot[],
  today: string,
): { ticker: string; exitDate: string; daysLeft: number }[] {
  const byTicker = new Map<string, string>();
  for (const lot of lots) {
    if (!lot.exitDate) continue;
    const cur = byTicker.get(lot.ticker);
    if (!cur || lot.exitDate < cur) byTicker.set(lot.ticker, lot.exitDate);
  }
  return [...byTicker.entries()]
    .map(([ticker, exitDate]) => ({
      ticker,
      exitDate,
      daysLeft: daysBetween(today, exitDate),
    }))
    .filter((h) => h.daysLeft <= CALENDAR_ALERT_DAYS);
}

interface AlertInputs {
  lots: PositionLot[];
  cashEvents: CashEvent[];
  trades: Trade[];
  milestones: MilestoneRecord[];
  parked: ParkedPosition[];
  carryforwards: LossCarryforward[];
  overrides: Record<string, number>;
  quotes?: Record<string, number>;
  concentrationCap?: number;
  /** Bench candidates — entry triggers fire the ENTRY alert. */
  watchlist?: WatchlistItem[];
  today: string;
}

/** Rule 8's moment: a live price at or past a lot's exit target. */
export function targetHits(
  lots: PositionLot[],
  overrides: Record<string, number>,
  quotes: Record<string, number> = {},
): { ticker: string; price: number; target: number }[] {
  const byTicker = new Map<string, { price: number; target: number }>();
  for (const lot of lots) {
    const price = overrides[lot.ticker] ?? quotes[lot.ticker];
    if (price === undefined || price < lot.exitTarget) continue;
    const existing = byTicker.get(lot.ticker);
    // Report the lowest crossed target per ticker — the first tripwire.
    if (!existing || lot.exitTarget < existing.target) {
      byTicker.set(lot.ticker, { price, target: lot.exitTarget });
    }
  }
  return [...byTicker.entries()].map(([ticker, v]) => ({ ticker, ...v }));
}

/** The entry-side tripwire: a live price at or below a bench candidate's
 * numeric trigger. Mirrors targetHits — the exit's twin. */
export function entryHits(
  watchlist: WatchlistItem[],
  overrides: Record<string, number>,
  quotes: Record<string, number> = {},
): { ticker: string; price: number; trigger: number }[] {
  const hits: { ticker: string; price: number; trigger: number }[] = [];
  for (const w of watchlist) {
    if (w.entryTrigger == null || w.entryTrigger <= 0) continue;
    const price = overrides[w.ticker] ?? quotes[w.ticker];
    if (price === undefined || price > w.entryTrigger) continue;
    hits.push({ ticker: w.ticker, price, trigger: w.entryTrigger });
  }
  return hits;
}

export function activeAlerts(d: AlertInputs): AppAlert[] {
  const alerts: AppAlert[] = [];
  const account = accountTotal(d.lots, priceMapFor(d.lots, d.overrides, d.quotes), d.cashEvents);

  for (const hit of entryHits(d.watchlist ?? [], d.overrides, d.quotes)) {
    alerts.push({
      kind: 'ENTRY',
      id: `entry-${hit.ticker}`,
      message: `${hit.ticker} hit your ${formatCurrency(hit.trigger)} entry trigger (now ${formatCurrency(hit.price)}) — the bench setup is live`,
      to: '/watchlist',
    });
  }

  for (const hit of targetHits(d.lots, d.overrides, d.quotes)) {
    alerts.push({
      kind: 'TARGET',
      id: `target-${hit.ticker}`,
      message: `${hit.ticker} crossed its ${formatCurrency(hit.target)} exit target (now ${formatCurrency(hit.price)}) — sell into strength, then rotate (Rule 8)`,
      to: '/positions',
    });
  }

  for (const hit of calendarHits(d.lots, d.today)) {
    const when = hit.daysLeft < 0
      ? `was ${hit.exitDate} — overdue, close it`
      : hit.daysLeft === 0
        ? 'is TODAY — out by the close'
        : `is ${hit.exitDate} (${hit.daysLeft} session${hit.daysLeft > 1 ? 's' : ''} left)`;
    alerts.push({
      kind: 'CALENDAR',
      id: `calendar-${hit.ticker}-${hit.exitDate}`,
      message: `${hit.ticker} calendar exit ${when} — the plan says never hold through the print`,
      to: '/positions',
    });
  }

  for (const row of milestoneTable(account, d.milestones)) {
    if (row.status === 'HIT_BANK_NOW') {
      alerts.push({
        kind: 'MILESTONE',
        id: `milestone-${row.level}`,
        message: `MILESTONE HIT — BANK ${formatCurrency(row.skimDue)} NOW (${formatCurrency(row.level)} crossed)`,
        to: '/milestones',
      });
    }
  }

  const firstDate = [...d.trades.map((t) => t.closeDate), ...d.cashEvents.map((e) => e.date)]
    .sort()[0];
  if (firstDate) {
    const checks = quartersEnded(firstDate, d.today).map((q) =>
      computeCheck(q, d.trades, d.cashEvents, d.carryforwards),
    );
    const due = skimDueNow(checks);
    if (due) {
      alerts.push({
        kind: 'TAX',
        id: `tax-${formatQuarterLabel(due)}`,
        message: `Tax skim due for ${formatQuarterLabel(due)} — move ${formatCurrency(due.moveOutNow)} out of play`,
        to: '/tax',
      });
    }
  }

  if (concentration(d.parked, d.concentrationCap).overCap) {
    alerts.push({
      kind: 'CAP',
      id: 'cap',
      message: 'Parked pile over the semiconductor concentration cap — trim semis first',
      to: '/parked',
    });
  }

  return alerts;
}
