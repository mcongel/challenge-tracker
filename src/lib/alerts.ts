import type {
  CashEvent, LossCarryforward, MilestoneRecord, ParkedPosition, PositionLot, Trade,
} from './engine';
import {
  accountTotal, concentration, formatQuarterLabel, milestoneTable, quartersEnded, computeCheck,
  skimDueNow, type PriceMap,
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
  kind: 'MILESTONE' | 'TAX' | 'CAP' | 'TARGET';
  message: string;
  to: string;
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

export function activeAlerts(d: AlertInputs): AppAlert[] {
  const alerts: AppAlert[] = [];
  const account = accountTotal(d.lots, priceMapFor(d.lots, d.overrides, d.quotes), d.cashEvents);

  for (const hit of targetHits(d.lots, d.overrides, d.quotes)) {
    alerts.push({
      kind: 'TARGET',
      message: `${hit.ticker} crossed its ${formatCurrency(hit.target)} exit target (now ${formatCurrency(hit.price)}) — sell into strength, then rotate (Rule 8)`,
      to: '/positions',
    });
  }

  for (const row of milestoneTable(account, d.milestones)) {
    if (row.status === 'HIT_BANK_NOW') {
      alerts.push({
        kind: 'MILESTONE',
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
        message: `Tax skim due for ${formatQuarterLabel(due)} — move ${formatCurrency(due.moveOutNow)} out of play`,
        to: '/tax',
      });
    }
  }

  if (concentration(d.parked, d.concentrationCap).overCap) {
    alerts.push({
      kind: 'CAP',
      message: 'Parked pile over the Semi/AI concentration cap — trim semis first',
      to: '/parked',
    });
  }

  return alerts;
}
