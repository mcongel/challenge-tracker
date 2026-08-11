/** All date math on ISO yyyy-mm-dd strings, evaluated at UTC midnight so a
 * calendar day is a calendar day regardless of local timezone. */

const MS_PER_DAY = 86_400_000;

export function toUTC(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b (positive when b is later) — the workbook's `b - a`. */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / MS_PER_DAY);
}

export function addDays(iso: string, days: number): string {
  return toISO(new Date(toUTC(iso).getTime() + days * MS_PER_DAY));
}

/** Calendar-month add with end-of-month clamping (Jan 31 + 1mo → Feb 28/29). */
export function addMonths(iso: string, months: number): string {
  const d = toUTC(iso);
  const targetMonth = d.getUTCMonth() + months;
  const year = d.getUTCFullYear() + Math.floor(targetMonth / 12);
  const month = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return toISO(new Date(Date.UTC(year, month, Math.min(d.getUTCDate(), lastDay))));
}

/** Long-term threshold: holding > 365 days, so LT begins on buyDate + 366. */
export function longTermDate(buyDate: string): string {
  return addDays(buyDate, 366);
}

export function taxYearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

export function quarterOf(iso: string): 1 | 2 | 3 | 4 {
  return (Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}

export function quarterEndDate(year: number, quarter: 1 | 2 | 3 | 4): string {
  const lastDay = ['03-31', '06-30', '09-30', '12-31'][quarter - 1];
  return `${year}-${lastDay}`;
}
