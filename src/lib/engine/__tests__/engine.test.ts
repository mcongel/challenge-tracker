/** Edge cases the workbook doesn't exercise: partial closes, double milestone
 * crossings, carryforwards, wash-sale windows, splits, quarter boundaries. */
import { describe, expect, it } from 'vitest';
import type { CashEvent, PositionLot, Snapshot, Trade } from '../types';
import { roundCents } from '../money';
import { applySplit, closeShares } from '../positions';
import { milestoneLevels, milestoneTable, nextMilestone, skimDue } from '../milestones';
import { applicableCarryforward, computeCheck, quartersEnded, reserveTarget, skimDueNow } from '../tax';
import { washSaleWarnings } from '../washSale';
import { stLt } from '../trades';
import { ltStatus } from '../parked';
import { rollingLeadDelta } from '../benchmark';

const lot = (id: string, buyDate: string, shares: number, avgCost: number): PositionLot => ({
  id,
  ticker: 'XYZ',
  buyDate,
  shares,
  avgCost,
  exitTarget: 100,
  bailPoint: 10,
});

describe('money — rounding boundary', () => {
  it('rounds the float-dust cases correctly', () => {
    expect(roundCents(2.675)).toBe(2.68);
    expect(roundCents(1455.11 * 0.3)).toBe(436.53);
    expect(roundCents(-4.680000000000291)).toBe(-4.68);
  });
});

describe('positions — partial close', () => {
  const lots = [lot('a', '2026-01-01', 10, 10), lot('b', '2026-02-01', 10, 12)];

  it('FIFO: drains the oldest lot first, proportional basis', () => {
    const r = closeShares(lots, 'XYZ', 15, 20, '2026-06-01');
    expect(r.trades).toHaveLength(2);
    expect(r.trades[0]).toMatchObject({ openDate: '2026-01-01', costBasis: 100, proceeds: 200 });
    expect(r.trades[1]).toMatchObject({ openDate: '2026-02-01', costBasis: 60, proceeds: 100 });
    expect(r.remainingLots).toHaveLength(1);
    // The remainder keeps its original buyDate and cost.
    expect(r.remainingLots[0]).toMatchObject({ id: 'b', shares: 5, avgCost: 12, buyDate: '2026-02-01' });
    expect(r.totalProceeds).toBe(300);
  });

  it('per-lot override beats FIFO', () => {
    const r = closeShares(lots, 'XYZ', 5, 20, '2026-06-01', [{ lotId: 'b', shares: 5 }]);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ openDate: '2026-02-01', costBasis: 60 });
    expect(r.remainingLots.find((l) => l.id === 'a')?.shares).toBe(10);
    expect(r.remainingLots.find((l) => l.id === 'b')?.shares).toBe(5);
  });

  it('refuses overselling and mismatched allocations', () => {
    expect(() => closeShares(lots, 'XYZ', 25, 20, '2026-06-01')).toThrow();
    expect(() => closeShares(lots, 'XYZ', 5, 20, '2026-06-01', [{ lotId: 'a', shares: 3 }])).toThrow();
  });

  it('leaves other tickers untouched', () => {
    const mixed = [...lots, { ...lot('c', '2026-03-01', 4, 50), ticker: 'ABC' }];
    const r = closeShares(mixed, 'XYZ', 20, 20, '2026-06-01');
    expect(r.remainingLots.map((l) => l.ticker)).toEqual(['ABC']);
  });

  it('records a split: shares × ratio, cost ÷ ratio', () => {
    const split = applySplit(lots, 'XYZ', 2);
    expect(split[0]).toMatchObject({ shares: 20, avgCost: 5 });
    expect(split[1]).toMatchObject({ shares: 20, avgCost: 6 });
  });
});

describe('milestones — the ratchet', () => {
  it('a single jump past two levels flags BOTH as HIT_BANK_NOW', () => {
    const rows = milestoneTable(210_000, []);
    expect(rows.find((r) => r.level === 100_000)?.status).toBe('HIT_BANK_NOW');
    expect(rows.find((r) => r.level === 200_000)?.status).toBe('HIT_BANK_NOW');
    expect(rows.find((r) => r.level === 400_000)?.status).toBe('NOT_YET');
    // Pending skims quote 25% of the CURRENT account value.
    expect(rows.find((r) => r.level === 100_000)?.skimDue).toBe(52_500);
  });

  it('banked rows keep the skim from their value-at-hit and build the floor', () => {
    const rows = milestoneTable(150_000, [
      { level: 100_000, accountValueAtHit: 104_000, dateHit: '2027-01-10', amountBanked: 26_000 },
    ]);
    const banked = rows.find((r) => r.level === 100_000)!;
    expect(banked.status).toBe('BANKED');
    expect(banked.skimDue).toBe(26_000);
    expect(banked.cumulativeFloor).toBe(26_000);
    expect(skimDue(104_000)).toBe(26_000);
  });

  it('extends by doubling past the base ladder', () => {
    expect(milestoneLevels(2_000_000)).toEqual([
      100_000, 200_000, 400_000, 800_000, 1_000_000, 1_600_000, 3_200_000,
    ]);
    expect(nextMilestone(2_000_000)).toBe(3_200_000);
    expect(nextMilestone(1_000_000)).toBe(1_600_000);
    expect(nextMilestone(0)).toBe(100_000);
  });
});

describe('tax — carryforward and quarter timing', () => {
  it('carryforward offsets gains before the 30% applies', () => {
    expect(reserveTarget(10_000, 4_000)).toBe(1_800);
    expect(reserveTarget(3_000, 5_000)).toBe(0);
    expect(applicableCarryforward([{ taxYear: 2027, amount: 4_000 }], 2027)).toBe(4_000);
    expect(applicableCarryforward([{ taxYear: 2027, amount: 4_000 }], 2026)).toBe(0);
  });

  it('a quarter is due starting the day AFTER it ends', () => {
    expect(quartersEnded('2026-03-02', '2026-09-30')).toEqual([
      { year: 2026, quarter: 1 },
      { year: 2026, quarter: 2 },
    ]);
    expect(quartersEnded('2026-03-02', '2026-10-01')).toEqual([
      { year: 2026, quarter: 1 },
      { year: 2026, quarter: 2 },
      { year: 2026, quarter: 3 },
    ]);
  });

  it('computeCheck measures YTD at quarter end and credits same-year skims', () => {
    const trades: Trade[] = [
      { id: 't1', ticker: 'MU', openDate: '2026-03-02', closeDate: '2026-06-15', costBasis: 1000, proceeds: 2455.11, washSale: false },
      // Q4 trade must NOT count toward the Q2 check.
      { id: 't2', ticker: 'AMD', openDate: '2026-07-01', closeDate: '2026-11-01', costBasis: 500, proceeds: 900, washSale: false },
    ];
    const noSkims: CashEvent[] = [];
    const q2 = computeCheck({ year: 2026, quarter: 2 }, trades, noSkims, []);
    expect(q2.netRealizedYTD).toBeCloseTo(1455.11, 9);
    expect(q2.reserveTarget).toBe(436.53);
    expect(q2.moveOutNow).toBe(436.53);
    expect(skimDueNow([q2])).toBe(q2);

    const skimmed: CashEvent[] = [
      { id: 's1', date: '2026-10-05', type: 'TaxSkim', amount: 436.53 },
    ];
    const settled = computeCheck({ year: 2026, quarter: 2 }, trades, skimmed, []);
    expect(settled.moveOutNow).toBe(0);
    expect(skimDueNow([settled])).toBeUndefined();
  });

  it('wash-sale-disallowed losses are excluded from YTD', () => {
    const trades: Trade[] = [
      { id: 't1', ticker: 'MU', openDate: '2026-01-05', closeDate: '2026-02-01', costBasis: 1000, proceeds: 1500, washSale: false },
      { id: 't2', ticker: 'AMD', openDate: '2026-01-05', closeDate: '2026-02-01', costBasis: 1000, proceeds: 400, washSale: true },
    ];
    const q1 = computeCheck({ year: 2026, quarter: 1 }, trades, [], []);
    expect(q1.netRealizedYTD).toBe(500);
  });
});

describe('wash-sale window — 31 days, rebuy direction', () => {
  const lossSale: Trade = {
    id: 'w1', ticker: 'MU', openDate: '2025-11-01', closeDate: '2026-01-15',
    costBasis: 1000, proceeds: 800, washSale: false,
  };
  const gainSale: Trade = { ...lossSale, id: 'w2', proceeds: 1200 };

  it('warns on a rebuy within 31 days of a loss sale', () => {
    expect(washSaleWarnings([lossSale], 'MU', '2026-02-15')).toHaveLength(1);
    expect(washSaleWarnings([lossSale], 'MU', '2026-01-15')).toHaveLength(1);
  });

  it('stays quiet outside the window, for gains, and for other tickers', () => {
    expect(washSaleWarnings([lossSale], 'MU', '2026-02-16')).toHaveLength(0);
    expect(washSaleWarnings([gainSale], 'MU', '2026-02-01')).toHaveLength(0);
    expect(washSaleWarnings([lossSale], 'AMD', '2026-02-01')).toHaveLength(0);
  });

  it('crosses brokerages: recorded outside loss-sales trigger too', async () => {
    const { washSaleConflicts } = await import('../washSale');
    const outside = [
      { id: 'o1', accountId: 'cashapp', ticker: 'MU', saleDate: '2026-02-01', loss: true },
      { id: 'o2', accountId: 'cashapp', ticker: 'MU', saleDate: '2026-02-01', loss: false },
      { id: 'o3', accountId: 'stash', ticker: 'AMD', saleDate: '2026-02-01', loss: true },
    ];
    const hits = washSaleConflicts([lossSale], outside, 'MU', '2026-02-15');
    expect(hits.trades).toHaveLength(1);
    // Only the loss-flagged MU sale counts; the gain and the AMD sale don't.
    expect(hits.outside.map((s) => s.id)).toEqual(['o1']);
    const outOfWindow = washSaleConflicts([], outside, 'MU', '2026-03-05');
    expect(outOfWindow.outside).toHaveLength(0);
  });
});

describe('accounts — tracked strategy cash', () => {
  it('destination adds, source subtracts, others ignored', async () => {
    const { trackedBalance, reservedByAccount } = await import('../accounts');
    const events = [
      { id: 'e1', date: '2026-08-10', type: 'Deposit', amount: 6000, accountId: 'bank1' },
      { id: 'e2', date: '2026-10-05', type: 'TaxSkim', amount: 436.53, destinationAccountId: 'bank1' },
      { id: 'e3', date: '2026-10-06', type: 'TaxSkim', amount: 100, destinationAccountId: 'bank2' },
      { id: 'e4', date: '2026-10-07', type: 'TaxSkim', amount: 50 },
      { id: 'e5', date: '2026-11-01', type: 'Buy', amount: 999, ticker: 'MU' },
    ] as import('../types').CashEvent[];
    expect(trackedBalance('bank1', events)).toBeCloseTo(436.53 - 6000, 9);
    expect(trackedBalance('bank2', events)).toBe(100);
    const grouped = reservedByAccount(events);
    expect(grouped.get('bank1')).toBeCloseTo(436.53, 9);
    expect(grouped.get('bank2')).toBe(100);
    expect(grouped.get(null)).toBe(50);
  });
});

describe('holding-period boundaries', () => {
  it('365 days is still ST; 366 is LT', () => {
    const base = { id: 't', ticker: 'X', costBasis: 1, proceeds: 2, washSale: false };
    expect(stLt({ ...base, openDate: '2026-01-01', closeDate: '2027-01-01' })).toBe('ST');
    expect(stLt({ ...base, openDate: '2026-01-01', closeDate: '2027-01-02' })).toBe('LT');
  });

  it('parked LT status: countdown, unlocked, and missing buy date', () => {
    const p = { id: 'p', ticker: 'MU', accountId: 'a1', account: 'Cash App', category: 'Semi/AI' as const, shares: 1, avgCost: 1, currentPrice: 1 };
    expect(ltStatus({ ...p, buyDate: '2025-08-03' }, '2026-08-04').kind).toBe('UNLOCKED');
    const counting = ltStatus({ ...p, buyDate: '2026-08-01' }, '2026-08-04');
    expect(counting).toMatchObject({ kind: 'COUNTDOWN', daysLeft: 363, unlockDate: '2027-08-02' });
    expect(ltStatus({ ...p, buyDate: null }, '2026-08-04').kind).toBe('NO_BUY_DATE');
  });
});

describe('contribution cap — Rule 11', () => {
  it('OK below 80%, NEARING at 80%, REACHED at the cap', async () => {
    const { contributionStatus, depositExceedsCap } = await import('../contribution');
    expect(contributionStatus(10_000, 25_000).state).toBe('OK');
    expect(contributionStatus(19_999, 25_000).state).toBe('OK');
    expect(contributionStatus(20_000, 25_000)).toMatchObject({ state: 'NEARING', remaining: 5_000 });
    expect(contributionStatus(25_000, 25_000)).toMatchObject({ state: 'REACHED', remaining: 0 });
    expect(contributionStatus(26_000, 25_000).remaining).toBe(0);
    expect(depositExceedsCap(20_000, 5_000, 25_000)).toBe(false);
    expect(depositExceedsCap(20_000, 5_000.01, 25_000)).toBe(true);
  });
});

describe('parked lots — per-lot unlocks, aggregates, FIFO', () => {
  const lot = (id: string, date: string | null, shares: number, amount: number, source: 'purchase' | 'dividend' = 'purchase') =>
    ({ id, parkedPositionId: 'p1', date, source, shares, price: null, amount });

  it('unlockSummary splits unlocked / locked / unknown and finds the next unlock', async () => {
    const { unlockSummary } = await import('../parkedLots');
    const lots = [
      lot('a', '2025-01-10', 5, 500),            // unlocked (>366d before today)
      lot('b', '2026-05-01', 0.1, 20, 'dividend'), // locked DRIP sliver
      lot('c', '2026-02-01', 0.2, 30, 'dividend'), // locked, unlocks first
      lot('d', null, 1, 100),                     // unknown date
      lot('e', '2026-03-01', 0, 15, 'dividend'),  // cash dividend — no shares
    ];
    const s = unlockSummary(lots, '2026-08-05');
    expect(s.totalShares).toBeCloseTo(6.3, 9);
    expect(s.unlockedShares).toBe(5);
    expect(s.unknownShares).toBe(1);
    expect(s.nextUnlock).toEqual({ date: '2027-02-02', shares: 0.2 });
  });

  it('aggregateLots: reinvested dividends add basis, cash dividends do not', async () => {
    const { aggregateLots, dividendsCollected } = await import('../parkedLots');
    const lots = [
      lot('a', '2025-01-10', 10, 1000),
      lot('b', '2026-05-01', 0.5, 60, 'dividend'),  // reinvested
      lot('c', '2026-03-01', 0, 25, 'dividend'),    // cash
    ];
    const agg = aggregateLots(lots);
    expect(agg.shares).toBeCloseTo(10.5, 9);
    expect(agg.costBasis).toBe(1060);
    expect(agg.avgCost).toBeCloseTo(1060 / 10.5, 9);
    expect(dividendsCollected(lots)).toBe(85);
  });

  it('consumeLotsFifo: unknown-date lots go first, partial lots keep proportional basis', async () => {
    const { consumeLotsFifo } = await import('../parkedLots');
    const lots = [
      lot('new', '2026-05-01', 2, 300),
      lot('old', null, 4, 400),
      lot('mid', '2025-06-01', 4, 500),
    ];
    const r = consumeLotsFifo(lots, 6);
    expect(r.deletes).toEqual(['old']);          // null date consumed first
    expect(r.updates).toEqual([{ id: 'mid', shares: 2, amount: 250 }]);
    expect(() => consumeLotsFifo(lots, 11)).toThrow();
  });
});

describe('benchmark — rolling 12-month verdict', () => {
  const snap = (date: string, totalScore: number, shadowVooValue: number): Snapshot => ({
    date, totalScore, shadowVooValue,
    accountValue: 0, bankedTotal: 0, reservedTotal: 0, netContributed: 0, parkedPileValue: 0, semiAiPct: 0,
  });

  it('null until a snapshot is at least a year old', () => {
    expect(rollingLeadDelta([snap('2026-08-01', 100, 90)], '2026-08-04')).toBeNull();
  });

  it('lead delta over the trailing year', () => {
    const snaps = [snap('2025-08-01', 100, 90), snap('2026-08-04', 250, 200)];
    // Lead went from +10 to +50.
    expect(rollingLeadDelta(snaps, '2026-08-04')).toBe(40);
  });
});
