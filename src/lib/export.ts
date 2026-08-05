/** One-click export of everything in the challenge schema — JSON in one file,
 * CSV per table. Doubles as backup. */

type Row = Record<string, unknown>;

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Row[]): string {
  if (rows.length === 0) return '';
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return lines.join('\n');
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadJson(tables: Record<string, unknown>, stamp: string) {
  download(
    `challenge-tracker-${stamp}.json`,
    JSON.stringify({ exportedAt: new Date().toISOString(), ...tables }, null, 2),
    'application/json',
  );
}

export function downloadTableCsv(name: string, rows: Row[], stamp: string) {
  download(`challenge-${name}-${stamp}.csv`, toCsv(rows), 'text/csv');
}
