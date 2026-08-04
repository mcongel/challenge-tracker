/**
 * Workbook parity — every expected value here is read straight from
 * Challenge_Account_Tracker.xlsx's example rows. The workbook wins: if these
 * fail, the engine is wrong, not the test.
 */
import { describe, expect, it } from 'vitest';
import type { BenchmarkDeposit, CashEvent, ParkedPosition, PositionLot, Trade } from '../types';
import { roundCents } from '../money';
import { longTermDate } from '../dates';
import { cashSummary, currentCash, netContributed, withRunningBalance } from '../cash';
import { costBasis, daysHeld, marketValue, unrealized, unrealizedPct } from '../positions';
import { netRealizedYTD, realizedGain, realizedPct, stLt, tradeDaysHeld, tradeTaxYear } from '../trades';
import { cumulativeFloor, milestoneTable, nextMilestone } from '../milestones';
import { moveOutNow, reserveTarget } from '../tax';
import { lead, shadowShares, shadowValue } from '../benchmark';
import { accountTotal, totalScore } from '../score';
import { concentration, parkedCostBasis, pileTotal } from '../parked';
import { sum } from '../money';
import parkedFixture from '../__fixtures__/parked-pile.json';

/** The workbook was extracted with TODAY() = 2026-08-04. */
const TODAY = '2026-08-04';

const nbisLot: PositionLot = {
  id: 'lot-nbis',
  ticker: 'NBIS',
  buyDate: '2026-08-10',
  shares: 26.6,
  avgCost: 225.74,
  exitTarget: 290,
  bailPoint: 190,
};

const muTrade: Trade = {
  id: 'trade-mu',
  ticker: 'MU',
  openDate: '2026-03-02',
  closeDate: '2026-06-15',
  costBasis: 1000,
  proceeds: 2455.11,
  washSale: false,
};

const cashEvents: CashEvent[] = [
  { id: 'c1', date: '2026-08-10', type: 'Deposit', amount: 6000, sourceDestination: 'Cash App sales' },
  { id: 'c2', date: '2026-08-12', type: 'Buy', amount: 6004.68, ticker: 'NBIS' },
];

const benchmarkDeposit: BenchmarkDeposit = {
  id: 'b1',
  date: '2026-08-10',
  amount: 6000,
  vooPriceThatDay: 620,
};

describe('Positions tab — NBIS example row', () => {
  it('cost basis = shares × avg cost', () => {
    expect(costBasis(nbisLot)).toBeCloseTo(6004.684, 9);
    expect(roundCents(costBasis(nbisLot))).toBe(6004.68);
  });

  it('market value, unrealized $ and % at the entry price', () => {
    expect(marketValue(nbisLot, 225.74)).toBeCloseTo(6004.684, 9);
    expect(unrealized(nbisLot, 225.74)).toBeCloseTo(0, 9);
    expect(unrealizedPct(nbisLot, 225.74)).toBeCloseTo(0, 9);
  });

  it('days held matches TODAY()-buyDate (negative before settle date)', () => {
    expect(daysHeld(nbisLot, TODAY)).toBe(-6);
  });

  it('long-term date = buy date + 366', () => {
    expect(longTermDate(nbisLot.buyDate)).toBe('2027-08-11');
  });
});

describe('Trade Log tab — MU example row', () => {
  it('days held, ST/LT, tax year', () => {
    expect(tradeDaysHeld(muTrade)).toBe(105);
    expect(stLt(muTrade)).toBe('ST');
    expect(tradeTaxYear(muTrade)).toBe(2026);
  });

  it('realized gain $ and %', () => {
    expect(realizedGain(muTrade)).toBeCloseTo(1455.11, 9);
    expect(realizedPct(muTrade)).toBeCloseTo(1.45511, 9);
  });

  it('net realized YTD 2026', () => {
    expect(netRealizedYTD([muTrade], 2026)).toBeCloseTo(1455.11, 9);
  });
});

describe('Cash Flow tab — example ledger', () => {
  it('running balance: 6000 then -4.68 after the NBIS buy', () => {
    const rows = withRunningBalance(cashEvents);
    expect(rows.map((r) => roundCents(r.balance))).toEqual([6000, -4.68]);
  });

  it('current cash and net contributed', () => {
    expect(roundCents(currentCash(cashEvents))).toBe(-4.68);
    expect(netContributed(cashEvents)).toBe(6000);
  });

  it('summary totals', () => {
    const s = cashSummary(cashEvents);
    expect(s.deposits).toBe(6000);
    expect(s.buys).toBe(6004.68);
    expect(s.withdrawals).toBe(0);
    expect(roundCents(s.currentCash)).toBe(-4.68);
  });
});

describe('Dashboard tab — the scoreboard', () => {
  it('account value = positions + cash = 6000.004', () => {
    expect(accountTotal([nbisLot], { NBIS: 225.74 }, cashEvents)).toBeCloseTo(6000.004, 6);
  });

  it('Total Score with nothing banked or reserved equals account value', () => {
    expect(totalScore([nbisLot], { NBIS: 225.74 }, cashEvents, [])).toBeCloseTo(6000.004, 6);
  });

  it('progress to $1M aspiration', () => {
    const score = totalScore([nbisLot], { NBIS: 225.74 }, cashEvents, []);
    expect(score / 1_000_000).toBeCloseTo(0.006000004, 9);
  });

  it('next milestone and distance', () => {
    const account = accountTotal([nbisLot], { NBIS: 225.74 }, cashEvents);
    expect(nextMilestone(account)).toBe(100_000);
    expect(100_000 - account).toBeCloseTo(93_999.996, 6);
  });

  it('lead vs VOO shadow = 0.004', () => {
    const score = totalScore([nbisLot], { NBIS: 225.74 }, cashEvents, []);
    const shadow = shadowValue([benchmarkDeposit], 620);
    expect(lead(score, shadow)).toBeCloseTo(0.004, 6);
  });
});

describe('Benchmark tab — shadow VOO', () => {
  it('shadow shares = deposit / VOO price that day', () => {
    expect(shadowShares(benchmarkDeposit)).toBeCloseTo(9.67741935483871, 12);
  });

  it('shadow value at the same price recovers the deposit', () => {
    expect(shadowValue([benchmarkDeposit], 620)).toBeCloseTo(6000, 9);
  });
});

describe('Tax Reserve tab — 30% of net realized YTD', () => {
  it('reserve target on the MU gain', () => {
    expect(reserveTarget(netRealizedYTD([muTrade], 2026))).toBe(436.53);
  });

  it('move out now = target − already reserved', () => {
    expect(moveOutNow(436.53, 0)).toBe(436.53);
    expect(moveOutNow(436.53, 436.53)).toBe(0);
  });

  it('negative YTD reserves nothing', () => {
    expect(reserveTarget(-500)).toBe(0);
  });
});

describe('Milestones tab — nothing hit yet', () => {
  it('all base levels NOT_YET at $6k, floor at zero', () => {
    const rows = milestoneTable(6000.004, []);
    expect(rows.map((r) => r.level)).toEqual([100_000, 200_000, 400_000, 800_000, 1_000_000]);
    expect(rows.every((r) => r.status === 'NOT_YET')).toBe(true);
    expect(cumulativeFloor([])).toBe(0);
  });
});

describe('Parked Pile tab — full seed', () => {
  const positions: ParkedPosition[] = parkedFixture.positions.map((p, i) => ({
    id: `p${i}`,
    buyDate: null,
    ...p,
    category: p.category as ParkedPosition['category'],
  }));
  const expected = parkedFixture.expected;

  it('total cost basis, market value, unrealized', () => {
    expect(sum(positions.map(parkedCostBasis))).toBeCloseTo(expected.totalCostBasis, 6);
    expect(pileTotal(positions)).toBeCloseTo(expected.totalMarketValue, 6);
    expect(pileTotal(positions) - sum(positions.map(parkedCostBasis))).toBeCloseTo(
      expected.totalUnrealized,
      6,
    );
  });

  it('concentration: Semi/AI 77.4%, +adjacent 86.5%, over the 50% cap', () => {
    const c = concentration(positions);
    expect(c.semiValue).toBeCloseTo(expected.semiAiValue, 6);
    expect(c.semiPlusAdjacentValue).toBeCloseTo(expected.semiPlusAdjacentValue, 6);
    expect(c.semiPct).toBeCloseTo(expected.semiAiPct, 12);
    expect(c.semiPlusAdjacentPct).toBeCloseTo(expected.semiPlusAdjacentPct, 12);
    expect(c.overCap).toBe(true);
  });
});
