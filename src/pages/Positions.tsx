import { useMemo, useState } from 'react';
import { AlertTriangle, Pencil, Plus, Scissors, TrendingUp, X } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { ErrorCard, SkeletonTable } from './CashLedger';
import { useData } from '../contexts/DataContext';
import { priceMapFor } from '../lib/alerts';
import type { CloseAllocation, PositionLot } from '../lib/engine';
import {
  addDays, closeShares, costBasis, daysHeld, longTermDate, marketValue, roundCents,
  unrealized, unrealizedPct, washSaleConflicts,
} from '../lib/engine';
import {
  cn, formatCurrency, formatPercent, inputCls, labelCls, primaryBtnCls, secondaryBtnCls, todayISO,
} from '../lib/utils';
import { useNotional } from '../lib/useNotional';

export function Positions() {
  const data = useData();
  const { lots, overrides, quotes, loading, error } = data;
  const priceMap = priceMapFor(lots, overrides, quotes);
  const [addOpen, setAddOpen] = useState(false);
  const [closeTicker, setCloseTicker] = useState<string | null>(null);
  const [splitTicker, setSplitTicker] = useState<string | null>(null);
  const [priceTicker, setPriceTicker] = useState<string | null>(null);

  const today = todayISO();
  const byTicker = useMemo(() => {
    const m = new Map<string, PositionLot[]>();
    for (const lot of lots) (m.get(lot.ticker) ?? m.set(lot.ticker, []).get(lot.ticker)!).push(lot);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [lots]);

  return (
    <div>
      <PageHeader
        title="Positions"
        subtitle="One stock at a time, full position, exit target written at open. Sell into the move, then rotate."
        actions={
          <button onClick={() => setAddOpen(true)} className={cn(primaryBtnCls, 'flex items-center gap-1.5')}>
            <Plus className="h-4 w-4" /> Add position
          </button>
        }
      />

      {error && <ErrorCard message={error} />}

      {loading ? (
        <SkeletonTable />
      ) : byTicker.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="No open positions"
          hint="Each buy becomes its own lot. Closing moves it to the Trade Log and writes the Sell to the Cash Ledger."
        />
      ) : (
        <div className="bg-white rounded-lg shadow-lg overflow-x-auto">
          <table className="w-full text-sm compact-table">
            <thead className="bg-gray-50 sticky top-0">
              <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Lot</th>
                <th className="px-4 py-3 text-right">Shares</th>
                <th className="px-4 py-3 text-right">Avg cost</th>
                <th className="px-4 py-3 text-right">Basis</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-right">Value</th>
                <th className="px-4 py-3 text-right">Unreal $</th>
                <th className="px-4 py-3 text-right">Unreal %</th>
                <th className="px-4 py-3 text-right">Days</th>
                <th className="px-4 py-3">LT on</th>
                <th className="px-4 py-3 text-right">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {byTicker.map(([ticker, tickerLots]) => {
                const hasOverride = overrides[ticker] !== undefined;
                const hasPrice = hasOverride || quotes[ticker] !== undefined;
                const subtotalValue = tickerLots.reduce(
                  (s, l) => s + marketValue(l, priceMap[ticker] ?? l.avgCost), 0);
                const subtotalBasis = tickerLots.reduce((s, l) => s + costBasis(l), 0);
                const gain = subtotalValue - subtotalBasis;
                return [
                  <tr key={ticker} className="bg-gray-50">
                    <td className="px-4 py-2 font-bold" colSpan={4}>
                      <div className="flex items-center gap-2">
                        {ticker}
                        <span className="text-xs font-normal text-gray-400">
                          {tickerLots.length} lot{tickerLots.length > 1 ? 's' : ''}
                        </span>
                        <button onClick={() => setCloseTicker(ticker)}
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
                          Close
                        </button>
                        <button onClick={() => setSplitTicker(ticker)}
                          className="text-xs font-medium text-gray-400 hover:text-gray-600 flex items-center gap-0.5">
                          <Scissors className="h-3 w-3" /> Split
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => setPriceTicker(ticker)}
                        className="inline-flex items-center gap-1 text-xs font-medium tabular-nums text-gray-600 hover:text-indigo-600"
                        title={hasOverride ? 'Manual price (pinned — beats quotes)' : hasPrice ? 'Delayed quote — click to pin a manual price' : 'Set price'}>
                        {hasPrice ? formatCurrency(priceMap[ticker]) : 'set price'}
                        {hasOverride && <span className="text-[10px] uppercase text-amber-800">pin</span>}
                        <Pencil className="h-3 w-3" />
                      </button>
                    </td>
                    <td className="px-4 py-2 text-right font-bold tabular-nums">{formatCurrency(subtotalValue)}</td>
                    <td className={cn('px-4 py-2 text-right font-bold tabular-nums',
                      gain >= 0 ? 'text-green-600' : 'text-red-600')}>
                      {formatCurrency(gain)}
                    </td>
                    <td className={cn('px-4 py-2 text-right font-bold tabular-nums',
                      gain >= 0 ? 'text-green-600' : 'text-red-600')}>
                      {subtotalBasis === 0 ? '—' : formatPercent(gain / subtotalBasis)}
                    </td>
                    <td colSpan={3} />
                  </tr>,
                  ...tickerLots.map((lot) => {
                    const price = priceMap[ticker] ?? lot.avgCost;
                    const u = unrealized(lot, price);
                    return (
                      <tr key={lot.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-500 tabular-nums pl-8">{lot.buyDate}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{lot.shares}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(lot.avgCost)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(roundCents(costBasis(lot)))}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-500">
                          {hasPrice ? formatCurrency(price) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(roundCents(marketValue(lot, price)))}</td>
                        <td className={cn('px-4 py-2 text-right tabular-nums', u >= 0 ? 'text-green-600' : 'text-red-600')}>
                          {formatCurrency(roundCents(u))}
                        </td>
                        <td className={cn('px-4 py-2 text-right tabular-nums', u >= 0 ? 'text-green-600' : 'text-red-600')}>
                          {formatPercent(unrealizedPct(lot, price))}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{daysHeld(lot, today)}</td>
                        <td className="px-4 py-2 tabular-nums text-gray-500">{longTermDate(lot.buyDate)}</td>
                        <td className={cn('px-4 py-2 text-right tabular-nums',
                          price >= lot.exitTarget
                            ? 'font-bold text-green-600'
                            : 'text-gray-500')}>
                          {formatCurrency(lot.exitTarget)}
                          {price >= lot.exitTarget && (
                            <span className="block text-[10px] font-bold uppercase">target hit</span>
                          )}
                        </td>
                      </tr>
                    );
                  }),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      <AddPositionModal isOpen={addOpen} onClose={() => setAddOpen(false)} />
      {closeTicker && <ClosePositionModal ticker={closeTicker} onClose={() => setCloseTicker(null)} />}
      {splitTicker && <SplitModal ticker={splitTicker} onClose={() => setSplitTicker(null)} />}
      {priceTicker && <PriceModal ticker={priceTicker} onClose={() => setPriceTicker(null)} />}
    </div>
  );
}

function AddPositionModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { addLot, lots, trades, outsideSales, parkedSales, accounts } = useData();
  // Pile sales at a loss count for Rule 9 too — merge them into the radar.
  const saleRadar = [
    ...outsideSales,
    ...parkedSales
      .filter((s) => s.costBasis != null && s.proceeds < s.costBasis)
      .map((s) => ({ id: s.id, accountId: s.accountId, ticker: s.ticker, saleDate: s.date, loss: true })),
  ];
  const [ticker, setTicker] = useState('');
  const [buyDate, setBuyDate] = useState(todayISO());
  const { shares, price: avgCost, total, setShares, setPrice, setTotal, reset } = useNotional();
  const [exitTarget, setExitTarget] = useState('');
  const [thesis, setThesis] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Rule 7 — one stock at a time. Warn (not block) so a same-day rotation
  // can be entered in either order.
  const otherOpenTickers = [
    ...new Set(
      lots.map((l) => l.ticker).filter((t) => ticker && t !== ticker.toUpperCase()),
    ),
  ];

  const conflicts = ticker
    ? washSaleConflicts(trades, saleRadar, ticker.toUpperCase(), buyDate)
    : { trades: [], outside: [] };
  const washCitations = [
    ...conflicts.trades.map((t) => `${t.closeDate} (challenge account)`),
    ...conflicts.outside.map(
      (s) => `${s.saleDate} (${accounts.find((a) => a.id === s.accountId)?.name ?? 'outside'})`,
    ),
  ];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!Number(exitTarget)) {
      return setFormError('Exit on the target — Rule 8. Write the target before the entry.');
    }
    setBusy(true);
    try {
      await addLot({
        ticker: ticker.toUpperCase(),
        buyDate,
        shares: Number(shares),
        avgCost: Number(avgCost),
        exitTarget: Number(exitTarget),
        bailPoint: null,
        thesis: thesis || null,
      });
      setTicker(''); reset(); setExitTarget(''); setThesis('');
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add position">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Ticker</label>
            <input required value={ticker} onChange={(e) => setTicker(e.target.value)} className={inputCls} placeholder="NBIS" />
          </div>
          <div>
            <label className={labelCls}>Buy date</label>
            <input type="date" required value={buyDate} onChange={(e) => setBuyDate(e.target.value)} className={inputCls} />
          </div>
        </div>

        {washCitations.length > 0 && (
          <div className="flex gap-2 bg-amber-50 text-amber-800 rounded-md px-3 py-2 text-sm">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              Wash-sale window: {ticker.toUpperCase()} was sold at a loss on{' '}
              {washCitations.join(', ')} — buying within 31 days disallows that loss. Rule 9
              crosses brokerages.
            </span>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Shares</label>
            <input type="number" step="any" min="0.00000001" required value={shares}
              onChange={(e) => setShares(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Avg cost ($)</label>
            <input type="number" step="any" min="0" required value={avgCost}
              onChange={(e) => setPrice(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Total cost ($)</label>
            <input type="number" step="any" min="0" value={total}
              onChange={(e) => setTotal(e.target.value)} className={inputCls}
              title="Enter the broker's filled notional and the per-share price derives — no rounding drift." />
          </div>
        </div>
        <div>
          <label className={labelCls}>Exit target ($) — required</label>
          <input type="number" step="0.01" min="0.01" required value={exitTarget}
            onChange={(e) => setExitTarget(e.target.value)} className={inputCls}
            placeholder="the catalyst move you're selling into" />
        </div>

        {otherOpenTickers.length > 0 && (
          <div className="flex gap-2 bg-amber-50 text-amber-800 rounded-md px-3 py-2 text-sm">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              One stock at a time — Rule 7. {otherOpenTickers.join(', ')}{' '}
              {otherOpenTickers.length > 1 ? 'are' : 'is'} still riding. Xu style is sell, then
              rotate — not split the stack.
            </span>
          </div>
        )}

        <p className="text-xs text-gray-400">
          Exit on the target — Rule 8. The buy also writes itself to the Cash Ledger
          ({shares && avgCost ? formatCurrency(roundCents(Number(shares) * Number(avgCost))) : '$—'}).
        </p>
        <div>
          <label className={labelCls}>Thesis / catalyst</label>
          <input value={thesis} onChange={(e) => setThesis(e.target.value)} className={inputCls} />
        </div>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={primaryBtnCls}>
            {busy ? 'Saving…' : 'Open position'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ClosePositionModal({ ticker, onClose }: { ticker: string; onClose: () => void }) {
  const { lots, closePosition } = useData();
  const tickerLots = lots
    .filter((l) => l.ticker === ticker)
    .sort((a, b) => a.buyDate.localeCompare(b.buyDate));
  const totalShares = tickerLots.reduce((s, l) => s + l.shares, 0);

  const { shares, price, total, setShares, setPrice, setTotal } = useNotional({
    shares: String(totalShares),
  });
  const [closeDate, setCloseDate] = useState(todayISO());
  const [customize, setCustomize] = useState(false);
  const [allocs, setAllocs] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const numShares = Number(shares);
  const numPrice = Number(price);

  const allocations: CloseAllocation[] | undefined = customize
    ? tickerLots
        .map((l) => ({ lotId: l.id, shares: Number(allocs[l.id] ?? 0) }))
        .filter((a) => a.shares > 0)
    : undefined;

  let preview: ReturnType<typeof closeShares> | null = null;
  let previewError: string | null = null;
  if (numShares > 0 && numPrice > 0) {
    try {
      preview = closeShares(lots, ticker, numShares, numPrice, closeDate, allocations);
    } catch (e) {
      previewError = e instanceof Error ? e.message : String(e);
    }
  }
  const realizedTotal = preview
    ? preview.trades.reduce((s, t) => s + (t.proceeds - t.costBasis), 0)
    : 0;

  const enableCustomize = () => {
    // Seed the per-lot inputs from the FIFO allocation so overriding starts sane.
    let remaining = numShares;
    const seed: Record<string, string> = {};
    for (const l of tickerLots) {
      const take = Math.min(l.shares, Math.max(0, remaining));
      seed[l.id] = String(take);
      remaining -= take;
    }
    setAllocs(seed);
    setCustomize(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (previewError) return setFormError(previewError);
    if (!preview) return setFormError('Enter shares and price.');
    setBusy(true);
    try {
      await closePosition(ticker, numShares, numPrice, closeDate, allocations);
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Close ${ticker}`}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Shares (of {totalShares})</label>
            <input type="number" step="any" min="0.00000001" required value={shares}
              onChange={(e) => setShares(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Close date</label>
            <input type="date" required value={closeDate} onChange={(e) => setCloseDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Price / share ($)</label>
            <input type="number" step="any" min="0.00000001" required value={price}
              onChange={(e) => setPrice(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Total proceeds ($)</label>
            <input type="number" step="any" min="0" value={total}
              onChange={(e) => setTotal(e.target.value)} className={inputCls}
              title="Enter the broker's filled notional (net of fees) and the price derives — no rounding drift." />
          </div>
        </div>

        {!customize ? (
          <button type="button" onClick={enableCustomize}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
            Closing oldest lots first (FIFO) — customize per lot
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500">Shares to take from each lot</p>
              <button type="button" onClick={() => setCustomize(false)}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-0.5">
                <X className="h-3 w-3" /> back to FIFO
              </button>
            </div>
            {tickerLots.map((l) => (
              <div key={l.id} className="flex items-center gap-2 text-sm">
                <span className="text-gray-500 tabular-nums w-28">{l.buyDate}</span>
                <span className="text-gray-400 tabular-nums w-20 text-right">{l.shares} sh</span>
                <input type="number" step="any" min="0" max={l.shares} value={allocs[l.id] ?? '0'}
                  onChange={(e) => setAllocs((a) => ({ ...a, [l.id]: e.target.value }))}
                  className={cn(inputCls, 'w-28')} />
              </div>
            ))}
          </div>
        )}

        {previewError && <p className="text-sm text-amber-800 bg-amber-50 rounded-md px-3 py-2">{previewError}</p>}
        {preview && (
          <div className="bg-gray-50 rounded-md px-3 py-2 text-sm space-y-1">
            <p className="text-gray-600">
              {preview.trades.length} trade{preview.trades.length > 1 ? 's' : ''} · proceeds{' '}
              <span className="font-medium tabular-nums">{formatCurrency(roundCents(preview.totalProceeds))}</span>{' '}
              · realized{' '}
              <span className={cn('font-medium tabular-nums', realizedTotal >= 0 ? 'text-green-600' : 'text-red-600')}>
                {formatCurrency(roundCents(realizedTotal))}
              </span>
            </p>
            {realizedTotal < 0 && (
              <p className="text-xs text-amber-800 bg-amber-50 rounded px-2 py-1">
                Selling at a loss: rebuying {ticker} anywhere — any brokerage — before{' '}
                <span className="font-bold tabular-nums">{addDays(closeDate, 31)}</span> disallows
                this loss (Rule 9).
              </p>
            )}
            <p className="text-xs text-gray-400">
              Writes the trades to the Trade Log and the Sell to the Cash Ledger. Remaining shares
              keep their original buy dates.
            </p>
          </div>
        )}
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryBtnCls}>Cancel</button>
          <button type="submit" disabled={busy || !preview} className={primaryBtnCls}>
            {busy ? 'Closing…' : 'Close position'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SplitModal({ ticker, onClose }: { ticker: string; onClose: () => void }) {
  const { recordSplit } = useData();
  const [ratio, setRatio] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = Number(ratio);
    if (!r || r <= 0) return setFormError('Ratio must be positive — e.g. 2 for a 2:1 split.');
    setBusy(true);
    try {
      await recordSplit(ticker, r, todayISO());
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Record split — ${ticker}`}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={labelCls}>Ratio (shares multiply, cost divides)</label>
          <input type="number" step="any" min="0.01" required value={ratio}
            onChange={(e) => setRatio(e.target.value)} className={inputCls} placeholder="2 = 2:1 split" />
        </div>
        <p className="text-xs text-gray-400">
          Applies to all open {ticker} lots and any parked {ticker} position; logs the event in notes.
        </p>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={primaryBtnCls}>{busy ? 'Recording…' : 'Record split'}</button>
        </div>
      </form>
    </Modal>
  );
}

function PriceModal({ ticker, onClose }: { ticker: string; onClose: () => void }) {
  const { overrides, setOverride, clearOverride } = useData();
  const [price, setPrice] = useState(overrides[ticker] ? String(overrides[ticker]) : '');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = Number(price);
    if (!p || p <= 0) return setFormError('Price must be positive.');
    setBusy(true);
    try {
      await setOverride(ticker, p);
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Price — ${ticker}`}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={labelCls}>Manual price ($)</label>
          <input type="number" step="0.01" min="0.01" required value={price} autoFocus
            onChange={(e) => setPrice(e.target.value)} className={inputCls} />
        </div>
        <p className="text-xs text-gray-400">
          Manual prices are pinned — they beat API quotes until cleared.
        </p>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end gap-2">
          {overrides[ticker] !== undefined && (
            <button type="button" disabled={busy} className={secondaryBtnCls}
              onClick={async () => { setBusy(true); try { await clearOverride(ticker); onClose(); } finally { setBusy(false); } }}>
              Clear override
            </button>
          )}
          <button type="submit" disabled={busy} className={primaryBtnCls}>{busy ? 'Saving…' : 'Pin price'}</button>
        </div>
      </form>
    </Modal>
  );
}
