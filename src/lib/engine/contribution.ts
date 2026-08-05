/** Rule 11 — the contribution cap. Net contributed (deposits − withdrawals)
 * caps at a configured value; once reached the account grows only by trading. */

export type ContributionState = 'OK' | 'NEARING' | 'REACHED';

export interface ContributionStatus {
  cap: number;
  used: number;
  remaining: number;
  state: ContributionState;
}

export const NEARING_THRESHOLD = 0.8;

export function contributionStatus(netContributed: number, cap: number): ContributionStatus {
  const remaining = Math.max(0, cap - netContributed);
  const state: ContributionState =
    netContributed >= cap ? 'REACHED' : netContributed >= NEARING_THRESHOLD * cap ? 'NEARING' : 'OK';
  return { cap, used: netContributed, remaining, state };
}

/** Would adding this deposit push net contributed past the cap? */
export function depositExceedsCap(
  netContributed: number,
  depositAmount: number,
  cap: number,
): boolean {
  return netContributed + depositAmount > cap;
}
