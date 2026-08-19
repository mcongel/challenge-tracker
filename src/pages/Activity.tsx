import { useMemo, useState } from 'react';
import { History, Pencil, Trash2, Undo2 } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ErrorCard } from '../components/ui/ErrorCard';
import { SkeletonTable } from '../components/ui/SkeletonTable';
import { CLASSIFICATION_LABELS, classificationPillCls, fmtSh } from '../components/parked/shared';
import { EditSaleModal } from '../components/parked/EditSaleModal';
import { useData } from '../contexts/DataContext';
import type { DividendClassification, ParkedSale } from '../lib/engine';
import {
  estimatedPileTax, lotCashImpact, roundCents, saleCashImpact, signedParkedCash,
} from '../lib/engine';
import { cn, formatCurrency, formatPercent, inputCls, safeStorage } from '../lib/utils';

/** Every pile event in one filterable stream. Pile only, never the score —
 * the challenge account's history lives on the Cash Ledger and Trade Log. */
const ACTIVITY_PAGE = 50;
const ACTIVITY_KIND_STYLES: Record<string, string> = {
  buy: 'bg-indigo-50 text-indigo-700',
  sell: 'bg-teal-50 text-teal-700',
  dividend: 'bg-sky-50 text-sky-700',
  transfer: 'bg-gray-100 text-gray-600',
  cash: 'bg-green-50 text-green-700',
};

interface ActivityRow {
  key: string;
  date: string | null;
  kind: 'buy' | 'sell' | 'dividend' | 'transfer' | 'cash';
  kindLabel: string;
  ticker: string | null;
  accountId: string | null;
  account: string;
  shares: number | null;
  price: number | null;
  amount: number;
  amountCls: string;
  /** Tracked-cash effect, straight from the engine's row-level functions —
   * the running-balance walk must mirror computeAccountCash exactly. */
  cashImpact: number;
  detail?: string;
  classification?: DividendClassification | null;
  sale?: ParkedSale;
}

function SaleDetail({ sale: s }: { sale: ParkedSale }) {
  const gain = s.costBasis == null ? null : s.proceeds - s.costBasis;
  const term =
    s.ltShares == null ? null
    : s.ltShares >= s.shares - 1e-9 ? 'LT'
    : s.ltShares <= 1e-9 ? 'ST' : 'MIXED';
  return (
    <span className="text-xs">
      <span className={cn('font-medium tabular-nums',
        gain === null ? 'text-gray-400' : gain >= 0 ? 'text-green-600' : 'text-red-600')}>
        {gain === null
          ? 'unknown basis'
          : `${gain >= 0 ? '+' : '−'}${formatCurrency(Math.abs(roundCents(gain)))}`}
      </span>
      {term && (
        <span className={cn('ml-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium',
          term === 'LT' ? 'bg-teal-50 text-teal-700'
          : term === 'ST' ? 'bg-indigo-50 text-indigo-700'
          : 'bg-amber-50 text-amber-800')}>
          {term}
        </span>
      )}
      {s.fundedChallenge && (
        <span className="ml-1 inline-block rounded-full bg-green-50 text-green-700 px-1.5 py-0.5 text-[10px] font-medium">
          → challenge
        </span>
      )}
      {s.notes && <span className="ml-1 text-gray-400">{s.notes}</span>}
    </span>
  );
}

export function Activity() {
  const {
    // Taxable stream only — retirement history lives on the Retirement page.
    // The bitcoin bucket stays in: its buys, sales, and cash are taxable acts.
    taxableParked: allParked, parkedLots, parkedSales: allSales,
    parkedCashEvents: allCashEvents, accounts, retirementAccountIds,
    deleteParkedSale, undoParkedSale, accountCash, ltTaxRate, stTaxRate, loading, error,
  } = useData();
  const parkedSales = useMemo(
    () => allSales.filter((s) => !retirementAccountIds.has(s.accountId)),
    [allSales, retirementAccountIds],
  );
  const parkedCashEvents = useMemo(
    () => allCashEvents.filter((e) => !retirementAccountIds.has(e.accountId)),
    [allCashEvents, retirementAccountIds],
  );

  const [showAll, setShowAll] = useState(false);
  const [editingSale, setEditingSale] = useState<ParkedSale | null>(null);
  const [undoingSale, setUndoingSale] = useState<ParkedSale | null>(null);
  const [deletingSale, setDeletingSale] = useState<ParkedSale | null>(null);

  // Filters persist (1099 season and audits revisit the same slices); stale
  // values fall back to "all" so a vanished ticker can't empty the table.
  const [actFilters, setActFiltersState] = useState<{ account: string; ticker: string; kind: string }>(() => {
    try {
      const stored = JSON.parse(safeStorage.get('pileActivityFilters') ?? 'null');
      if (stored && typeof stored.account === 'string' && typeof stored.ticker === 'string' && typeof stored.kind === 'string') return stored;
    } catch { /* fall through to default */ }
    return { account: '', ticker: '', kind: '' };
  });
  const setActFilters = (f: { account: string; ticker: string; kind: string }) => {
    setActFiltersState(f);
    safeStorage.set('pileActivityFilters', JSON.stringify(f));
  };

  const activity = useMemo<ActivityRow[]>(() => {
    const posById = new Map(allParked.map((p) => [p.id, p]));
    const accName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? '—';
    const rows: ActivityRow[] = [];
    for (const l of parkedLots) {
      const pos = posById.get(l.parkedPositionId);
      if (!pos) continue;
      if (l.source === 'purchase') {
        const isTransfer = l.origin === 'transfer' ||
          (l.origin == null && Boolean(l.notes?.startsWith('ACATS from')));
        rows.push({
          key: `lot-${l.id}`,
          date: l.date,
          kind: isTransfer ? 'transfer' : 'buy',
          kindLabel: isTransfer ? 'transfer in' : 'buy',
          ticker: pos.ticker,
          accountId: pos.accountId,
          account: pos.account,
          shares: l.shares,
          price: l.price ?? null,
          amount: l.amount,
          amountCls: 'text-gray-900',
          cashImpact: lotCashImpact(l),
          detail: l.notes ?? undefined,
        });
      } else {
        // DRIP vs cash keys off price (the house discriminator) — a sold
        // DRIP relic at zero shares is still a DRIP income record.
        const drip = l.price != null;
        rows.push({
          key: `lot-${l.id}`,
          date: l.date,
          kind: 'dividend',
          kindLabel: drip ? 'DRIP' : 'dividend',
          ticker: pos.ticker,
          accountId: pos.accountId,
          account: pos.account,
          shares: l.shares,
          price: l.price ?? null,
          amount: l.amount,
          amountCls: 'text-green-600',
          cashImpact: lotCashImpact(l),
          classification: l.classification ?? 'unclassified',
          detail: l.notes && l.notes !== 'reinvested' && l.notes !== 'cash' ? l.notes : undefined,
        });
      }
    }
    for (const s of parkedSales) {
      rows.push({
        key: `sale-${s.id}`,
        date: s.date,
        kind: 'sell',
        kindLabel: 'sell',
        ticker: s.ticker,
        accountId: s.accountId,
        account: accName(s.accountId),
        shares: s.shares,
        price: s.pricePerShare,
        amount: s.proceeds,
        amountCls: 'text-gray-900',
        cashImpact: saleCashImpact(s),
        sale: s,
      });
    }
    for (const e of parkedCashEvents) {
      rows.push({
        key: `cash-${e.id}`,
        date: e.date,
        kind: 'cash',
        kindLabel: e.type,
        ticker: null,
        accountId: e.accountId,
        account: accName(e.accountId),
        shares: null,
        price: null,
        amount: e.amount,
        amountCls: e.type === 'withdrawal' || e.type === 'fee' || e.amount < 0 ? 'text-red-600' : 'text-green-600',
        cashImpact: signedParkedCash(e),
        detail: e.notes ?? undefined,
      });
    }
    // Newest first; undated rows sink to the bottom.
    return rows.sort((a, b) => (b.date ?? '0000').localeCompare(a.date ?? '0000'));
  }, [allParked, parkedLots, parkedSales, parkedCashEvents, accounts]);

  const actAccounts = useMemo(
    () => accounts.filter((a) => activity.some((r) => r.accountId === a.id)),
    [accounts, activity],
  );
  const actTickers = useMemo(
    () => [...new Set(activity.map((r) => r.ticker).filter(Boolean) as string[])].sort(),
    [activity],
  );
  const actAccount = actAccounts.some((a) => a.id === actFilters.account) ? actFilters.account : '';
  const actTicker = actTickers.includes(actFilters.ticker) ? actFilters.ticker : '';
  const actKind = ['buy', 'sell', 'dividend', 'transfer', 'cash'].includes(actFilters.kind) ? actFilters.kind : '';
  const filtered = useMemo(
    () => activity.filter((r) =>
      (!actAccount || r.accountId === actAccount) &&
      (!actTicker || r.ticker === actTicker) &&
      (!actKind || r.kind === actKind)),
    [activity, actAccount, actTicker, actKind],
  );
  const visible = showAll ? filtered : filtered.slice(0, ACTIVITY_PAGE);

  // Running tracked-cash balance — only when a single account's FULL stream
  // is showing (a ticker/kind filter would hide rows the walk needs). Walked
  // backward from the live balance so the top row always matches the
  // Accounts modal. Each row's impact was stamped at build time from the
  // engine's row-level functions — the same rules computeAccountCash sums.
  const balanceEligible = Boolean(actAccount) && !actTicker && !actKind;
  const runningBalance = useMemo(() => {
    if (!balanceEligible) return new Map<string, number>();
    const m = new Map<string, number>();
    let bal = accountCash(actAccount).balance;
    for (const r of filtered) {
      m.set(r.key, bal);
      bal = roundCents(bal - r.cashImpact);
    }
    return m;
  }, [balanceEligible, filtered, accountCash, actAccount]);

  // Undo is LIFO per holding: only the newest snapshot sale for a
  // ticker+account can be undone (older restores would fight newer state).
  const newestSnapshotSaleIds = useMemo(() => {
    const newest = new Map<string, ParkedSale>();
    for (const s of parkedSales) {
      if (!s.consumed) continue;
      const key = `${s.ticker}|${s.accountId}`;
      const cur = newest.get(key);
      if (!cur || (s.createdAt ?? s.date) > (cur.createdAt ?? cur.date)) newest.set(key, s);
    }
    return new Set([...newest.values()].map((s) => s.id));
  }, [parkedSales]);

  const realized = parkedSales.filter((s) => s.costBasis != null);
  const realizedTotal = realized.reduce((sum, s) => sum + (s.proceeds - (s.costBasis as number)), 0);
  const estTaxTotal = realized.reduce(
    (sum, s) =>
      sum + estimatedPileTax(s.proceeds - (s.costBasis as number), s.shares, s.ltShares, ltTaxRate, stTaxRate),
    0,
  );
  const unknownBasisCount = parkedSales.length - realized.length;

  return (
    <div>
      <PageHeader
        title="Activity"
        subtitle="Every pile event — buys, sells, dividends, transfers, cash. Context only, never the score; the challenge account's history lives on the Cash Ledger and Trade Log."
      />

      {error && <ErrorCard message={error} />}

      {loading ? (
        <SkeletonTable />
      ) : activity.length === 0 ? (
        <EmptyState
          icon={History}
          title="No activity yet"
          hint="Buys, sells, dividends, and account cash movements all land here as they're recorded on the Parked Pile screen."
        />
      ) : (
        <div className="bg-white rounded-lg shadow-lg">
          <div className="px-4 pt-3 pb-1 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm tabular-nums">
              <span className="text-gray-500">Realized: </span>
              <span className={cn('font-bold', realizedTotal >= 0 ? 'text-green-600' : 'text-red-600')}>
                {formatCurrency(roundCents(realizedTotal))}
              </span>
              {estTaxTotal > 0 && (
                <span className="text-xs text-gray-400" title={`Rough estimate (~${formatPercent(ltTaxRate, 0)} LT / ~${formatPercent(stTaxRate, 0)} ST — editable on Tax Reserve). The quarterly skim is challenge-account-only — set this aside yourself.`}>
                  {' '}· est. tax {formatCurrency(roundCents(estTaxTotal))}
                </span>
              )}
              {unknownBasisCount > 0 && (
                <span className="text-xs text-gray-400"> · {unknownBasisCount} sale{unknownBasisCount > 1 ? 's' : ''} with unknown basis excluded</span>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select value={actAccount} onChange={(e) => setActFilters({ account: e.target.value, ticker: actTicker, kind: actKind })}
                className={cn(inputCls, 'w-auto py-1 text-xs')} aria-label="Filter by account">
                <option value="">All accounts</option>
                {actAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <select value={actTicker} onChange={(e) => setActFilters({ account: actAccount, ticker: e.target.value, kind: actKind })}
                className={cn(inputCls, 'w-auto py-1 text-xs')} aria-label="Filter by ticker">
                <option value="">All tickers</option>
                {actTickers.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={actKind} onChange={(e) => setActFilters({ account: actAccount, ticker: actTicker, kind: e.target.value })}
                className={cn(inputCls, 'w-auto py-1 text-xs')} aria-label="Filter by type">
                <option value="">All types</option>
                <option value="buy">Buys</option>
                <option value="sell">Sells</option>
                <option value="dividend">Dividends</option>
                <option value="transfer">Transfers</option>
                <option value="cash">Cash</option>
              </select>
            </div>
          </div>
          {/* Only the table scrolls sideways — the summary/filter bar above stays put. */}
          <div className="overflow-x-auto">
          <table className="w-full text-sm compact-table">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Ticker</th>
                <th className="px-4 py-2">Account</th>
                <th className="px-4 py-2 text-right">Shares</th>
                <th className="px-4 py-2 text-right">Price</th>
                <th className="px-4 py-2 text-right">Amount</th>
                {balanceEligible && (
                  <th className="px-4 py-2 text-right"
                    title="Tracked cash after this event. Exact from the last reconcile forward; below a reconcile adjustment the numbers show the pre-heal record.">
                    Balance
                  </th>
                )}
                <th className="px-4 py-2">Detail</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((r) => (
                <tr key={r.key} className="hover:bg-gray-50">
                  <td className={cn('px-4 py-2 tabular-nums whitespace-nowrap', r.date ? 'text-gray-500' : 'text-amber-800')}>
                    {r.date ?? 'no date'}
                  </td>
                  <td className="px-4 py-2">
                    <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', ACTIVITY_KIND_STYLES[r.kind])}>
                      {r.kindLabel}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-medium">{r.ticker ?? <span className="text-gray-400">—</span>}</td>
                  <td className="px-4 py-2 text-gray-500">{r.account}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.shares != null && r.shares > 0 ? fmtSh(r.shares) : '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-500">{r.price != null ? formatCurrency(r.price) : '—'}</td>
                  <td className={cn('px-4 py-2 text-right tabular-nums font-medium', r.amountCls)}>
                    {formatCurrency(roundCents(r.amount))}
                  </td>
                  {balanceEligible && (
                    <td className={cn('px-4 py-2 text-right tabular-nums',
                      (runningBalance.get(r.key) ?? 0) < -0.005 ? 'text-red-600' : 'text-gray-500')}>
                      {formatCurrency(runningBalance.get(r.key) ?? 0)}
                    </td>
                  )}
                  <td className="px-4 py-2">
                    {r.sale ? <SaleDetail sale={r.sale} /> : (
                      <span className="text-xs text-gray-500">
                        {r.classification && (
                          <span className={cn('mr-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                            classificationPillCls(r.classification))}>
                            {CLASSIFICATION_LABELS[r.classification]}
                          </span>
                        )}
                        {r.detail}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    {r.sale && (
                      <>
                        {r.sale.consumed && (
                          <button
                            onClick={() => setUndoingSale(r.sale!)}
                            disabled={!newestSnapshotSaleIds.has(r.sale.id)}
                            className="p-2 sm:p-1 rounded hover:bg-gray-100 disabled:opacity-30"
                            aria-label="Undo sale"
                            title={newestSnapshotSaleIds.has(r.sale.id)
                              ? 'Undo — lots and basis come back exactly'
                              : 'Undo newer sales of this holding first'}
                          >
                            <Undo2 className="h-4 w-4 text-gray-300 hover:text-gray-600" />
                          </button>
                        )}
                        <button onClick={() => setEditingSale(r.sale!)} className="p-2 sm:p-1 rounded hover:bg-gray-100" aria-label="Edit sale record">
                          <Pencil className="h-4 w-4 text-gray-300 hover:text-gray-600" />
                        </button>
                        <button onClick={() => setDeletingSale(r.sale!)} className="p-2 sm:p-1 rounded hover:bg-red-50" aria-label="Delete sale record">
                          <Trash2 className="h-4 w-4 text-gray-300 hover:text-red-600" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={balanceEligible ? 10 : 9} className="px-4 py-6 text-sm text-gray-400 text-center">Nothing matches the filters</td></tr>
              )}
            </tbody>
          </table>
          </div>
          {filtered.length > ACTIVITY_PAGE && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="w-full py-2 text-xs font-medium text-indigo-600 hover:text-indigo-800 border-t border-gray-100"
            >
              {showAll ? 'Show recent only' : `Show all ${filtered.length} events`}
            </button>
          )}
        </div>
      )}

      {deletingSale && (
        <ConfirmModal
          title="Delete sale record"
          message={`Delete the ${deletingSale.ticker} sale from ${deletingSale.date} (${formatCurrency(deletingSale.proceeds)})? This removes only the history record — it does not restore shares or lots.${deletingSale.consumed ? ` If you want the shares back, use Undo instead. Deleting the record also lifts the check that stops OLDER ${deletingSale.ticker} sales from being undone out of order — their Undo could then restore lots this sale already consumed.` : ''}`}
          onConfirm={() => deleteParkedSale(deletingSale.id)}
          onClose={() => setDeletingSale(null)}
        />
      )}
      {undoingSale && (
        <ConfirmModal
          title="Undo sale"
          message={`Undo the ${undoingSale.ticker} sale from ${undoingSale.date} (${fmtSh(undoingSale.shares)} sh, ${formatCurrency(undoingSale.proceeds)})? Lots, basis, and ROC adjustments come back exactly; ROC recorded after this sale is recomputed over the restored lots.${undoingSale.fundedChallenge ? ' IMPORTANT: this sale funded the challenge — the ledger Deposit and its shadow VOO twin are NOT removed. Fix the Cash Ledger yourself.' : ''}`}
          confirmLabel="Undo sale"
          onConfirm={() => undoParkedSale(undoingSale.id)}
          onClose={() => setUndoingSale(null)}
        />
      )}
      {editingSale && <EditSaleModal sale={editingSale} onClose={() => setEditingSale(null)} />}
    </div>
  );
}
