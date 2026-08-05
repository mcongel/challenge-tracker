import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Plus, ScrollText, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { AccountSelect } from '../components/ui/AccountSelect';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ErrorCard, SkeletonTable } from './CashLedger';
import { useData } from '../contexts/DataContext';
import {
  netRealizedYTD, realizedGain, realizedPct, roundCents, stLt, taxYearOf, tradeDaysHeld,
} from '../lib/engine';
import {
  cn, formatCurrency, formatPercent, inputCls, labelCls, primaryBtnCls, secondaryBtnCls, todayISO,
} from '../lib/utils';

export function TradeLog() {
  const {
    trades, setTradeWashSale, deleteTrade, outsideSales, accounts, deleteOutsideSale,
    loading, error,
  } = useData();
  const [rowError, setRowError] = useState<string | null>(null);
  const [outsideOpen, setOutsideOpen] = useState(false);
  const [deletingTradeId, setDeletingTradeId] = useState<string | null>(null);
  const [deletingOutsideId, setDeletingOutsideId] = useState<string | null>(null);

  const currentYear = taxYearOf(todayISO());
  const ytd = netRealizedYTD(trades, currentYear);
  const ordered = [...trades].sort((a, b) => b.closeDate.localeCompare(a.closeDate));

  return (
    <div>
      <PageHeader
        title="Trade Log"
        subtitle="Every close. ST = held 365 days or less; wash-sale losses don't count toward YTD."
        actions={
          <button onClick={() => setOutsideOpen(true)}
            className={cn(secondaryBtnCls, 'flex items-center gap-1.5')}>
            <Plus className="h-4 w-4" /> Record outside sale
          </button>
        }
      />

      {error && <ErrorCard message={error} />}
      {rowError && <ErrorCard message={rowError} />}

      <div className="bg-white rounded-lg shadow-lg p-4 mb-4 density-aware-card flex items-baseline justify-between">
        <div>
          <p className="text-xs font-medium text-gray-500">Net realized {currentYear} (drives the tax skim)</p>
          <p className={cn('mt-0.5 text-2xl font-bold tabular-nums', ytd >= 0 ? 'text-green-600' : 'text-red-600')}>
            {formatCurrency(roundCents(ytd))}
          </p>
        </div>
        <p className="text-xs text-gray-400">{trades.length} closed trade{trades.length === 1 ? '' : 's'}</p>
      </div>

      {loading ? (
        <SkeletonTable />
      ) : ordered.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No closed trades yet"
          hint="Trades appear here when positions are closed on the Positions screen."
        />
      ) : (
        <div className="bg-white rounded-lg shadow-lg overflow-x-auto">
          <table className="w-full text-sm compact-table">
            <thead className="bg-gray-50 sticky top-0">
              <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Ticker</th>
                <th className="px-4 py-3">Open</th>
                <th className="px-4 py-3">Close</th>
                <th className="px-4 py-3 text-right">Days</th>
                <th className="px-4 py-3 text-right">Basis</th>
                <th className="px-4 py-3 text-right">Proceeds</th>
                <th className="px-4 py-3 text-right">Gain $</th>
                <th className="px-4 py-3 text-right">Gain %</th>
                <th className="px-4 py-3">Term</th>
                <th className="px-4 py-3">Wash</th>
                <th className="px-4 py-3">Notes</th>
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ordered.map((t) => {
                const gain = realizedGain(t);
                const pct = realizedPct(t);
                const big = Math.abs(pct) > 0.25;
                return (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{t.ticker}</td>
                    <td className="px-4 py-3 tabular-nums text-gray-500">{t.openDate}</td>
                    <td className="px-4 py-3 tabular-nums text-gray-500">{t.closeDate}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{tradeDaysHeld(t)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(t.costBasis)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(t.proceeds)}</td>
                    <td className={cn('px-4 py-3 text-right tabular-nums font-medium',
                      gain >= 0 ? 'text-green-600' : 'text-red-600')}>
                      {formatCurrency(roundCents(gain))}
                    </td>
                    <td className={cn('px-4 py-3 text-right tabular-nums',
                      gain >= 0 ? 'text-green-600' : 'text-red-600')}>
                      {formatPercent(pct)}
                      {big && (
                        <Link to="/rules" className="ml-1.5 text-xs text-indigo-600 hover:text-indigo-800">
                          read the rules
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                        stLt(t) === 'LT' ? 'bg-teal-50 text-teal-700' : 'bg-indigo-50 text-indigo-700')}>
                        {stLt(t)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={t.washSale}
                        onChange={(e) => setTradeWashSale(t.id, e.target.checked).catch((err) =>
                          setRowError(err instanceof Error ? err.message : String(err)))}
                        className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-600"
                        title="Wash sale — loss disallowed"
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-500 max-w-[12rem] truncate">{t.notes}</td>
                    <td className="px-2 py-3">
                      <button onClick={() => setDeletingTradeId(t.id)} className="p-1 rounded hover:bg-red-50" aria-label="Delete trade">
                        <Trash2 className="h-4 w-4 text-gray-300 hover:text-red-600" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Outside sales — the cross-brokerage wash-sale radar (Rule 8). */}
      {outsideSales.length > 0 && (
        <div className="mt-4 bg-white rounded-lg shadow-lg overflow-x-auto">
          <p className="px-4 pt-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Outside sales — wash-sale radar only, never in the score
          </p>
          <table className="w-full text-sm compact-table">
            <tbody className="divide-y divide-gray-100">
              {[...outsideSales].reverse().map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 tabular-nums text-gray-500 w-28">{s.saleDate}</td>
                  <td className="px-4 py-2 font-medium w-20">{s.ticker}</td>
                  <td className="px-4 py-2 text-gray-500">
                    {accounts.find((a) => a.id === s.accountId)?.name ?? '—'}
                  </td>
                  <td className="px-4 py-2">
                    {s.loss ? (
                      <span className="inline-block rounded-full bg-red-50 text-red-700 px-2 py-0.5 text-xs font-medium">
                        loss — 31-day window
                      </span>
                    ) : (
                      <span className="inline-block rounded-full bg-gray-100 text-gray-500 px-2 py-0.5 text-xs font-medium">
                        gain
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-500 max-w-[12rem] truncate">{s.notes}</td>
                  <td className="px-2 py-2 w-10">
                    <button
                      onClick={() => setDeletingOutsideId(s.id)}
                      className="p-1 rounded hover:bg-red-50" aria-label="Delete outside sale">
                      <Trash2 className="h-4 w-4 text-gray-300 hover:text-red-600" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {outsideOpen && <OutsideSaleModal onClose={() => setOutsideOpen(false)} />}

      {deletingTradeId && (
        <ConfirmModal
          title="Delete trade"
          message="Delete this trade? The YTD realized number — and with it the tax skim target — recomputes without it."
          onConfirm={() => deleteTrade(deletingTradeId)}
          onClose={() => setDeletingTradeId(null)}
        />
      )}
      {deletingOutsideId && (
        <ConfirmModal
          title="Delete outside sale"
          message="Delete this outside sale? The wash-sale radar forgets it — a rebuy inside its 31-day window won't be flagged."
          onConfirm={() => deleteOutsideSale(deletingOutsideId)}
          onClose={() => setDeletingOutsideId(null)}
        />
      )}
    </div>
  );
}

function OutsideSaleModal({ onClose }: { onClose: () => void }) {
  const { accounts, addOutsideSale } = useData();
  const outsideAccounts = accounts.filter((a) => a.kind === 'outside');
  const [ticker, setTicker] = useState('');
  const [accountId, setAccountId] = useState(outsideAccounts[0]?.id ?? '');
  const [saleDate, setSaleDate] = useState(todayISO());
  const [loss, setLoss] = useState(true);
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!accountId) return setFormError('Pick the account the sale happened in.');
    setBusy(true);
    try {
      await addOutsideSale({
        ticker: ticker.toUpperCase(),
        accountId,
        saleDate,
        loss,
        notes: notes || null,
      });
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Record outside sale">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Ticker</label>
            <input required value={ticker} onChange={(e) => setTicker(e.target.value)}
              className={inputCls} placeholder="GLW" />
          </div>
          <div>
            <label className={labelCls}>Sale date</label>
            <input type="date" required value={saleDate}
              onChange={(e) => setSaleDate(e.target.value)} className={inputCls} />
          </div>
        </div>
        <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId}
          label="Account" kinds={['outside']} allowNone={false} />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={loss} onChange={(e) => setLoss(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-600" />
          Sold at a loss (starts the 31-day wash-sale window — Rule 8 crosses brokerages)
        </label>
        <div>
          <label className={labelCls}>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </div>
        <p className="text-xs text-gray-400">
          Radar only: this never touches the score, YTD realized, or the tax skim. It exists so a
          challenge-account buy inside the window gets called out.
        </p>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={primaryBtnCls}>
            {busy ? 'Saving…' : 'Record sale'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
