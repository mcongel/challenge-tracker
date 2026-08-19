/**
 * Money policy: derived chains keep full float precision (matching the
 * workbook, which only rounds at display). Round to cents ONLY at defined
 * boundaries — display and DB writes — via roundCents.
 */
/** 6dp rounding for basis-adjustment math — allocations across many lots go
 * sub-cent, and rounding to cents per row would drift reconstructed basis. */
export function round6(n: number): number {
  return (Math.sign(n) * Math.round(Math.abs(n) * 1e6 + Number.EPSILON)) / 1e6;
}

/** Half-away-from-zero (Excel ROUND), so gains and losses round symmetrically. */
export function roundCents(n: number): number {
  return (Math.sign(n) * Math.round(Math.abs(n) * 100 + Number.EPSILON)) / 100;
}

export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
