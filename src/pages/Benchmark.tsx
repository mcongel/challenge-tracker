import { useState } from 'react';
import { Pencil, Swords } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { ErrorCard, SkeletonTable } from './CashLedger';
import { useData } from '../contexts/DataContext';
import { priceMapFor } from '../lib/alerts';
import {
  lead, leadPct, roundCents, rollingLeadDelta, shadowShares, shadowValue, totalScore,
} from '../lib/engine';
import {
  cn, errorMessage, formatCurrency, formatPercent, inputCls, labelCls, primaryBtnCls, todayISO,
} from '../lib/utils';

export function Benchmark() {
  const {
    benchmarkDeposits, lots, cashEvents, milestones, snapshots, overrides, overrideSetAt, quotes,
    setOverride, clearOverride, loading, error,
  } = useData();
  const [priceOpen, setPriceOpen] = useState(false);

  const vooPinned = overrides['VOO'];
  const vooToday = vooPinned ?? quotes['VOO'];
  const score = totalScore(lots, priceMapFor(lots, overrides, quotes), cashEvents, milestones);
  const shadow = vooToday ? shadowValue(benchmarkDeposits, vooToday) : null;
  const delta = rollingLeadDelta(snapshots, todayISO());

  return (
    <div>
      <PageHeader
        title="Benchmark"
        subtitle="The honest test: every deposit buys shadow VOO the same day. Beat the shadow over rolling 12 months and the edge is real."
        actions={
          <button
            onClick={() => setPriceOpen(true)}
            className={cn(primaryBtnCls, 'flex items-center gap-1.5')}
            title={vooPinned !== undefined
              ? `Pinned manual price — beats the live quote${overrideSetAt['VOO'] ? `, set ${overrideSetAt['VOO'].slice(0, 10)}` : ''}`
              : 'Live quote — click to pin a manual price'}
          >
            <Pencil className="h-4 w-4" />
            {vooToday ? `VOO ${formatCurrency(vooToday)}` : 'Set VOO price'}
            {vooPinned !== undefined && (
              <span className="text-[10px] uppercase font-bold opacity-80">pin</span>
            )}
          </button>
        }
      />

      {error && <ErrorCard message={error} />}

      {/* The race */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-white rounded-lg shadow-lg p-4 density-aware-card">
          <p className="text-xs font-medium text-gray-500">You (Total Score)</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-gray-900">{formatCurrency(roundCents(score))}</p>
        </div>
        <div className="bg-white rounded-lg shadow-lg p-4 density-aware-card">
          <p className="text-xs font-medium text-gray-500">Shadow VOO</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-gray-900">
            {shadow === null ? '—' : formatCurrency(roundCents(shadow))}
          </p>
          {shadow === null && <p className="text-xs text-gray-400 mt-0.5">set today's VOO price</p>}
        </div>
        <div className="bg-white rounded-lg shadow-lg p-4 density-aware-card">
          <p className="text-xs font-medium text-gray-500">Lead</p>
          {shadow === null ? (
            <p className="mt-0.5 text-2xl font-bold text-gray-400">—</p>
          ) : (
            <p className={cn('mt-0.5 text-2xl font-bold tabular-nums',
              lead(score, shadow) >= 0 ? 'text-green-600' : 'text-red-600')}>
              {formatCurrency(roundCents(lead(score, shadow)))}
              <span className="ml-2 text-sm font-medium">{formatPercent(leadPct(score, shadow))}</span>
            </p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-lg p-4 mb-4 density-aware-card">
        <p className="text-xs font-medium text-gray-500">Rolling 12-month verdict</p>
        {delta === null ? (
          <p className="mt-0.5 text-sm text-gray-400">
            Needs a year of daily snapshots — the verdict unlocks {snapshots.length > 0 ? 'as history accumulates' : 'once the scoreboard starts recording'}.
          </p>
        ) : (
          <p className={cn('mt-0.5 text-xl font-bold tabular-nums', delta >= 0 ? 'text-green-600' : 'text-red-600')}>
            {delta >= 0 ? 'AHEAD' : 'BEHIND'} by {formatCurrency(roundCents(Math.abs(delta)))} over the trailing year
            <span className="ml-2 text-xs font-normal text-gray-400">
              {delta >= 0 ? 'edge demonstrated — adding capital is investing' : 'the experiment is answering the question'}
            </span>
          </p>
        )}
      </div>

      {loading ? (
        <SkeletonTable />
      ) : benchmarkDeposits.length === 0 ? (
        <EmptyState
          icon={Swords}
          title="No shadow purchases yet"
          hint="Each deposit on the Cash Ledger creates one automatically — amount ÷ that day's VOO price."
        />
      ) : (
        <div className="bg-white rounded-lg shadow-lg overflow-x-auto">
          <table className="w-full text-sm compact-table">
            <thead className="bg-gray-50 sticky top-0">
              <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Deposit date</th>
                <th className="px-4 py-3 text-right">Amount in</th>
                <th className="px-4 py-3 text-right">VOO that day</th>
                <th className="px-4 py-3 text-right">Shadow shares</th>
                <th className="px-4 py-3 text-right">Worth today</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {benchmarkDeposits.map((d) => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 tabular-nums text-gray-600">{d.date}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(d.amount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(d.vooPriceThatDay)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{shadowShares(d).toFixed(6)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">
                    {vooToday ? formatCurrency(roundCents(shadowShares(d) * vooToday)) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-xs text-gray-400 border-t border-gray-100">
            Two honesty notes: the shadow ignores VOO dividends (~1.3%/yr — flatters you), and the raw
            comparison ignores taxes (short-term gains ~28–30% vs ~21% long-term VOO — flatters you
            too). The real hurdle is higher than the lead suggests.
          </p>
        </div>
      )}

      {priceOpen && (
        <VooPriceModal
          current={vooToday}
          pinned={vooPinned !== undefined}
          onClose={() => setPriceOpen(false)}
          onSet={setOverride}
          onClear={() => clearOverride('VOO')}
        />
      )}
    </div>
  );
}

function VooPriceModal({
  current, pinned, onClose, onSet, onClear,
}: {
  current?: number;
  pinned: boolean;
  onClose: () => void;
  onSet: (ticker: string, price: number) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [price, setPrice] = useState(current ? String(current) : '');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = Number(price);
    if (!p || p <= 0) return setFormError('Price must be positive.');
    setBusy(true);
    try {
      await onSet('VOO', p);
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="VOO price today">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={labelCls}>Price ($)</label>
          <input type="number" step="0.01" min="0.01" required autoFocus value={price}
            onChange={(e) => setPrice(e.target.value)} className={inputCls} />
        </div>
        <p className="text-xs text-gray-400">
          Setting a price pins it — it beats the live quote until cleared. With no pin, the delayed
          quote feed prices the shadow automatically.
        </p>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className={cn('flex', pinned ? 'justify-between' : 'justify-end')}>
          {pinned && (
            <button
              type="button"
              disabled={busy}
              className="text-sm font-medium text-red-600 hover:text-red-800"
              onClick={async () => {
                setBusy(true);
                try {
                  await onClear();
                  onClose();
                } catch (err) {
                  setFormError(errorMessage(err));
                  setBusy(false);
                }
              }}
            >
              Clear pin — use live quote
            </button>
          )}
          <button type="submit" disabled={busy} className={primaryBtnCls}>{busy ? 'Saving…' : 'Pin price'}</button>
        </div>
      </form>
    </Modal>
  );
}
