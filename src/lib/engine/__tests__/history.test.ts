import { describe, expect, it } from 'vitest';
import { reconstructValues, shareEvents } from '../history';
import type { ParkedSale } from '../types';
import type { ParkedLot } from '../parkedLots';

const lot = (over: Partial<ParkedLot>): ParkedLot => ({
  id: 'l1', parkedPositionId: 'p1', date: '2026-01-02', source: 'purchase',
  shares: 10, price: 5, amount: 50, ...over,
} as ParkedLot);

const sale = (over: Partial<ParkedSale>): ParkedSale => ({
  id: 's1', ticker: 'AAA', accountId: 'a1', date: '2026-01-10', shares: 4,
  pricePerShare: 6, proceeds: 24, fundedChallenge: false, ...over,
} as ParkedSale);

describe('shareEvents', () => {
  it('adds current lots at their dates', () => {
    const events = shareEvents([lot({})], [], () => 'AAA');
    expect(events).toEqual([{ ticker: 'AAA', date: '2026-01-02', delta: 10 }]);
  });

  it('re-adds what a snapshot-bearing sale consumed over [purchase, sale)', () => {
    const s = sale({
      consumed: {
        version: 1, positionId: 'p1',
        position: { category: 'Other', avgCost: 5, currentPrice: 6, trimRank: null, dividendRate: null, dividendFrequency: null, notes: null },
        slices: [{
          lotId: 'l1', mode: 'shrunk', preShares: 10, preAmount: 50, sharesDelta: 4, amountDelta: 20,
          date: '2026-01-02', source: 'purchase', price: 5, classification: null, exDate: null,
          reclassifiedAt: null, rocAllocatedAt: null, rocOverflow: null, notes: null, adjustments: [],
        }],
      },
    });
    const events = shareEvents([lot({ shares: 6 })], [s], () => 'AAA');
    expect(events).toContainEqual({ ticker: 'AAA', date: '2026-01-02', delta: 4 });
    expect(events).toContainEqual({ ticker: 'AAA', date: '2026-01-10', delta: -4 });
  });

  it('legacy sales without a snapshot count as held from the window start', () => {
    const events = shareEvents([], [sale({})], () => 'AAA');
    expect(events).toContainEqual({ ticker: 'AAA', date: null, delta: 4 });
    expect(events).toContainEqual({ ticker: 'AAA', date: '2026-01-10', delta: -4 });
  });

  it('skips zero-share (archived/cash-dividend) lots', () => {
    expect(shareEvents([lot({ shares: 0 })], [], () => 'AAA')).toEqual([]);
  });
});

describe('reconstructValues', () => {
  const closes = {
    AAA: [['2026-01-02', 5], ['2026-01-05', 6], ['2026-01-12', 7]] as [string, number][],
  };

  it('values holdings at the last close at or before each date', () => {
    const events = shareEvents([lot({})], [], () => 'AAA');
    expect(reconstructValues(events, closes)).toEqual([
      { date: '2026-01-02', value: 50 },
      { date: '2026-01-05', value: 60 },
      { date: '2026-01-12', value: 70 },
    ]);
  });

  it('drops shares after a sale; the axis starts at the first DATED event', () => {
    const events = shareEvents([lot({ shares: 6, date: '2026-01-05' })], [sale({})], () => 'AAA');
    // Legacy sale shares (4, undated) are held from the window start; the
    // axis opens at the first dated event (the lot), where all 10 are held.
    expect(reconstructValues(events, closes)).toEqual([
      { date: '2026-01-05', value: 60 },  // (4 + 6) × 6
      { date: '2026-01-12', value: 42 },  // 6 × 7
    ]);
  });

  it('a ticker with no close yet contributes nothing', () => {
    const events = [
      { ticker: 'AAA', date: '2026-01-02', delta: 10 },
      { ticker: 'NEW', date: '2026-01-02', delta: 100 },
    ];
    expect(reconstructValues(events, closes)[0]).toEqual({ date: '2026-01-02', value: 50 });
  });
});
