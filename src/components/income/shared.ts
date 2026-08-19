import type { ParkedLot } from '../../lib/engine';

export interface HistRow {
  lot: ParkedLot;
  ticker: string;
  account: string;
}
