import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Landmark } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Modal } from '../components/ui/Modal';
import { ErrorCard, SkeletonTable } from './CashLedger';
import { useData } from '../contexts/DataContext';
import { priceMapFor } from '../lib/alerts';
import type { MilestoneRow } from '../lib/engine';
import { accountTotal, cumulativeFloor, milestoneTable, roundCents, skimDue } from '../lib/engine';
import { cn, formatCurrency, inputCls, labelCls, primaryBtnCls, todayISO } from '../lib/utils';

export function Milestones() {
  const { lots, cashEvents, milestones, overrides, quotes, loading, error } = useData();
  const [banking, setBanking] = useState<MilestoneRow | null>(null);
  const [justBanked, setJustBanked] = useState(false);

  const account = accountTotal(lots, priceMapFor(lots, overrides, quotes), cashEvents);
  const rows = milestoneTable(account, milestones);
  const hits = rows.filter((r) => r.status === 'HIT_BANK_NOW');
  const floor = cumulativeFloor(milestones);

  return (
    <div>
      <PageHeader
        title="Milestones"
        subtitle="Below $100k everything rides. At each level: bank 25% into VOO in the parked pile. The floor only rises."
      />

      {error && <ErrorCard message={error} />}

      {/* The championship moment — persistent until the banking event is recorded. */}
      {hits.map((row) => (
        <div
          key={row.level}
          className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-4 sm:px-6 animate-fade-in-up"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
            Milestone hit — {formatCurrency(row.level)} crossed
          </p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <p className="font-display text-3xl sm:text-4xl font-bold text-emerald-700" style={{ letterSpacing: '-0.02em' }}>
              BANK {formatCurrency(row.skimDue)} NOW
            </p>
            <button onClick={() => setBanking(row)} className={primaryBtnCls}>
              Record banking
            </button>
          </div>
          <p className="mt-1 text-xs text-emerald-700/80">
            25% of the account, into VOO in the parked pile. Banked money never returns to the table.
          </p>
        </div>
      ))}

      {justBanked && (
        <div className="mb-4 rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 text-sm text-gray-600 flex items-center justify-between">
          <span>Banked. The floor just rose — permanently.</span>
          <Link to="/rules" className="text-indigo-600 hover:text-indigo-800 font-medium">
            Read the rules
          </Link>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-lg p-4 mb-4 density-aware-card flex items-baseline gap-6">
        <div>
          <p className="text-xs font-medium text-gray-500">Banked floors (locked forever)</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-green-600">{formatCurrency(floor)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500">Account value</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-gray-900">{formatCurrency(roundCents(account))}</p>
        </div>
      </div>

      {loading ? (
        <SkeletonTable />
      ) : (
        <div className="bg-white rounded-lg shadow-lg overflow-x-auto">
          <table className="w-full text-sm compact-table">
            <thead className="bg-gray-50 sticky top-0">
              <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Milestone</th>
                <th className="px-4 py-3 text-right">Skim (25%)</th>
                <th className="px-4 py-3">Date hit</th>
                <th className="px-4 py-3 text-right">Banked</th>
                <th className="px-4 py-3">Where parked</th>
                <th className="px-4 py-3 text-right">Cumulative floor</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.level} className={cn('hover:bg-gray-50', row.status === 'HIT_BANK_NOW' && 'bg-emerald-50')}>
                  <td className="px-4 py-3 font-medium tabular-nums">{formatCurrency(row.level)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.status === 'NOT_YET' ? '—' : formatCurrency(row.skimDue)}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-gray-500">{row.record?.dateHit ?? ''}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-green-600 font-medium">
                    {row.record ? formatCurrency(row.record.amountBanked) : ''}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{row.record?.parkedDestination ?? ''}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(row.cumulativeFloor)}</td>
                  <td className="px-4 py-3">
                    {row.status === 'BANKED' ? (
                      <span className="inline-block rounded-full bg-green-50 text-green-700 px-2 py-0.5 text-xs font-medium">BANKED</span>
                    ) : row.status === 'HIT_BANK_NOW' ? (
                      <button onClick={() => setBanking(row)}
                        className="inline-block rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-xs font-bold hover:bg-emerald-200">
                        HIT — BANK NOW
                      </button>
                    ) : (
                      <span className="inline-block rounded-full bg-gray-100 text-gray-500 px-2 py-0.5 text-xs font-medium">not yet</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-xs text-gray-400 border-t border-gray-100">
            $1M is the aspiration marker. Past $800k the ladder keeps doubling — $1.6M, $3.2M — same 25% rule.
          </p>
        </div>
      )}

      {banking && (
        <RecordBankingModal
          row={banking}
          accountValue={account}
          onClose={() => setBanking(null)}
          onDone={() => { setBanking(null); setJustBanked(true); }}
        />
      )}
    </div>
  );
}

function RecordBankingModal({
  row, accountValue, onClose, onDone,
}: {
  row: MilestoneRow;
  accountValue: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { recordMilestone } = useData();
  const [valueAtHit, setValueAtHit] = useState(String(roundCents(accountValue)));
  const [amount, setAmount] = useState(String(skimDue(accountValue)));
  const [dateHit, setDateHit] = useState(todayISO());
  const [destination, setDestination] = useState('VOO (parked pile)');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const banked = Number(amount);
    if (!banked || banked <= 0) return setFormError('Banked amount must be positive.');
    setBusy(true);
    try {
      await recordMilestone({
        level: row.level,
        accountValueAtHit: Number(valueAtHit),
        dateHit,
        amountBanked: roundCents(banked),
        parkedDestination: destination || null,
      });
      onDone();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Bank the ${formatCurrency(row.level)} milestone`}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Account value at hit</label>
            <input type="number" step="0.01" required value={valueAtHit}
              onChange={(e) => { setValueAtHit(e.target.value); setAmount(String(skimDue(Number(e.target.value) || 0))); }}
              className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Amount banked (25% = {formatCurrency(skimDue(Number(valueAtHit) || 0))})</label>
            <input type="number" step="0.01" min="0.01" required value={amount}
              onChange={(e) => setAmount(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Date</label>
            <input type="date" required value={dateHit} onChange={(e) => setDateHit(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Where parked</label>
            <input value={destination} onChange={(e) => setDestination(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="flex gap-2 text-xs text-gray-400">
          <Landmark className="h-4 w-4 flex-shrink-0" />
          <span>Writes the MilestoneBank event to the Cash Ledger. This money never comes back to the trading account.</span>
        </div>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={primaryBtnCls}>{busy ? 'Recording…' : 'Bank it'}</button>
        </div>
      </form>
    </Modal>
  );
}
