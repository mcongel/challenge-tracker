/** Domain types, mirroring SPEC.md's data model. Dates are ISO yyyy-mm-dd strings. */

import type { DividendClassification } from './parkedLots';

export type CashEventType =
  | 'Deposit'
  | 'Withdrawal'
  | 'Buy'
  | 'Sell'
  | 'Dividend'
  | 'TaxSkim'
  | 'MilestoneBank'
  | 'Fee';

export interface CashEvent {
  id: string;
  date: string;
  type: CashEventType;
  /** Always positive; type determines direction. */
  amount: number;
  ticker?: string | null;
  sourceDestination?: string | null;
  /** Where the money came from (Deposits). Context only — never score math. */
  accountId?: string | null;
  /** Where the money went (TaxSkim / MilestoneBank / Withdrawal). */
  destinationAccountId?: string | null;
  notes?: string | null;
}

export type AccountKind = 'challenge' | 'outside' | 'bank' | 'retirement';

export interface Account {
  id: string;
  name: string;
  broker?: string | null;
  kind: AccountKind;
  /** Tax-treatment label for retirement accounts (roth / traditional /
   * 401k…). Display only — the wall, not the flavor, drives the math. */
  retirementFlavor?: string | null;
  notes?: string | null;
}

/** A sale in an outside brokerage — recorded only so Rule 9's cross-account
 * wash-sale window has teeth. Never part of score or YTD math. */
export interface OutsideSale {
  id: string;
  accountId: string;
  ticker: string;
  saleDate: string;
  loss: boolean;
  notes?: string | null;
}

/** One purchase = one lot. A ticker may hold several open lots. */
export interface PositionLot {
  id: string;
  ticker: string;
  buyDate: string;
  shares: number;
  avgCost: number;
  /** The Xu exit: the catalyst move you're selling into. Required at entry. */
  exitTarget: number;
  /** Calendar exit: out by this date's close no matter the price (e.g. the
   * session before an earnings print). Optional; fires the CALENDAR alert. */
  exitDate?: string | null;
  /** Legacy — the pre-Xu downside exit. Optional since Rules v3 (2026-08-05). */
  bailPoint?: number | null;
  thesis?: string | null;
  /** Exact link to the Buy cash event; null on legacy lots (fuzzy fallback). */
  buyEventId?: string | null;
}

export interface Trade {
  id: string;
  ticker: string;
  openDate: string;
  closeDate: string;
  costBasis: number;
  proceeds: number;
  washSale: boolean;
  /** Why the exit happened: target_hit | calendar | early | thesis_broke —
   * the pattern card reads it to judge target calibration. */
  exitReason?: string | null;
  notes?: string | null;
}

export interface MilestoneRecord {
  level: number;
  accountValueAtHit: number;
  dateHit: string;
  amountBanked: number;
  parkedDestination?: string | null;
}

export type MilestoneStatus = 'BANKED' | 'HIT_BANK_NOW' | 'NOT_YET';

export interface MilestoneRow {
  level: number;
  status: MilestoneStatus;
  /** 25% of account value at hit for banked rows; 25% of current value for pending hits. */
  skimDue: number;
  record?: MilestoneRecord;
  cumulativeFloor: number;
}

export interface BenchmarkDeposit {
  id: string;
  date: string;
  amount: number;
  vooPriceThatDay: number;
  /** Links the twin to its Deposit; null = legacy row (date+amount match). */
  cashEventId?: string | null;
}

/** Real sectors since 2026-08-12 (owner decision) — vendor-informed but
 * freely editable text, e.g. 'Semiconductors', 'Media', 'Energy'. Two values
 * carry rule semantics: 'Semiconductors' drives the concentration cap, and
 * 'BTC' marks the bitcoin conviction bucket (never trim fuel). Edge cases
 * are curated by hand — NBIS is 'Semiconductors' by thesis, not by vendor. */
export type ParkedCategory = string;

export type DividendFrequency =
  | 'daily'        // e.g. SATA
  | 'weekly'
  | 'semimonthly'  // twice a month, e.g. STRC
  | 'monthly'
  | 'quarterly'
  | 'semiannual'
  | 'annual';

export interface ParkedPosition {
  id: string;
  ticker: string;
  accountId: string;
  /** Display name resolved from the accounts table. */
  account: string;
  category: ParkedCategory;
  shares: number;
  avgCost: number;
  currentPrice: number;
  /** Oldest lot's buy date; null until known (e.g. pending ACATS transfer). */
  buyDate?: string | null;
  trimRank?: number | null;
  /** Manual income estimate: annual dollars per share. Null = no estimate. */
  dividendRate?: number | null;
  dividendFrequency?: DividendFrequency | null;
  /** Assumed annual dividend growth for projections, as a fraction. */
  dividendGrowthPct?: number | null;
  /** May the quote feed price this row? Pile rows: always true. Retirement
   * rows: true only for real fund tickers (JLGMX) — plan codes and annuity
   * units (W146, TRAD) are priced by hand and their codes can collide with
   * real listings. null = pre-migration row: quotable unless retirement. */
  liveQuotes?: boolean | null;
  notes?: string | null;
}

/** One consumed lot's record inside a sale snapshot. Pre-sale absolutes AND
 * removed deltas: undo restores the absolute when nothing else intervened,
 * the delta when something did (a later transfer, another sale). */
export interface SaleSnapshotSlice {
  lotId: string;
  /** shrunk = partial consume; zeroed = DRIP full consume (shares only —
   * amount and ROC rows untouched); deleted = purchase full consume. */
  mode: 'shrunk' | 'zeroed' | 'deleted';
  preShares: number;
  preAmount: number;
  sharesDelta: number;
  /** 0 for zeroed slices. */
  amountDelta: number;
  // Full metadata so a vanished lot can be recreated with its ORIGINAL id.
  date: string | null;
  source: 'purchase' | 'dividend';
  price: number | null;
  classification: DividendClassification | null;
  exDate: string | null;
  reclassifiedAt: string | null;
  rocAllocatedAt: string | null;
  rocOverflow: number | null;
  notes: string | null;
  adjustments: {
    /** Original row id — reused on recreation so retries are idempotent. */
    id: string;
    dividendLotId: string | null;
    preAmount: number;
    /** 0 for zeroed slices. */
    amountDelta: number;
    /** The event's allocation stamp at sale time — a different stamp later
     * means the event was re-allocated and must be re-run, not restored. */
    dividendRocAllocatedAt: string | null;
  }[];
}

/** What a sale consumed, written at sale time so undo can restore exactly. */
export interface ParkedSaleSnapshot {
  version: 1;
  positionId: string;
  /** For recreating the position row when a full trim deleted it. */
  position: {
    category: ParkedCategory;
    avgCost: number;
    currentPrice: number;
    trimRank: number | null;
    dividendRate: number | null;
    dividendFrequency: DividendFrequency | null;
    notes: string | null;
  };
  slices: SaleSnapshotSlice[];
}

/** A parked-pile sale — the pile's own trade log. Real numbers (basis from
 * the lots consumed, LT/ST split) but NEVER score, YTD, or tax-skim math. */
export interface ParkedSale {
  id: string;
  ticker: string;
  accountId: string;
  date: string;
  shares: number;
  pricePerShare: number;
  proceeds: number;
  /** null = unknown (legacy backfill). */
  costBasis?: number | null;
  ltShares?: number | null;
  fundedChallenge: boolean;
  /** RAW purchase-lot dollars this sale consumed (unadjusted, cash-spending
   * lots only). Account-cash math adds it back to the shrunken lot amounts so
   * selling never un-spends the original purchase. null = sale consumed no
   * lots, or predates the account's last reconcile (already absorbed). */
  consumedBasis?: number | null;
  /** Consumption snapshot; null = legacy sale, field-edit only, no undo. */
  consumed?: ParkedSaleSnapshot | null;
  /** Row insert time — gates which ROC allocations postdate the sale. */
  createdAt?: string | null;
  notes?: string | null;
}

/** Real dollars actually moved aside for the pile's tax bill — the action
 * the Income screen's estimate asks for. Record-keeping only; notes say
 * where the money physically sits. Never the challenge's 30% reserve. */
export interface PileTaxSetAside {
  id: string;
  taxYear: number;
  date: string;
  amount: number;
  notes?: string | null;
}

/** Net loss carried INTO taxYear from prior years, stored as a positive number. */
/** A candidate on the bench — researched setups waiting for the rotation.
 * Context only; nothing here touches positions or score math. */
export interface WatchlistItem {
  id: string;
  ticker: string;
  /** The thesis: what's supposed to move it. */
  catalyst?: string | null;
  catalystDate?: string | null;
  /** Free text — an entry zone, not a false-precision number. */
  entryNote?: string | null;
  /** The Rule 8 target, drafted before the entry exists. */
  plannedTarget?: number | null;
  /** Numeric entry price — at/below it, the ENTRY alert fires. */
  entryTrigger?: number | null;
  notes?: string | null;
  createdAt?: string | null;
}

export interface LossCarryforward {
  taxYear: number;
  amount: number;
}

export interface TaxQuarter {
  year: number;
  quarter: 1 | 2 | 3 | 4;
}

export interface TaxReserveCheck extends TaxQuarter {
  /** Last day of the quarter; the alert goes live the day after. */
  endDate: string;
  netRealizedYTD: number;
  reserveTarget: number;
  alreadyReserved: number;
  moveOutNow: number;
}

export interface Snapshot {
  date: string;
  accountValue: number;
  bankedTotal: number;
  reservedTotal: number;
  totalScore: number;
  shadowVooValue: number;
  netContributed: number;
  parkedPileValue: number;
  semiAiPct: number;
  /** The third pot's daily value; null before the retirement feature. */
  retirementValue?: number | null;
  /** The fourth pot: the bitcoin conviction bucket's daily value; null
   * before the split (those days it rode inside parkedPileValue). */
  btcValue?: number | null;
}
