/** Domain types, mirroring SPEC.md's data model. Dates are ISO yyyy-mm-dd strings. */

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

export type AccountKind = 'challenge' | 'outside' | 'bank';

export interface Account {
  id: string;
  name: string;
  broker?: string | null;
  kind: AccountKind;
  notes?: string | null;
}

/** A sale in an outside brokerage — recorded only so Rule 8's cross-account
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
  /** Legacy — the pre-Xu downside exit. Optional since Rules v3 (2026-08-05). */
  bailPoint?: number | null;
  thesis?: string | null;
}

export interface Trade {
  id: string;
  ticker: string;
  openDate: string;
  closeDate: string;
  costBasis: number;
  proceeds: number;
  washSale: boolean;
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
}

export type ParkedCategory = 'Semi/AI' | 'AI-adjacent' | 'BTC' | 'Other';

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
  notes?: string | null;
}

/** Net loss carried INTO taxYear from prior years, stored as a positive number. */
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
}
