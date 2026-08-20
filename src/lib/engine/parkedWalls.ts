/** The pot walls, as one pure split. Live-priced view first, then the three
 * strategy walls on top of it. Pure so the wall rules are testable and the
 * context is just a caller. */

import { BTC_CATEGORY } from './parked';
import type { ParkedPosition } from './types';

export interface ParkedPots {
  /** Every position, live-priced where allowed. Hand-priced rows keep their
   * stored price, full stop: quotes AND pins are keyed by ticker, and an
   * annuity-unit row can share letters with a real listing (TRAD the annuity
   * vs TRAD the SPAC, JLGMX units vs JLGMX shares) — the market's number is
   * never that holding's value. */
  mergedParked: ParkedPosition[];
  /** Everything outside retirement. Income, taxes, and activity key off THIS
   * — the bitcoin split is a strategy wall, not a tax wall, so taxable math
   * must keep seeing the taxable BTC-bucket holdings. */
  taxableParked: ParkedPosition[];
  /** The pile proper — taxable minus the bitcoin conviction bucket. */
  pileParked: ParkedPosition[];
  /** The fourth pot (owner decision 2026-08-19). Category 'BTC' is the
   * owner's curation: BTC itself plus thesis members like MSTR and BTCI.
   * Spans the tax walls (owner decision 2026-08-20): a Swan IRA's BTC is
   * strategically bitcoin — it lives on the Bitcoin page and in btc_value —
   * while its ACCOUNT kind keeps it out of all taxable math. */
  btcParked: ParkedPosition[];
  /** The third pot, behind its own wall — never in pile math or the score.
   * Minus BTC-category holdings, which the bitcoin pot claims. */
  retirementParked: ParkedPosition[];
}

export function splitParkedPots(args: {
  parked: ParkedPosition[];
  overrides: Record<string, number>;
  quotes: Record<string, number>;
  retirementAccountIds: Set<string>;
  isQuotable: (p: ParkedPosition) => boolean;
}): ParkedPots {
  const { parked, overrides, quotes, retirementAccountIds, isQuotable } = args;
  const mergedParked = parked.map((p) => {
    if (!isQuotable(p)) return p;
    const effective = overrides[p.ticker] ?? quotes[p.ticker];
    return effective !== undefined ? { ...p, currentPrice: effective } : p;
  });
  const taxableParked = mergedParked.filter((p) => !retirementAccountIds.has(p.accountId));
  return {
    mergedParked,
    taxableParked,
    pileParked: taxableParked.filter((p) => p.category !== BTC_CATEGORY),
    // Strategy pot, not a tax pot: BTC-category holdings from EVERY account.
    btcParked: mergedParked.filter((p) => p.category === BTC_CATEGORY),
    retirementParked: mergedParked.filter(
      (p) => retirementAccountIds.has(p.accountId) && p.category !== BTC_CATEGORY,
    ),
  };
}
