/** Edge cases the workbook doesn't exercise: partial closes, double milestone
 * crossings, carryforwards, wash-sale windows, splits, quarter boundaries. */
import { describe, expect, it } from 'vitest';
import type { CashEvent, ParkedPosition, PositionLot, Snapshot, Trade } from '../types';
import type { DividendClassification, ParkedLot } from '../parkedLots';
import type { ParkedLotAdjustment } from '../parkedRoc';
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
    const p = { id: 'p', ticker: 'MU', accountId: 'a1', account: 'Cash App', category: 'Semiconductors' as const, shares: 1, avgCost: 1, currentPrice: 1 };
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
    expect(r.consumed).toEqual([
      { id: 'old', date: null, source: 'purchase', shares: 4, amount: 400, adjustedAmount: 400 },
      { id: 'mid', date: '2025-06-01', source: 'purchase', shares: 2, amount: 250, adjustedAmount: 250 },
    ]);
    expect(r.adjustmentUpdates).toEqual([]); // no ROC rows → nothing to scale
    expect(() => consumeLotsFifo(lots, 11)).toThrow();
  });

  it('trimPreview: basis from consumed lots, LT/ST/unknown share split', async () => {
    const { trimPreview } = await import('../parkedLots');
    const lots = [
      lot('a', null, 1, 100),           // unknown
      lot('b', '2025-01-01', 2, 300),   // long-term by 2026-08-06
      lot('c', '2026-06-01', 3, 900),   // short-term
    ];
    const p = trimPreview(lots, 4, 200, '2026-08-06');
    // Consumes: a (1 sh, $100), b (2 sh, $300), c partial (1 sh, $300)
    expect(p.costBasis).toBeCloseTo(700, 9);
    expect(p.proceeds).toBe(800);
    expect(p.gain).toBeCloseTo(100, 9);
    expect(p.ltShares).toBe(2);
    expect(p.stShares).toBe(1);
    expect(p.unknownShares).toBe(1);
  });
});

describe('parked cash — tracked balance with auto-flows', () => {
  it('sales and cash dividends credit, purchases debit, transfers and milestone lots do not', async () => {
    const { computeAccountCash } = await import('../parkedCash');
    const acct = 'cashapp';
    const result = computeAccountCash(acct, {
      parkedCashEvents: [
        { id: 'm1', accountId: acct, date: '2026-01-01', type: 'adjustment', amount: 500 },   // opening
        { id: 'm2', accountId: acct, date: '2026-02-01', type: 'interest', amount: 10 },
        { id: 'm3', accountId: acct, date: '2026-03-01', type: 'withdrawal', amount: 50 },
        { id: 'm4', accountId: 'other', date: '2026-03-01', type: 'deposit', amount: 999 },   // different account
      ],
      parkedSales: [
        { id: 's1', ticker: 'MU', accountId: acct, date: '2026-05-29', shares: 2, pricePerShare: 1000, proceeds: 2000, fundedChallenge: true },
      ],
      parked: [{ id: 'p1', ticker: 'GLW', accountId: acct, account: 'Cash App', category: 'Electrical Equipment', shares: 4, avgCost: 100, currentPrice: 100 }],
      parkedLots: [
        { id: 'l1', parkedPositionId: 'p1', date: '2026-04-01', source: 'purchase', shares: 4, amount: 400 },
        { id: 'l2', parkedPositionId: 'p1', date: '2026-06-01', source: 'dividend', shares: 0, amount: 25 },      // cash dividend
        { id: 'l3', parkedPositionId: 'p1', date: '2026-06-15', source: 'dividend', shares: 0.1, amount: 15 },    // DRIP — no cash effect
        { id: 'l6', parkedPositionId: 'p1', date: '2026-05-15', source: 'dividend', shares: 0, price: 12, amount: 9 }, // sold-DRIP relic (price set) — never cash
        { id: 'l4', parkedPositionId: 'p1', date: null, source: 'purchase', shares: 1, amount: 90, notes: 'ACATS from Stash 2026-08-06' },
        { id: 'l5', parkedPositionId: 'p1', date: '2026-07-01', source: 'purchase', shares: 1, amount: 80, notes: 'Milestone 100000 bank' },
      ],
      cashEvents: [
        { id: 'c1', date: '2026-05-29', type: 'Deposit', amount: 2000, accountId: acct },  // funded trim → debit
      ] as import('../types').CashEvent[],
    });
    // 500 + 10 − 50 (manual) + 2000 (sale) + 25 (cash div) − 400 (buy) − 2000 (challenge deposit)
    expect(result.manual).toBe(460);
    expect(result.saleProceeds).toBe(2000);
    expect(result.cashDividends).toBe(25);
    expect(result.purchases).toBe(400);
    expect(result.challengeFlows).toBe(-2000);
    expect(result.balance).toBeCloseTo(85, 9);
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

describe('dates — addMonths', () => {
  it('clamps end-of-month, honors leap years, crosses years both ways', async () => {
    const { addMonths } = await import('../dates');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29'); // leap February keeps the 29th
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15'); // forward across the year end
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28'); // negative months clamp too
    expect(addMonths('2026-01-15', -2)).toBe('2025-11-15'); // backward across the year end
  });
});

describe('parked income — trailing, projection, yield, dividend tax', () => {
  const TODAY = '2026-08-10';
  const RATES = { qualified: 0.15, ordinary: 0.24, capitalGainDist: 0.21 };
  const div = (
    id: string,
    date: string | null,
    amount: number,
    classification: DividendClassification = 'qualified',
    shares = 0,
  ): ParkedLot => ({
    id, parkedPositionId: 'p1', date, source: 'dividend', shares, price: null, amount, classification,
  });
  const buy = (id: string, date: string | null, shares: number, amount: number): ParkedLot => ({
    id, parkedPositionId: 'p1', date, source: 'purchase', shares, price: null, amount,
  });
  const pos = (over: Partial<ParkedPosition> = {}): ParkedPosition => ({
    id: 'p1', ticker: 'DIV', accountId: 'a1', account: 'Acct', category: 'Other',
    shares: 10, avgCost: 100, currentPrice: 100, ...over,
  });

  it('trailingIncomeByMonth: dense zero-filled buckets; undated, stale, and future lots excluded', async () => {
    const { trailingIncomeByMonth } = await import('../parkedIncome');
    const lots = [
      div('a', '2026-06-10', 100),
      div('b', '2026-06-20', 50),        // second payment, same month
      div('c', '2025-08-01', 40),        // 13 months back — outside the window
      div('d', '2026-08-15', 30),        // dated after today — not yet income
      div('e', null, 999),               // undated — cannot be placed in a window
      buy('f', '2026-01-01', 10, 1000),  // purchases never count
    ];
    const points = trailingIncomeByMonth(lots, TODAY);
    expect(points).toHaveLength(12);
    expect(points[0].month).toBe('2025-09');
    expect(points[11].month).toBe('2026-08');
    expect(points.find((p) => p.month === '2026-06')?.amount).toBe(150);
    expect(points.reduce((t, p) => t + p.amount, 0)).toBe(150);
  });

  it('quarterly payer with 4 actuals: cadence, mean amount, schedule anchored to last pay date', async () => {
    const { projectPositionIncome } = await import('../parkedIncome');
    const lots = [
      div('q1', '2025-09-10', 100), div('q2', '2025-12-10', 100),
      div('q3', '2026-03-10', 100), div('q4', '2026-06-10', 100),
    ];
    const proj = projectPositionIncome({ position: pos(), lots, today: TODAY, rates: RATES });
    expect(proj?.source).toBe('actual');
    expect(proj?.monthly).toHaveLength(12);
    expect(proj?.monthly[0].month).toBe('2026-09');
    expect(proj?.nextPayment).toEqual({ date: '2026-09-10', amount: 100 });
    expect(proj?.annualGross).toBeCloseTo(400, 9); // 4 payments in the next 12 months
    expect(proj?.annualAfterTax).toBeCloseTo(340, 9); // all qualified → ×0.85
  });

  it('monthly payer: 12 projected payments from the recent monthly mean', async () => {
    const { projectPositionIncome } = await import('../parkedIncome');
    const lots = Array.from({ length: 12 }, (_, i) =>
      div(`m${i}`, `${['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'][i]}-05`, 10));
    const proj = projectPositionIncome({ position: pos(), lots, today: TODAY, rates: RATES });
    expect(proj?.source).toBe('actual');
    expect(proj?.nextPayment).toEqual({ date: '2026-09-05', amount: 10 });
    expect(proj?.annualGross).toBeCloseTo(120, 9);
  });

  it('DRIP growing the position mid-year: projection reflects the larger recent payments', async () => {
    const { projectPositionIncome } = await import('../parkedIncome');
    const lots = [
      div('q1', '2025-09-10', 50), div('q2', '2025-12-10', 50),
      // Payments jumped after reinvested shares compounded the payout.
      div('q3', '2026-03-10', 80, 'qualified', 0.5), div('q4', '2026-06-10', 80, 'qualified', 0.6),
    ];
    const proj = projectPositionIncome({ position: pos(), lots, today: TODAY, rates: RATES });
    expect(proj?.nextPayment?.amount).toBeCloseTo(65, 9); // mean of the trailing year, not the stale 50
    expect(proj?.annualGross).toBeCloseTo(260, 9);
  });

  it('manual-rate-only holding: rate × shares at frequency, first payment one interval out', async () => {
    const { projectPositionIncome } = await import('../parkedIncome');
    const position = pos({ dividendRate: 4, dividendFrequency: 'quarterly' }); // $4/sh/yr × 10 sh
    const proj = projectPositionIncome({ position, lots: [], today: TODAY, rates: RATES });
    expect(proj?.source).toBe('manual');
    expect(proj?.nextPayment).toEqual({ date: '2026-11-10', amount: 10 });
    expect(proj?.annualGross).toBeCloseTo(40, 9);
    expect(proj?.annualAfterTax).toBeCloseTo(34, 9); // no history → unclassified → qualified rate
  });

  it('sub-monthly manual rates (daily, twice a month) project as monthly aggregates', async () => {
    const { projectPositionIncome } = await import('../parkedIncome');
    // STRC-style: $2.40/sh/yr paid twice a month, 10 shares → $24/yr, $2/mo.
    const semi = projectPositionIncome({
      position: pos({ dividendRate: 2.4, dividendFrequency: 'semimonthly' }),
      lots: [], today: TODAY, rates: RATES,
    });
    expect(semi?.source).toBe('manual');
    expect(semi?.annualGross).toBeCloseTo(24, 9);
    expect(semi?.monthly[0].amount).toBeCloseTo(2, 9);
    expect(semi?.nextPayment).toEqual({ date: '2026-08-25', amount: 1 }); // today + 15d, annual/24
    // SATA-style: $3.65/sh/yr daily, 10 shares → $36.50/yr, ~$0.10/day.
    const daily = projectPositionIncome({
      position: pos({ dividendRate: 3.65, dividendFrequency: 'daily' }),
      lots: [], today: TODAY, rates: RATES,
    });
    expect(daily?.annualGross).toBeCloseTo(36.5, 9);
    expect(daily?.nextPayment?.date).toBe('2026-08-11'); // tomorrow
    expect(daily?.nextPayment?.amount).toBeCloseTo(0.1, 9);
  });

  it('semimonthly actuals merge per month: cadence reads monthly, annual total right', async () => {
    const { projectPositionIncome } = await import('../parkedIncome');
    // Two $5 payments per month for 6 months (STRC with history).
    const lots = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'].flatMap((m, i) => [
      div(`a${i}`, `${m}-01`, 5), div(`b${i}`, `${m}-05`, 5),
    ]);
    const proj = projectPositionIncome({ position: pos(), lots, today: TODAY, rates: RATES });
    expect(proj?.source).toBe('actual');
    expect(proj?.nextPayment?.amount).toBeCloseTo(10, 9); // merged monthly payment
    expect(proj?.annualGross).toBeCloseTo(120, 9);
  });

  it('single actual is not a cadence; falls back to manual, else excluded entirely', async () => {
    const { projectPositionIncome } = await import('../parkedIncome');
    const oneActual = [div('x', '2026-05-01', 75)];
    const withRate = projectPositionIncome({
      position: pos({ dividendRate: 2, dividendFrequency: 'annual' }), lots: oneActual, today: TODAY, rates: RATES,
    });
    expect(withRate?.source).toBe('manual');
    const bare = projectPositionIncome({ position: pos(), lots: oneActual, today: TODAY, rates: RATES });
    expect(bare).toBeNull(); // no cadence, no rate → excluded from projections
  });

  it('mixed-classification payment: one payment for cadence, tax blended by dollar mix', async () => {
    const { projectPositionIncome } = await import('../parkedIncome');
    const lots = [
      div('a', '2026-03-10', 100),
      // One broker payment split across two classifications = two lots, same date.
      div('b1', '2026-06-10', 60), div('b2', '2026-06-10', 40, 'ordinary'),
    ];
    const proj = projectPositionIncome({ position: pos(), lots, today: TODAY, rates: RATES });
    expect(proj?.source).toBe('actual'); // 2 payments, not 3 — same-date lots group
    expect(proj?.nextPayment?.amount).toBeCloseTo(100, 9);
    expect(proj?.annualGross).toBeCloseTo(400, 9);
    // Mix: 160 qualified (15%) + 40 ordinary (24%) → blended tax 16.8% of dollars.
    expect(proj?.annualAfterTax).toBeCloseTo(400 * (1 - 33.6 / 200), 9);
  });

  it('special dividend days after the regular one merges into its month — no fake monthly cadence', async () => {
    const { projectPositionIncome } = await import('../parkedIncome');
    const lots = [
      div('reg', '2026-06-10', 100),
      div('special', '2026-06-13', 500), // 3-day gap must NOT read as monthly cadence
    ];
    // One merged June payment is not a cadence; with no manual rate → excluded.
    expect(projectPositionIncome({ position: pos(), lots, today: TODAY, rates: RATES })).toBeNull();
  });

  it('suspended payer: stale history stops projecting; manual rate takes over if set', async () => {
    const { projectPositionIncome } = await import('../parkedIncome');
    const lots = [
      // Quarterly cadence, but the last payment is 8 months ago — cut dividend.
      div('q1', '2025-09-10', 100), div('q2', '2025-12-10', 100),
    ];
    expect(projectPositionIncome({ position: pos(), lots, today: TODAY, rates: RATES })).toBeNull();
    const withRate = projectPositionIncome({
      position: pos({ dividendRate: 1, dividendFrequency: 'annual' }), lots, today: TODAY, rates: RATES,
    });
    expect(withRate?.source).toBe('manual');
  });

  it('positionIncomeSummary: yield on cost from original basis, ROC and unclassified surfaced', async () => {
    const { positionIncomeSummary } = await import('../parkedIncome');
    const lots = [
      buy('base', '2025-01-01', 10, 1000),
      div('q1', '2025-09-10', 100), div('q2', '2025-12-10', 100),
      div('q3', '2026-03-10', 100), div('q4', '2026-06-10', 100),
      // ROC/unclassified land in regular payment months so they merge into
      // those payments rather than reading as extra cadence points.
      div('roc', '2026-03-15', 200, 'return_of_capital'),
      div('old-roc', null, 50, 'return_of_capital'),  // undated: lifetime ROC yes, windows no
      div('mystery', '2026-06-20', 10, 'unclassified'),
    ];
    const s = positionIncomeSummary(pos(), lots, TODAY, RATES);
    expect(s.trailing12m).toBeCloseTo(610, 9); // 400 + 200 + 10; undated 50 excluded
    expect(s.costBasis).toBeCloseTo(1000, 9);
    expect(s.rocCumulative).toBeCloseTo(250, 9);
    expect(s.hasUnclassified).toBe(true);
    expect(s.undatedDividendAmount).toBeCloseTo(50, 9);
    expect(s.yieldOnCost).not.toBeNull();
    expect(s.yieldOnCost!).toBeGreaterThan(0);
  });

  it('dividendTaxYTD: ROC untaxed, capital-gain dist at LT rate, unclassified flagged, other years and future dates out', async () => {
    const { dividendTaxYTD } = await import('../parkedIncome');
    const lots = [
      div('a', '2026-02-01', 100),                        // qualified → 15
      div('b', '2026-03-01', 100, 'ordinary'),            // → 24
      div('c', '2026-04-01', 200, 'return_of_capital'),   // → 0 (Phase 1: no basis adjustment)
      div('d', '2026-05-01', 100, 'capital_gain_dist'),   // → 21 at the LT rate
      div('e', '2026-06-01', 80, 'unclassified'),         // → 12 at qualified rate, flagged
      div('f', '2025-12-01', 100),                        // prior tax year
      div('g', null, 50, 'ordinary'),                     // undated — no year to belong to
      div('h', '2026-09-15', 100),                        // pre-logged, not yet received
    ];
    const r = dividendTaxYTD(lots, TODAY, RATES);
    expect(r.totalTax).toBeCloseTo(72, 9);
    expect(r.byClassification.return_of_capital).toEqual({ amount: 200, tax: 0 });
    expect(r.byClassification.capital_gain_dist?.tax).toBeCloseTo(21, 9);
    expect(r.unclassifiedAmount).toBe(80);
  });

  it('estimatedPileTax: explicit rates override the spec defaults', async () => {
    const { estimatedPileTax } = await import('../parkedLots');
    expect(estimatedPileTax(1000, 10, 10)).toBeCloseTo(210, 9);          // defaults: all-LT at 21%
    expect(estimatedPileTax(1000, 10, 10, 0.1, 0.5)).toBeCloseTo(100, 9); // settings-driven LT
    expect(estimatedPileTax(1000, 10, 0, 0.1, 0.5)).toBeCloseTo(500, 9);  // all-ST at the override
  });
});

describe('parked ROC — allocation, adjusted basis, overflow', () => {
  const buy = (id: string, date: string | null, shares: number, amount: number): ParkedLot => ({
    id, parkedPositionId: 'p1', date, source: 'purchase', shares, price: null, amount,
  });
  const rocDiv = (
    id: string, date: string | null, amount: number, allocated = false, overflow = 0,
  ): ParkedLot => ({
    id, parkedPositionId: 'p1', date, source: 'dividend', shares: 0, price: null, amount,
    classification: 'return_of_capital', rocAllocatedAt: allocated ? '2026-08-12T00:00:00Z' : null,
    rocOverflow: allocated ? overflow : null,
  });
  const adj = (
    id: string, shareLotId: string, amount: number, dividendLotId: string | null = 'd1',
  ): ParkedLotAdjustment => ({ id, shareLotId, dividendLotId, amount });

  it('allocates per share across lots held at the event date; later lots excluded', async () => {
    const { allocateRoc } = await import('../parkedRoc');
    const lots = [
      buy('a', '2025-01-01', 10, 1000),
      buy('b', '2026-01-01', 30, 3000),
      buy('c', '2026-07-01', 5, 500), // bought after the event — not entitled
    ];
    const r = allocateRoc(lots, [], { amount: 40, date: '2026-06-01' });
    // 40 sh eligible → $1/share
    expect(r.allocations).toEqual([
      { shareLotId: 'a', amount: 10 },
      { shareLotId: 'b', amount: 30 },
    ]);
    expect(r.overflow.total).toBe(0);
  });

  it('caps at remaining basis per lot; the excess is THAT lot\'s gain, never redistributed', async () => {
    const { allocateRoc } = await import('../parkedRoc');
    const lots = [
      buy('a', '2024-01-01', 10, 6),    // nearly exhausted basis, LT at event
      buy('b', '2026-05-01', 10, 1000), // deep basis, ST at event
    ];
    const r = allocateRoc(lots, [], { amount: 40, date: '2026-06-01' });
    // $2/share: a gets 20 → 6 applied + 14 LT overflow; b gets exactly its 20.
    expect(r.allocations).toEqual([
      { shareLotId: 'a', amount: 6 },
      { shareLotId: 'b', amount: 20 }, // b must NOT absorb a's overflow
    ]);
    expect(r.overflow).toEqual({ total: 14, ltAmount: 14, stAmount: 0, unknownAmount: 0 });
  });

  it('sequential events see basis already reduced by earlier rows', async () => {
    const { allocateRoc } = await import('../parkedRoc');
    const lots = [buy('a', '2025-01-01', 10, 10)];
    const first = allocateRoc(lots, [], { amount: 6, date: '2026-01-01' });
    expect(first.allocations).toEqual([{ shareLotId: 'a', amount: 6 }]);
    const rows = first.allocations.map((x, i) => adj(`r${i}`, x.shareLotId, x.amount));
    const second = allocateRoc(lots, rows, { amount: 6, date: '2026-06-01' });
    expect(second.allocations).toEqual([{ shareLotId: 'a', amount: 4 }]); // only $4 basis left
    expect(second.overflow.total).toBeCloseTo(2, 9);
    expect(second.overflow.ltAmount).toBeCloseTo(2, 9);
  });

  it('undated lots overflow as unknown; zero eligible lots → whole event is unknown overflow', async () => {
    const { allocateRoc } = await import('../parkedRoc');
    const undated = allocateRoc([buy('a', null, 10, 1)], [], { amount: 5, date: '2026-06-01' });
    expect(undated.allocations).toEqual([{ shareLotId: 'a', amount: 1 }]);
    expect(undated.overflow.unknownAmount).toBeCloseTo(4, 9);
    const none = allocateRoc([buy('a', '2026-07-01', 10, 100)], [], { amount: 5, date: '2026-06-01' });
    expect(none.allocations).toEqual([]);
    expect(none.overflow).toEqual({ total: 5, ltAmount: 0, stAmount: 0, unknownAmount: 5 });
  });

  it('excludeLotId keeps a DRIP ROC lot from absorbing its own distribution', async () => {
    const { allocateRoc } = await import('../parkedRoc');
    const drip: ParkedLot = {
      id: 'drip', parkedPositionId: 'p1', date: '2026-06-01', source: 'dividend',
      shares: 2, price: 5, amount: 10, classification: 'return_of_capital',
    };
    const lots = [buy('a', '2025-01-01', 8, 800), drip];
    const r = allocateRoc(lots, [], { amount: 10, date: '2026-06-01', excludeLotId: 'drip' });
    expect(r.allocations).toEqual([{ shareLotId: 'a', amount: 10 }]); // all to a, none to itself
  });

  it('reversal is exact: dropping an event\'s rows restores adjusted basis', async () => {
    const { adjustedLotAmount, aggregateLotsAdjusted } = await import('../parkedRoc');
    const a = buy('a', '2025-01-01', 10, 1000);
    const rows = [adj('r1', 'a', 3.5), adj('r2', 'a', 1.25, 'd2')];
    expect(adjustedLotAmount(a, rows)).toBeCloseTo(995.25, 9);
    const afterReversal = rows.filter((x) => x.dividendLotId !== 'd1'); // d1 reclassified away
    expect(adjustedLotAmount(a, afterReversal)).toBeCloseTo(998.75, 9);
    const agg = aggregateLotsAdjusted([a], rows);
    expect(agg.costBasis).toBe(1000);            // original untouched
    expect(agg.adjustedCostBasis).toBeCloseTo(995.25, 9);
    expect(agg.avgCost).toBe(100);               // avgCost stays original
  });

  it('basisExhaustedLotIds flags empty lots; adjustmentsForLots joins by lot id', async () => {
    const { adjustmentsForLots, basisExhaustedLotIds } = await import('../parkedRoc');
    const lots = [buy('a', '2025-01-01', 10, 5), buy('b', '2025-01-01', 10, 500)];
    expect(basisExhaustedLotIds(lots, [adj('r1', 'a', 5)])).toEqual(['a']);
    const rows = [adj('r1', 'a', 5), adj('r2', 'other-position-lot', 9)];
    expect(adjustmentsForLots(lots, rows)).toEqual([rows[0]]);
  });

  it('dividendTaxYTD: overflow comes from the STORED value, immune to later row mutation', async () => {
    const { dividendTaxYTD } = await import('../parkedIncome');
    const RATES = { qualified: 0.15, ordinary: 0.24, capitalGainDist: 0.21 };
    const lots = [
      rocDiv('d1', '2026-04-01', 10, true, 3), // allocated: 7 absorbed, 3 overflow at allocation
      rocDiv('d2', '2026-05-01', 8, true),     // allocated: fully absorbed
      rocDiv('d3', '2026-06-01', 5, false),    // never allocated — backfill pending
    ];
    // Note: no adjustment rows passed at all — a later trim may have cascaded
    // them away, and the estimate must not change when that happens.
    const r = dividendTaxYTD(lots, '2026-08-12', RATES);
    expect(r.rocOverflowAmount).toBeCloseTo(3, 9);
    expect(r.rocUnallocatedAmount).toBe(5);
    expect(r.totalTax).toBeCloseTo(3 * 0.21, 9); // only the recorded overflow is taxed
    expect(r.byClassification.return_of_capital?.amount).toBe(23);
  });

  it('isUnallocatedRoc: only ROC dividends without the allocation stamp', async () => {
    const { isUnallocatedRoc } = await import('../parkedRoc');
    expect(isUnallocatedRoc(rocDiv('d1', '2026-06-01', 5, false))).toBe(true);
    expect(isUnallocatedRoc(rocDiv('d2', '2026-06-01', 5, true))).toBe(false);
    expect(isUnallocatedRoc(buy('a', '2026-06-01', 1, 100))).toBe(false);
  });

  it('consumeLotsFifo prorates adjustments on partial consume; full consume relies on cascade', async () => {
    const { consumeLotsFifo } = await import('../parkedLots');
    const lots = [
      buy('a', '2025-01-01', 4, 400),  // fully consumed — its rows die with it
      buy('b', '2025-06-01', 10, 1000), // half consumed — rows must halve
    ];
    const rows = [adj('ra', 'a', 40), adj('rb1', 'b', 60), adj('rb2', 'b', 40, 'd2')];
    const r = consumeLotsFifo(lots, 9, rows);
    expect(r.deletes).toEqual(['a']);
    expect(r.consumed[0].adjustedAmount).toBeCloseTo(360, 9); // 400 − 40
    // b: 5 of 10 shares consumed → half the basis and half of each row.
    expect(r.updates).toEqual([{ id: 'b', shares: 5, amount: 500 }]);
    expect(r.adjustmentUpdates).toEqual([
      { id: 'rb1', amount: 30 },
      { id: 'rb2', amount: 20 },
    ]);
    expect(r.consumed[1].adjustedAmount).toBeCloseTo(500 - 50, 9); // consumed half minus half the rows
  });

  it('trimPreview: gain from adjusted basis, original basis still reported', async () => {
    const { trimPreview } = await import('../parkedLots');
    const lots = [buy('a', '2025-01-01', 10, 1000)];
    const rows = [adj('r1', 'a', 100)]; // $100 of ROC already returned
    const p = trimPreview(lots, 10, 150, '2026-08-12', rows);
    expect(p.costBasis).toBe(1000);
    expect(p.adjustedCostBasis).toBeCloseTo(900, 9);
    expect(p.gain).toBeCloseTo(1500 - 900, 9); // ROC-reduced basis → bigger gain
    expect(p.ltShares).toBe(10);
  });

  it('archived position: history intact, projection and summary basis honest, no income projected', async () => {
    const { positionIncomeSummary, projectPositionIncome } = await import('../parkedIncome');
    const RATES = { qualified: 0.15, ordinary: 0.24, capitalGainDist: 0.21 };
    const archived = {
      id: 'p1', ticker: 'GONE', accountId: 'a1', account: 'Acct', category: 'Other' as const,
      shares: 0, avgCost: 0, currentPrice: 100,
    };
    const lots = [
      { ...rocDiv('d1', '2026-05-01', 20, true) },
      { id: 'cash1', parkedPositionId: 'p1', date: '2026-06-01', source: 'dividend' as const,
        shares: 0, price: null, amount: 30, classification: 'qualified' as const },
    ];
    // Fresh payment history exists, but the shares are gone — never project.
    expect(projectPositionIncome({ position: archived, lots, today: '2026-08-12', rates: RATES })).toBeNull();
    const s = positionIncomeSummary(archived, lots, '2026-08-12', RATES);
    expect(s.trailing12m).toBeCloseTo(50, 9); // history survives
    expect(s.projection).toBeNull();
    expect(s.rocCumulative).toBe(20);
  });
});

describe('parked sale restore — snapshot, converging undo plan', () => {
  const pos = (over: Partial<ParkedPosition> = {}): ParkedPosition => ({
    id: 'p1', ticker: 'X', accountId: 'a1', account: 'Acct', category: 'Other',
    shares: 15, avgCost: 100, currentPrice: 100, ...over,
  });
  const buy = (id: string, date: string | null, shares: number, amount: number): ParkedLot => ({
    id, parkedPositionId: 'p1', date, source: 'purchase', shares, price: null, amount,
  });
  const drip = (id: string, date: string, shares: number, amount: number): ParkedLot => ({
    id, parkedPositionId: 'p1', date, source: 'dividend', shares, price: 10, amount,
    classification: 'return_of_capital', rocAllocatedAt: '2026-08-01T00:00:00Z', rocOverflow: 0,
  });
  const rocCash = (id: string, date: string, amount: number, stamp: string | null): ParkedLot => ({
    id, parkedPositionId: 'p1', date, source: 'dividend', shares: 0, price: null, amount,
    classification: 'return_of_capital', rocAllocatedAt: stamp, rocOverflow: 0,
  });
  const adj = (id: string, shareLotId: string, amount: number, dividendLotId: string | null = 'divX'):
    ParkedLotAdjustment => ({ id, shareLotId, dividendLotId, amount });
  const sale = (over: Partial<import('../types').ParkedSale> = {}): import('../types').ParkedSale => ({
    id: 's1', ticker: 'X', accountId: 'a1', date: '2026-08-13', shares: 12, pricePerShare: 150,
    proceeds: 1800, fundedChallenge: false, createdAt: '2026-08-13T00:00:00Z', ...over,
  });

  it('buildSaleSnapshot: shrunk vs deleted modes with delta math matching FIFO proration', async () => {
    const { consumeLotsFifo } = await import('../parkedLots');
    const { buildSaleSnapshot } = await import('../parkedSaleRestore');
    const lots = [buy('B', '2025-01-01', 5, 500), buy('A', '2025-06-01', 10, 1000)];
    const rows = [adj('ra', 'A', 100), adj('rb', 'B', 50)];
    const consumption = consumeLotsFifo(lots, 12, rows); // B full, A 7-of-10
    const snap = buildSaleSnapshot(pos(), lots, rows, consumption, []);
    const b = snap.slices.find((s) => s.lotId === 'B')!;
    expect(b.mode).toBe('deleted');
    expect(b).toMatchObject({ preShares: 5, preAmount: 500, sharesDelta: 5, amountDelta: 500 });
    expect(b.adjustments[0]).toMatchObject({ id: 'rb', preAmount: 50, amountDelta: 50 });
    const a = snap.slices.find((s) => s.lotId === 'A')!;
    expect(a.mode).toBe('shrunk');
    expect(a).toMatchObject({ preShares: 10, preAmount: 1000, sharesDelta: 7, amountDelta: 700 });
    expect(a.adjustments[0].amountDelta).toBeCloseTo(70, 6); // 100 − round6(100 × 0.3)
  });

  it('buildSaleSnapshot: zeroed DRIP slices carry zero deltas — amount and rows were untouched', async () => {
    const { consumeLotsFifo } = await import('../parkedLots');
    const { buildSaleSnapshot } = await import('../parkedSaleRestore');
    const lots = [buy('A', '2025-01-01', 10, 1000), drip('D', '2026-01-01', 2, 20)];
    const rows = [adj('rd', 'D', 5)];
    const consumption = consumeLotsFifo(lots, 12, rows); // both fully consumed
    const snap = buildSaleSnapshot(pos(), lots, rows, consumption, ['D']); // recordTrim zero-shares D
    const d = snap.slices.find((s) => s.lotId === 'D')!;
    expect(d.mode).toBe('zeroed');
    expect(d.amountDelta).toBe(0);
    expect(d.sharesDelta).toBe(2);
    expect(d.adjustments[0].amountDelta).toBe(0);
  });

  it('planSaleRestore: clean undo restores absolutes, recreates deleted lots with original ids', async () => {
    const { planSaleRestore } = await import('../parkedSaleRestore');
    const { consumeLotsFifo } = await import('../parkedLots');
    const { buildSaleSnapshot } = await import('../parkedSaleRestore');
    const preLots = [buy('B', '2025-01-01', 5, 500), buy('A', '2025-06-01', 10, 1000)];
    const rows = [adj('ra', 'A', 100), adj('rb', 'B', 50)];
    const snap = buildSaleSnapshot(pos(), preLots, rows, consumeLotsFifo(preLots, 12, rows), []);
    const divX = rocCash('divX', '2026-05-01', 150, null); // stamp matches entries (null lookup → null)
    const plan = planSaleRestore(sale(), snap, {
      position: pos({ shares: 3 }),
      lots: [buy('A', '2025-06-01', 3, 300)],          // post-sale state: B gone, A shrunk
      adjustments: [adj('ra', 'A', 30)],               // ra scaled, rb cascaded
      dividendLots: [divX],
    });
    expect(plan.recreatePosition).toBeNull();
    expect(plan.lotUpserts).toHaveLength(1);
    expect(plan.lotUpserts[0]).toMatchObject({ id: 'B', shares: 5, amount: 500 });
    expect(plan.lotSets).toEqual([{ id: 'A', shares: 10, amount: 1000 }]);
    expect(plan.adjustmentUpserts).toEqual([{ id: 'rb', shareLotId: 'B', dividendLotId: 'divX', amount: 50 }]);
    expect(plan.adjustmentSets).toEqual([{ id: 'ra', amount: 100 }]);
    expect(plan.reallocate).toEqual([]);
  });

  it('planSaleRestore: idempotent — planning against restored state is an empty plan', async () => {
    const { planSaleRestore, buildSaleSnapshot } = await import('../parkedSaleRestore');
    const { consumeLotsFifo } = await import('../parkedLots');
    const preLots = [buy('B', '2025-01-01', 5, 500), buy('A', '2025-06-01', 10, 1000)];
    const rows = [adj('ra', 'A', 100), adj('rb', 'B', 50)];
    const snap = buildSaleSnapshot(pos(), preLots, rows, consumeLotsFifo(preLots, 12, rows), []);
    const plan = planSaleRestore(sale(), snap, {
      position: pos(),
      lots: preLots,           // fully restored already (retry after crash before sale delete)
      adjustments: rows,
      dividendLots: [rocCash('divX', '2026-05-01', 150, null)],
    });
    expect(plan.lotUpserts).toEqual([]);
    expect(plan.lotSets).toEqual([]);
    expect(plan.adjustmentUpserts).toEqual([]);
    expect(plan.adjustmentSets).toEqual([]);
  });

  it('planSaleRestore: interference after the sale falls back to delta restore', async () => {
    const { planSaleRestore, buildSaleSnapshot } = await import('../parkedSaleRestore');
    const { consumeLotsFifo } = await import('../parkedLots');
    const preLots = [buy('A', '2025-06-01', 10, 1000)];
    const snap = buildSaleSnapshot(pos(), preLots, [], consumeLotsFifo(preLots, 7, []), []);
    const plan = planSaleRestore(sale({ shares: 7 }), snap, {
      position: pos({ shares: 2 }),
      lots: [buy('A', '2025-06-01', 2, 200)], // a later transfer took 1 more share
      adjustments: [],
      dividendLots: [],
    });
    // Neither pre (10) nor pre−delta (3): add the sale's slice back → 2+7.
    expect(plan.lotSets).toEqual([{ id: 'A', shares: 9, amount: 900 }]);
  });

  it('planSaleRestore: sub-cent adjustment deltas still restore (6dp tolerance)', async () => {
    const { planSaleRestore, buildSaleSnapshot } = await import('../parkedSaleRestore');
    const { consumeLotsFifo } = await import('../parkedLots');
    const preLots = [buy('A', '2025-06-01', 10, 1000)];
    const rows = [adj('ra', 'A', 0.02)]; // tiny 6dp ROC reduction
    const snap = buildSaleSnapshot(pos(), preLots, rows, consumeLotsFifo(preLots, 3, rows), []);
    expect(snap.slices[0].adjustments[0].amountDelta).toBeCloseTo(0.006, 9);
    const plan = planSaleRestore(sale({ shares: 3 }), snap, {
      position: pos({ shares: 7 }),
      lots: [buy('A', '2025-06-01', 7, 700)],
      adjustments: [adj('ra', 'A', 0.014)], // post-sale scaled row
      dividendLots: [rocCash('divX', '2026-05-01', 1, null)],
    });
    // A cent-scale tolerance would call 0.014 ≈ 0.02 "already restored".
    expect(plan.adjustmentSets).toEqual([{ id: 'ra', amount: 0.02 }]);
  });

  it('planSaleRestore: event gates — removed events skip, re-allocated events re-run', async () => {
    const { planSaleRestore, buildSaleSnapshot } = await import('../parkedSaleRestore');
    const { consumeLotsFifo } = await import('../parkedLots');
    const preLots = [buy('A', '2025-06-01', 10, 1000)];
    const rows = [adj('ra1', 'A', 40, 'divGone'), adj('ra2', 'A', 60, 'divMoved')];
    const snap = buildSaleSnapshot(
      pos(), preLots, rows, consumeLotsFifo(preLots, 10, rows), [],
      (id) => (id === 'divMoved' ? '2026-06-01T00:00:00Z' : null),
    );
    const plan = planSaleRestore(sale({ shares: 10 }), snap, {
      position: pos({ shares: 0 }),
      lots: [],
      adjustments: [],
      // divGone was deleted; divMoved was re-allocated (different stamp).
      dividendLots: [rocCash('divMoved', '2026-06-01', 60, '2026-08-14T00:00:00Z')],
    });
    expect(plan.adjustmentUpserts).toEqual([]); // neither row comes back directly
    expect(plan.reallocate.map((r) => r.id)).toEqual(['divMoved']);
  });

  it('planSaleRestore: position recreation, archived revival, and post-sale events re-run', async () => {
    const { planSaleRestore, buildSaleSnapshot } = await import('../parkedSaleRestore');
    const { consumeLotsFifo } = await import('../parkedLots');
    const preLots = [buy('A', '2025-06-01', 10, 1000)];
    const snap = buildSaleSnapshot(pos(), preLots, [], consumeLotsFifo(preLots, 10, []), []);
    // Position deleted entirely by the full trim:
    const gone = planSaleRestore(sale({ shares: 10 }), snap, {
      position: null, lots: [], adjustments: [], dividendLots: [],
    });
    expect(gone.recreatePosition).toEqual({ id: 'p1', ticker: 'X', accountId: 'a1' });
    // Archived position + an ROC event allocated after the sale:
    const archived = planSaleRestore(sale({ shares: 10 }), snap, {
      position: pos({ shares: 0 }),
      lots: [],
      adjustments: [],
      dividendLots: [rocCash('divLate', '2026-08-14', 30, '2026-08-14T09:00:00Z')],
    });
    expect(archived.revivePrice).toBe(100);
    expect(archived.reallocate.map((r) => r.id)).toEqual(['divLate']);
  });
});

describe('transition — scenario projection', () => {
  const TODAY = '2026-08-14';
  const SETTINGS = {
    dividend: { qualified: 0.15, ordinary: 0.24, capitalGainDist: 0.21 },
    lt: 0.21,
    st: 0.29,
  };
  const pos = (over: Partial<ParkedPosition> = {}): ParkedPosition => ({
    id: 'A', ticker: 'GRW', accountId: 'a1', account: 'Acct', category: 'Other',
    shares: 100, avgCost: 50, currentPrice: 100,
    dividendRate: 1, dividendFrequency: 'quarterly', ...over,
  });
  const lot = (id: string, positionId: string, date: string | null, shares: number, amount: number): ParkedLot => ({
    id, parkedPositionId: positionId, date, source: 'purchase', shares, price: null, amount,
  });
  const scen = (over: Partial<import('../transition').IncomeScenario> = {}): import('../transition').IncomeScenario => ({
    id: 's1', name: 'Base', isActive: true, ...over,
  });
  const rot = (over: Partial<import('../transition').ScenarioRotation> = {}): import('../transition').ScenarioRotation => ({
    id: 'r1', scenarioId: 's1', sellHoldingId: 'A', sellPct: 0.5, rotationDate: '2029-03-15',
    buySymbol: 'SCHD', buyYieldPct: 0.07, buyDividendGrowthPct: 0,
    buyClassificationMix: { qualified: 100 }, ...over,
  });

  it('horizon: max(targetYear+5, Y0+10), inclusive rows', async () => {
    const { projectScenario } = await import('../transition');
    const base = { rotations: [], positions: [], lots: [], adjustments: [], today: TODAY, settings: SETTINGS };
    expect(projectScenario({ scenario: scen({ targetYear: 2030 }), ...base }).horizon).toEqual({ startYear: 2026, endYear: 2036 });
    expect(projectScenario({ scenario: scen({ targetYear: 2040 }), ...base }).horizon.endYear).toBe(2045);
    expect(projectScenario({ scenario: scen(), ...base }).years).toHaveLength(11);
  });

  it('baseline growth compounds; excluded holdings contribute zero and are listed', async () => {
    const { projectScenario } = await import('../transition');
    const dead = pos({ id: 'B', ticker: 'DEAD', dividendRate: null, dividendFrequency: null });
    const r = projectScenario({
      scenario: scen(), rotations: [],
      positions: [pos({ dividendGrowthPct: 0.05 }), dead],
      lots: [], adjustments: [], today: TODAY, settings: SETTINGS,
    });
    // $1/sh × 100 sh = $100/yr, growing 5%; manual → unclassified → qualified rate.
    expect(r.years[0].grossIncome).toBeCloseTo(100, 9);
    expect(r.years[2].grossIncome).toBeCloseTo(100 * 1.05 ** 2, 9);
    expect(r.years[0].afterTaxIncome).toBeCloseTo(85, 9);
    expect(r.excludedPositionIds).toEqual(['B']);
    expect(r.holdingLabels['pos:A']).toBe('GRW');
  });

  it('rotation proration: month-after effect on both sides, exact 0.625 weight', async () => {
    const { projectScenario } = await import('../transition');
    const r = projectScenario({
      scenario: scen(), rotations: [rot()],
      positions: [pos()], lots: [lot('l1', 'A', '2025-01-01', 100, 5000)],
      adjustments: [], today: TODAY, settings: SETTINGS,
    });
    const y2029 = r.years.find((y) => y.year === 2029)!;
    const y2030 = r.years.find((y) => y.year === 2030)!;
    // Sell 50 sh @ $100 = $5000; basis $2500; LT gain $2500 → tax $525 → net $4475.
    expect(r.rotationPreviews[0]).toMatchObject({
      sellShares: 50, grossProceeds: 5000, gain: 2500, capitalGainsTax: 525, netProceeds: 4475,
      warnings: [],
    });
    // Holding kept 100% for Jan–Mar, 50% after → (3 + 9×0.5)/12 = 0.625.
    expect(y2029.byHoldingGross['pos:A']).toBeCloseTo(100 * 0.625, 9);
    // Buy: 4475 × 7% = 313.25/yr; 2029 gets 9/12 of it, 2030 the full year.
    expect(y2029.byHoldingGross['buy:SCHD']).toBeCloseTo(313.25 * 0.75, 9);
    expect(y2030.byHoldingGross['buy:SCHD']).toBeCloseTo(313.25, 9);
    expect(y2030.byHoldingGross['pos:A']).toBeCloseTo(50, 9);
  });

  it('haircut rates: scenario capital-gain override on LT, settings st on ST, loss untaxed', async () => {
    const { projectScenario } = await import('../transition');
    const ltOverride = projectScenario({
      scenario: scen({ capitalGainRate: 0.1 }), rotations: [rot()],
      positions: [pos()], lots: [lot('l1', 'A', '2025-01-01', 100, 5000)],
      adjustments: [], today: TODAY, settings: SETTINGS,
    });
    expect(ltOverride.rotationPreviews[0].capitalGainsTax).toBeCloseTo(250, 9); // 2500 × 10%
    const st = projectScenario({
      scenario: scen({ capitalGainRate: 0.1 }), rotations: [rot()],
      positions: [pos()], lots: [lot('l1', 'A', '2029-01-01', 100, 5000)], // bought weeks before
      adjustments: [], today: TODAY, settings: SETTINGS,
    });
    expect(st.rotationPreviews[0].capitalGainsTax).toBeCloseTo(2500 * 0.29, 9); // ST at settings st
    expect(st.rotationPreviews[0].warnings).toContain('short_term');
    const loss = projectScenario({
      scenario: scen(), rotations: [rot()],
      positions: [pos({ currentPrice: 40 })], lots: [lot('l1', 'A', '2025-01-01', 100, 5000)],
      adjustments: [], today: TODAY, settings: SETTINGS,
    });
    expect(loss.rotationPreviews[0].capitalGainsTax).toBe(0);
    expect(loss.rotationPreviews[0].netProceeds).toBeCloseTo(2000, 9);
  });

  it('oversell clamps; the second rotation sees basis the first already consumed', async () => {
    const { projectScenario } = await import('../transition');
    const r = projectScenario({
      scenario: scen(),
      rotations: [
        rot({ id: 'r1', sellPct: 0.6, rotationDate: '2028-01-10' }),
        rot({ id: 'r2', sellPct: 0.6, rotationDate: '2029-01-10' }),
      ],
      positions: [pos()], lots: [lot('l1', 'A', '2025-01-01', 100, 5000)],
      adjustments: [], today: TODAY, settings: SETTINGS,
    });
    const [first, second] = r.rotationPreviews;
    expect(first.sellShares).toBe(60);
    expect(first.gain).toBeCloseTo(6000 - 3000, 9);
    expect(second.sellShares).toBeCloseTo(40, 9); // clamped from 60
    expect(second.warnings).toContain('oversell_clamped');
    expect(second.gain).toBeCloseTo(4000 - 2000, 9); // remaining basis, not fresh
  });

  it('a fully consumed holding clamps to zero — never refills from its original count', async () => {
    const { projectScenario } = await import('../transition');
    const r = projectScenario({
      scenario: scen(),
      rotations: [
        rot({ id: 'r1', sellPct: 1, rotationDate: '2028-01-10' }),
        rot({ id: 'r2', sellPct: 0.5, rotationDate: '2029-01-10' }),
      ],
      positions: [pos()], lots: [lot('l1', 'A', '2025-01-01', 100, 5000)],
      adjustments: [], today: TODAY, settings: SETTINGS,
    });
    const second = r.rotationPreviews[1];
    expect(second.sellShares).toBe(0); // no phantom shares
    expect(second.netProceeds).toBe(0);
    expect(second.warnings).toContain('oversell_clamped');
  });

  it('buy growth starts AFTER the first full year — the entered yield is the starting yield', async () => {
    const { projectScenario } = await import('../transition');
    const r = projectScenario({
      scenario: scen(),
      rotations: [rot({
        sellHoldingId: null, sellPct: null, cashAmount: 100000,
        buyYieldPct: 0.07, buyDividendGrowthPct: 0.1, rotationDate: '2029-01-15',
      })],
      positions: [], lots: [], adjustments: [], today: TODAY, settings: SETTINGS,
    });
    const inc = (y: number) => r.years.find((x) => x.year === y)!.byHoldingGross['buy:SCHD'];
    expect(inc(2029)).toBeCloseTo(7000 * (11 / 12), 6); // prorated starting yield
    expect(inc(2030)).toBeCloseTo(7000, 6);             // first FULL year = starting yield
    expect(inc(2031)).toBeCloseTo(7700, 6);             // growth begins after it
  });

  it('no-lots position with a buyDate inside the window still flags short-term', async () => {
    const { projectScenario } = await import('../transition');
    const r = projectScenario({
      scenario: scen(),
      rotations: [rot({ sellShares: 10, sellPct: null, rotationDate: '2026-09-01' })],
      positions: [pos({ shares: 10, buyDate: '2026-06-01' })],
      lots: [], adjustments: [], today: TODAY, settings: SETTINGS,
    });
    const p = r.rotationPreviews[0];
    expect(p.warnings).toContain('no_lots');
    expect(p.warnings).toContain('short_term');
    expect(p.capitalGainsTax).toBeCloseTo(500 * 0.29, 9); // ST at settings st
  });

  it('cash rotation: no tax, prorated first year', async () => {
    const { projectScenario } = await import('../transition');
    const r = projectScenario({
      scenario: scen(),
      rotations: [rot({ sellHoldingId: null, sellPct: null, cashAmount: 10000, buyYieldPct: 0.05, rotationDate: '2027-06-01' })],
      positions: [], lots: [], adjustments: [], today: TODAY, settings: SETTINGS,
    });
    expect(r.rotationPreviews[0]).toMatchObject({ capitalGainsTax: 0, netProceeds: 10000 });
    const y2027 = r.years.find((y) => y.year === 2027)!;
    expect(y2027.byHoldingGross['buy:SCHD']).toBeCloseTo(500 * 0.5, 9); // live Jul–Dec
  });

  it('classification mix: ROC untaxed, cumulative ROC tracked, same-symbol rotations merge', async () => {
    const { projectScenario } = await import('../transition');
    const mix = { ordinary: 40, return_of_capital: 60 };
    const r = projectScenario({
      scenario: scen(),
      rotations: [
        rot({ id: 'r1', sellHoldingId: null, sellPct: null, cashAmount: 1000, buySymbol: 'jepi', buyYieldPct: 0.1, buyClassificationMix: mix, rotationDate: '2026-12-20' }),
        rot({ id: 'r2', sellHoldingId: null, sellPct: null, cashAmount: 2000, buySymbol: 'JEPI', buyYieldPct: 0.1, buyClassificationMix: mix, rotationDate: '2026-12-20' }),
      ],
      positions: [], lots: [], adjustments: [], today: TODAY, settings: SETTINGS,
    });
    expect(r.netProceedsBySymbol.JEPI).toBe(3000);
    const y2027 = r.years.find((y) => y.year === 2027)!;
    expect(y2027.byHoldingGross['buy:JEPI']).toBeCloseTo(300, 9);
    // atf = 0.4×(1−0.24) + 0.6×1 = 0.904.
    expect(y2027.byHoldingAfterTax['buy:JEPI']).toBeCloseTo(300 * 0.904, 9);
    // December rotation → zero income in 2026; ROC accrues only on paid years.
    expect(r.years[0].byHoldingGross['buy:JEPI']).toBeUndefined();
    expect(r.rocCumulativeBySymbol.JEPI).toBeCloseTo(
      r.years.reduce((s, y) => s + (y.byHoldingGross['buy:JEPI'] ?? 0), 0) * 0.6, 6,
    );
  });

  it('target-reached uses AFTER-TAX income', async () => {
    const { projectScenario } = await import('../transition');
    const r = projectScenario({
      scenario: scen({ targetAnnualIncome: 100 }),
      rotations: [],
      positions: [pos({ dividendRate: 1.1, dividendGrowthPct: 0.05 })], // gross 110 in Y0
      lots: [], adjustments: [], today: TODAY, settings: SETTINGS,
    });
    // Gross crosses 100 immediately, but after-tax (×0.85) needs two growth years.
    expect(r.years[0].afterTaxIncome).toBeCloseTo(93.5, 9);
    expect(r.targetReachedYear).toBe(2028);
  });

  it('per-scenario dividend rates override; resolveScenarioRates falls back per field', async () => {
    const { projectScenario, resolveScenarioRates } = await import('../transition');
    const r = projectScenario({
      scenario: scen({ qualifiedRate: 0.05 }),
      rotations: [], positions: [pos()], lots: [], adjustments: [], today: TODAY, settings: SETTINGS,
    });
    expect(r.years[0].afterTaxIncome).toBeCloseTo(95, 9); // 100 × (1 − 0.05)
    const rates = resolveScenarioRates(scen({ capitalGainRate: 0.12 }), SETTINGS);
    expect(rates.capGainLt).toBe(0.12);
    expect(rates.dividend.capitalGainDist).toBe(0.12); // follows the override
    expect(rates.dividend.qualified).toBe(0.15);       // falls back
    expect(rates.capGainSt).toBe(0.29);                // never overridden
  });

  it('legacy no-lots position: avgCost basis, LT assumption, no_lots warning', async () => {
    const { projectScenario } = await import('../transition');
    const r = projectScenario({
      scenario: scen(), rotations: [rot({ sellShares: 10, sellPct: null })],
      positions: [pos({ shares: 10 })], lots: [], adjustments: [], today: TODAY, settings: SETTINGS,
    });
    const p = r.rotationPreviews[0];
    expect(p.warnings).toContain('no_lots');
    expect(p.gain).toBeCloseTo(10 * 100 - 10 * 50, 9);
    expect(p.capitalGainsTax).toBeCloseTo(500 * 0.21, 9);
  });

  it('missing or archived holding: skipped with holding_missing', async () => {
    const { projectScenario } = await import('../transition');
    const r = projectScenario({
      scenario: scen(), rotations: [rot({ sellHoldingId: 'GONE' })],
      positions: [pos()], lots: [], adjustments: [], today: TODAY, settings: SETTINGS,
    });
    expect(r.rotationPreviews[0].warnings).toContain('holding_missing');
    expect(r.rotationPreviews[0].netProceeds).toBe(0);
  });
});

describe('the wall — parked dividends cannot reach the score', () => {
  it('totalScore has no parameter through which parked data can enter', async () => {
    const { totalScore } = await import('../score');
    const events: CashEvent[] = [
      { id: 'e1', date: '2026-01-02', type: 'Deposit', amount: 1000 },
    ] as CashEvent[];
    const before = totalScore([], {}, events, []);
    // A parked dividend exists beside the score inputs; the signature
    // totalScore(lots, prices, events, milestones) offers it no way in.
    const parkedDividend: ParkedLot = {
      id: 'wall', parkedPositionId: 'p1', date: '2026-06-01', source: 'dividend',
      shares: 0, price: null, amount: 500, classification: 'qualified',
    };
    expect(parkedDividend.amount).toBe(500);
    expect(totalScore([], {}, events, [])).toBe(before);
    expect(totalScore.length).toBe(4);
  });
});

describe('parkedReturns — total return counts every dollar exactly once', () => {
  const pos = (shares: number, currentPrice: number) => ({ shares, currentPrice });
  const shareLot = (id: string, shares: number, amount: number): ParkedLot => ({
    id, parkedPositionId: 'p1', date: '2025-01-01', source: 'purchase', shares, price: null, amount,
  });
  const divLot = (id: string, amount: number, over: Partial<ParkedLot> = {}): ParkedLot => ({
    id, parkedPositionId: 'p1', date: '2026-01-01', source: 'dividend', shares: 0, price: null,
    amount, classification: 'qualified', ...over,
  });
  const sale = (proceeds: number, costBasis: number | null): import('../types').ParkedSale => ({
    id: 's1', ticker: 'XYZ', accountId: 'a1', date: '2026-06-01', shares: 1,
    pricePerShare: proceeds, proceeds, costBasis, ltShares: null, fundedChallenge: false,
    consumed: null, createdAt: null,
  });

  it('plain price gain plus dividends', async () => {
    const { positionTotalReturn } = await import('../parkedReturns');
    const r = positionTotalReturn(pos(10, 15), [shareLot('a', 10, 100), divLot('d', 5)], [], []);
    expect(r.unrealized).toBe(50);
    expect(r.income).toBe(5);
    expect(r.total).toBe(55);
    expect(r.pct).toBeCloseTo(0.55, 10);
  });

  it('allocated ROC counts once: reduced basis, not income', async () => {
    const { positionTotalReturn } = await import('../parkedReturns');
    // Buy $100, ROC $10 allocated (basis → $90), price flat: economic +$10.
    const lots = [
      shareLot('a', 10, 100),
      divLot('roc', 10, { classification: 'return_of_capital', rocAllocatedAt: '2026-01-02', rocOverflow: 0 }),
    ];
    const adjs: ParkedLotAdjustment[] = [{ id: 'j1', shareLotId: 'a', dividendLotId: 'roc', amount: 10 }];
    const r = positionTotalReturn(pos(10, 10), lots, adjs, []);
    expect(r.unrealized).toBe(10); // 100 value − 90 adjusted basis
    expect(r.income).toBe(0);      // the ROC dollar lives in the basis leg
    expect(r.total).toBe(10);
  });

  it('ROC then sell-all still counts once via the recorded adjusted basis', async () => {
    const { positionTotalReturn } = await import('../parkedReturns');
    // Sold everything: no live lots, sale recorded against $90 adjusted basis.
    const lots = [
      divLot('roc', 10, { classification: 'return_of_capital', rocAllocatedAt: '2026-01-02', rocOverflow: 0 }),
    ];
    const r = positionTotalReturn(pos(0, 0), lots, [], [sale(100, 90)]);
    expect(r.realized).toBe(10);
    expect(r.income).toBe(0);
    expect(r.total).toBe(10); // paid 100, got 100 + 10 ROC back
  });

  it('unallocated ROC and overflow stay income', async () => {
    const { positionTotalReturn } = await import('../parkedReturns');
    const lots = [
      shareLot('a', 10, 100),
      divLot('un', 4, { classification: 'return_of_capital' }), // not yet allocated
      divLot('ov', 6, { classification: 'return_of_capital', rocAllocatedAt: '2026-01-02', rocOverflow: 6 }),
    ];
    const r = positionTotalReturn(pos(10, 10), lots, [], []);
    expect(r.income).toBe(10); // both count as income — neither reduced basis
    expect(r.total).toBe(10);
  });

  it('DRIP reinvestment is not double-counted', async () => {
    const { positionTotalReturn } = await import('../parkedReturns');
    // Buy $100, $10 DRIP (its own lot with $10 basis), value now $110: +$10.
    const lots = [
      shareLot('a', 10, 100),
      divLot('drip', 10, { shares: 1, price: 10 }),
    ];
    const r = positionTotalReturn(pos(11, 10), lots, [], []);
    expect(r.unrealized).toBe(0); // 110 value − 110 basis (incl. the DRIP lot)
    expect(r.income).toBe(10);
    expect(r.total).toBe(10);
  });

  it('unknown-basis sales are excluded and surfaced', async () => {
    const { positionTotalReturn } = await import('../parkedReturns');
    const r = positionTotalReturn(pos(10, 10), [shareLot('a', 10, 100)], [], [sale(50, null)]);
    expect(r.realized).toBe(0);
    expect(r.unknownBasisSales).toBe(1);
    expect(r.invested).toBe(100);
  });
});

describe('tradeStats — the pattern behind the closed trades', () => {
  const t = (id: string, costBasis: number, proceeds: number, open: string, close: string): Trade => ({
    id, ticker: 'XYZ', openDate: open, closeDate: close, costBasis, proceeds, washSale: false,
  });

  it('empty log returns nulls, not NaNs', async () => {
    const { tradeStats } = await import('../trades');
    const s = tradeStats([]);
    expect(s.count).toBe(0);
    expect(s.winRate).toBeNull();
    expect(s.payoff).toBeNull();
  });

  it('win rate, averages, payoff, and hold time', async () => {
    const { tradeStats } = await import('../trades');
    const s = tradeStats([
      t('a', 100, 130, '2026-01-01', '2026-01-11'), // +30 (+30%), 10d
      t('b', 100, 110, '2026-02-01', '2026-02-21'), // +10 (+10%), 20d
      t('c', 100, 80, '2026-03-01', '2026-03-31'),  // −20 (−20%), 30d
    ]);
    expect(s.count).toBe(3);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
    expect(s.winRate).toBeCloseTo(2 / 3, 10);
    expect(s.avgWin).toBe(20);
    expect(s.avgLoss).toBe(-20);
    expect(s.avgWinPct).toBeCloseTo(0.2, 10);
    expect(s.avgLossPct).toBeCloseTo(-0.2, 10);
    expect(s.payoff).toBeCloseTo(1, 10);
    expect(s.avgHoldDays).toBe(20);
    expect(s.best?.id).toBe('a');
    expect(s.worst?.id).toBe('c');
  });

  it('wash-flagged losses still count — tax flag, not performance', async () => {
    const { tradeStats } = await import('../trades');
    const washed = { ...t('w', 100, 90, '2026-01-01', '2026-01-05'), washSale: true };
    const s = tradeStats([washed]);
    expect(s.losses).toBe(1);
    expect(s.avgLoss).toBe(-10);
  });
});

describe('suggestCategory — hints only for the unambiguous industries', () => {
  it('semis and crypto suggest; everything else stays a human call', async () => {
    const { suggestCategory } = await import('../parked');
    expect(suggestCategory('Semiconductors')).toBe('Semiconductors');
    expect(suggestCategory('Bitcoin & Cryptocurrency')).toBe('BTC'); // crypto normalizes to the bucket
    expect(suggestCategory('Software')).toBe('Software'); // sector verbatim — MSTR's BTC tag is the owner's edit
    expect(suggestCategory('Auto Manufacturers')).toBe('Auto Manufacturers');
    expect(suggestCategory(null)).toBeNull();
  });
});
