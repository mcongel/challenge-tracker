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
  notes?: string | null;
}

/** One purchase = one lot. A ticker may hold several open lots. */
export interface PositionLot {
  id: string;
  ticker: string;
  buyDate: string;
  shares: number;
  avgCost: number;
  exitTarget: number;
  bailPoint: number;
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
