import { useMemo, useState } from 'react';
import { AlertTriangle, Pencil, Plus, Telescope, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ErrorCard, SkeletonTable } from './CashLedger';
import { useData } from '../contexts/DataContext';
import type { WatchlistItem } from '../lib/engine';
import { addDays, daysBetween, washSaleConflicts, WASH_SALE_WINDOW_DAYS } from '../lib/engine';
import {
  cn, errorMessage, formatCurrency, inputCls, labelCls, primaryBtnCls, secondaryBtnCls, todayISO,
} from '../lib/utils';
import { useIndustries } from '../lib/useIndustries';

/** The bench. Rule 7's rotation — sell into strength, then rotate — only
 * works when the next setup is already researched. Candidates wait here
 * with the catalyst, its date, and the Rule 8 target drafted BEFORE entry. */
export function Watchlist() {
  const {
    watchlist, trades, outsideSales, parkedSales, lots, quotes, overrides,
    deleteWatchlistItem, loading, error,
  } = useData();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<WatchlistItem | null>(null);
  const [deleting, setDeleting] = useState<WatchlistItem | null>(null);
  const today = todayISO();

  // Same radar the Positions form uses — a bench name inside the wash window
  // gets flagged before it becomes a buy, not after.
  const saleRadar = useMemo(
    () => [
      ...outsideSales,
      ...parkedSales
        .filter((s) => s.costBasis == null || s.proceeds < s.costBasis)
        .map((s) => ({
          id: s.id, accountId: s.accountId, ticker: s.ticker, saleDate: s.date,
          loss: true, notes: null,
        })),
    ],
    [outsideSales, parkedSales],
  );

  // Soonest catalyst first; undated candidates last, then by created order.
  const ordered = useMemo(
    () => [...watchlist].sort((a, b) =>
      (a.catalystDate ?? '9999').localeCompare(b.catalystDate ?? '9999')),
    [watchlist],
  );
  const openTickers = new Set(lots.map((l) => l.ticker));
  const industries = useIndustries(watchlist.map((w) => w.ticker));

  return (
    <div>
      <PageHeader
        title="Watchlist"
        subtitle="The bench. Sell into strength, then rotate — to a setup that's already researched, with the exit target drafted before the entry exists."
        actions={
          <button onClick={() => setAdding(true)} className={cn(primaryBtnCls, 'flex items-center gap-1.5')}>
            <Plus className="h-4 w-4" /> Add candidate
          </button>
        }
      />

      {error && <ErrorCard message={error} />}

      {loading ? (
        <SkeletonTable />
      ) : ordered.length === 0 ? (
        <EmptyState
          icon={Telescope}
          title="Empty bench"
          hint="Add the setups you're researching: the catalyst, its date, an entry zone, and the target you'd write at open. When a position closes, the rotation starts here."
        />
      ) : (
        <div className="bg-white rounded-lg shadow-lg overflow-x-auto">
          <table className="w-full text-sm compact-table">
            <thead className="bg-gray-50 sticky top-0">
              <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Ticker</th>
                <th className="px-4 py-3">Catalyst</th>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Entry zone</th>
                <th className="px-4 py-3 text-right">Planned target</th>
                <th className="px-4 py-3 text-right">Price now</th>
                <th className="px-4 py-3">Notes</th>
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ordered.map((w) => {
                const conflicts = washSaleConflicts(trades, saleRadar, w.ticker, today);
                const washed = conflicts.trades.length > 0 || conflicts.outside.length > 0;
                const washUntil = washed
                  ? addDays(
                      [...conflicts.trades.map((t) => t.closeDate),
                       ...conflicts.outside.map((s) => s.saleDate)].sort().at(-1)!,
                      WASH_SALE_WINDOW_DAYS,
                    )
                  : null;
                const livePrice = overrides[w.ticker] ?? quotes[w.ticker];
                const days = w.catalystDate ? daysBetween(today, w.catalystDate) : null;
                return (
                  <tr key={w.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">
                      {w.ticker}
                      {openTickers.has(w.ticker) && (
                        <span className="ml-1.5 inline-block rounded-full bg-green-50 text-green-700 px-1.5 py-0.5 text-[10px] font-medium"
                          title="Currently the open challenge position.">
                          riding
                        </span>
                      )}
                      {washed && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-amber-50 text-amber-800 px-1.5 py-0.5 text-[10px] font-medium"
                          title={`Sold at a loss within the last ${WASH_SALE_WINDOW_DAYS} days — buying before ${washUntil} disallows that loss (Rule 9).`}>
                          <AlertTriangle className="h-3 w-3" /> wash until {washUntil}
                        </span>
                      )}
                      {industries[w.ticker] && (
                        <span className="block text-xs font-normal text-gray-400">{industries[w.ticker]}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600" title={w.catalyst ?? undefined}>
                      <div className="max-w-[16rem] truncate">{w.catalyst ?? <span className="text-gray-400">—</span>}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                      {w.catalystDate ? (
                        <>
                          <span className="text-gray-600">{w.catalystDate}</span>
                          {days != null && (
                            <span className={cn('ml-1.5 text-xs',
                              days < 0 ? 'text-gray-400' : days <= 7 ? 'font-bold text-amber-700' : 'text-gray-400')}>
                              {days < 0 ? `${-days}d ago` : days === 0 ? 'today' : `in ${days}d`}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {w.entryNote ?? <span className="text-gray-400">—</span>}
                      {w.entryTrigger != null && (
                        <span className="block text-xs text-gray-400 tabular-nums"
                          title="Dashboard alert fires at/below this price.">
                          alert ≤ {formatCurrency(w.entryTrigger)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {w.plannedTarget != null ? formatCurrency(w.plannedTarget) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                      {livePrice != null ? formatCurrency(livePrice) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500" title={w.notes ?? undefined}>
                      <div className="max-w-[14rem] truncate">{w.notes}</div>
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap">
                      <button onClick={() => setEditing(w)} className="p-2 sm:p-1 rounded hover:bg-gray-100" aria-label="Edit candidate">
                        <Pencil className="h-4 w-4 text-gray-300 hover:text-gray-600" />
                      </button>
                      <button onClick={() => setDeleting(w)} className="p-2 sm:p-1 rounded hover:bg-red-50" aria-label="Remove candidate">
                        <Trash2 className="h-4 w-4 text-gray-300 hover:text-red-600" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-4 py-3 text-xs text-gray-400 border-t border-gray-100">
            Research notes only — nothing here trades or touches the score. Prices are the same
            delayed quotes as everywhere else; hit refresh in the header if the stamp looks stale.
          </p>
        </div>
      )}

      {(adding || editing) && (
        <CandidateModal item={editing} onClose={() => { setAdding(false); setEditing(null); }} />
      )}
      {deleting && (
        <ConfirmModal
          title={`Remove ${deleting.ticker} from the bench`}
          message={`Remove ${deleting.ticker}${deleting.catalyst ? ` (${deleting.catalyst})` : ''}? Research notes only — nothing else is affected.`}
          confirmLabel="Remove"
          onConfirm={() => deleteWatchlistItem(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function CandidateModal({ item, onClose }: { item: WatchlistItem | null; onClose: () => void }) {
  const { addWatchlistItem, updateWatchlistItem } = useData();
  const [ticker, setTicker] = useState(item?.ticker ?? '');
  const [catalyst, setCatalyst] = useState(item?.catalyst ?? '');
  const [catalystDate, setCatalystDate] = useState(item?.catalystDate ?? '');
  const [entryNote, setEntryNote] = useState(item?.entryNote ?? '');
  const [entryTrigger, setEntryTrigger] = useState(
    item?.entryTrigger != null ? String(item.entryTrigger) : '',
  );
  const [plannedTarget, setPlannedTarget] = useState(
    item?.plannedTarget != null ? String(item.plannedTarget) : '',
  );
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!ticker.trim()) return setFormError('Ticker required.');
    const target = plannedTarget === '' ? null : Number(plannedTarget);
    if (target != null && (Number.isNaN(target) || target <= 0)) {
      return setFormError('Planned target must be a positive price.');
    }
    const trigger = entryTrigger === '' ? null : Number(entryTrigger);
    if (trigger != null && (Number.isNaN(trigger) || trigger <= 0)) {
      return setFormError('Entry trigger must be a positive price.');
    }
    setBusy(true);
    try {
      const payload = {
        ticker: ticker.trim().toUpperCase(),
        catalyst: catalyst || null,
        catalystDate: catalystDate || null,
        entryNote: entryNote || null,
        entryTrigger: trigger,
        plannedTarget: target,
        notes: notes || null,
      };
      if (item) await updateWatchlistItem(item.id, payload);
      else await addWatchlistItem(payload);
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={item ? `Edit ${item.ticker}` : 'Add candidate'}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Ticker</label>
            <input required value={ticker} onChange={(e) => setTicker(e.target.value)}
              className={inputCls} placeholder="NBIS" autoFocus={!item} />
          </div>
          <div>
            <label className={labelCls}>Catalyst date</label>
            <input type="date" value={catalystDate} onChange={(e) => setCatalystDate(e.target.value)}
              className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Catalyst — what moves it?</label>
          <input value={catalyst} onChange={(e) => setCatalyst(e.target.value)}
            className={inputCls} placeholder="Q3 earnings; new fab ramp guidance" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Entry zone</label>
            <input value={entryNote} onChange={(e) => setEntryNote(e.target.value)}
              className={inputCls} placeholder="55–58 on a pullback" />
          </div>
          <div>
            <label className={labelCls} title="At or below this price, the Dashboard fires the ENTRY alert.">
              Entry trigger ($)
            </label>
            <input type="number" step="any" min="0.01" value={entryTrigger}
              onChange={(e) => setEntryTrigger(e.target.value)} className={inputCls}
              placeholder="alert at/below" />
          </div>
          <div>
            <label className={labelCls}>Planned target ($)</label>
            <input type="number" step="any" min="0.01" value={plannedTarget}
              onChange={(e) => setPlannedTarget(e.target.value)} className={inputCls}
              placeholder="the exit you'd write at open" />
          </div>
        </div>
        <div>
          <label className={labelCls}>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </div>
        <p className="text-xs text-gray-400">
          Drafting the target now is the point — Rule 8 wants it written before the money moves.
          It prefills nothing; the real target gets typed at open, with fresh eyes.
        </p>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryBtnCls}>Cancel</button>
          <button type="submit" disabled={busy} className={primaryBtnCls}>
            {busy ? 'Saving…' : item ? 'Save' : 'Add to bench'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
