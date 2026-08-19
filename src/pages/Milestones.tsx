import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Landmark, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Modal } from '../components/ui/Modal';
import { AccountSelect } from '../components/ui/AccountSelect';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ErrorCard } from '../components/ui/ErrorCard';
import { SkeletonTable } from '../components/ui/SkeletonTable';
import { Card, TableCard, theadCls } from '../components/ui/Card';
import { Field } from '../components/ui/Field';
import { FormError, ModalFooter, useModalForm } from '../components/ui/useModalForm';
import { useData } from '../contexts/DataContext';
import { priceMapFor } from '../lib/alerts';
import type { MilestoneRow } from '../lib/engine';
import { accountTotal, cumulativeFloor, milestoneTable, roundCents, skimDue } from '../lib/engine';
import { cn, formatCurrency, inputCls, money, primaryBtnCls, todayISO } from '../lib/utils';

export function Milestones() {
  const { lots, cashEvents, milestones, deleteMilestone, overrides, quotes, loading, error } = useData();
  const [banking, setBanking] = useState<MilestoneRow | null>(null);
  const [justBanked, setJustBanked] = useState(false);
  const [deleting, setDeleting] = useState<{ id: string; level: number } | null>(null);

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
            <p className="text-3xl sm:text-4xl font-bold text-emerald-700 tabular-nums">
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

      <Card className="p-4 mb-4 density-aware-card flex flex-wrap items-baseline gap-x-6 gap-y-3">
        <div>
          <p className="text-xs font-medium text-gray-500">Banked floors (locked forever)</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-green-600">{formatCurrency(floor)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500">Account value</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-gray-900">{money(account)}</p>
        </div>
      </Card>

      {loading ? (
        <SkeletonTable />
      ) : (
        <TableCard
          footer={
            <p className="px-4 py-3 text-xs text-gray-400 border-t border-gray-100">
              $1M is the aspiration marker. Past $800k the ladder keeps doubling — $1.6M, $3.2M — same 25% rule.
            </p>
          }
        >
          <table className="w-full text-sm compact-table">
            <thead className="bg-gray-50 sticky top-0">
              <tr className={theadCls}>
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
              {rows.map((row) => {
                const rec = milestones.find((m) => m.level === row.level);
                return (
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
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block rounded-full bg-green-50 text-green-700 px-2 py-0.5 text-xs font-medium">BANKED</span>
                        {rec && (
                          <button
                            onClick={() => setDeleting({ id: rec.id, level: row.level })}
                            className="p-2 sm:p-1 rounded hover:bg-red-50"
                            aria-label="Delete milestone record"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-gray-300 hover:text-red-600" />
                          </button>
                        )}
                      </span>
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
                );
              })}
            </tbody>
          </table>
        </TableCard>
      )}

      {deleting && (
        <ConfirmModal
          title={`Delete the ${formatCurrency(deleting.level)} milestone record`}
          message={`Remove this milestone? The floor it banked stops counting toward Total Score immediately. Its two companion artifacts stay and need manual follow-up if the banking never happened: the MilestoneBank row on the Cash Ledger, and the VOO lot in the parked pile.`}
          onConfirm={() => deleteMilestone(deleting.id)}
          onClose={() => setDeleting(null)}
        />
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
  const { recordMilestone, accounts, overrides, quotes } = useData();
  const outsideAccounts = accounts.filter((a) => a.kind === 'outside');
  const [valueAtHit, setValueAtHit] = useState(String(roundCents(accountValue)));
  const [amount, setAmount] = useState(String(skimDue(accountValue)));
  const [dateHit, setDateHit] = useState(todayISO());
  const [destination, setDestination] = useState('VOO (parked pile)');
  const [recordVoo, setRecordVoo] = useState(true);
  const [vooAccountId, setVooAccountId] = useState(outsideAccounts[0]?.id ?? '');
  const vooQuote = overrides['VOO'] ?? quotes['VOO'];
  const [vooPrice, setVooPrice] = useState(vooQuote ? String(vooQuote) : '');

  const { busy, formError, submit } = useModalForm(async () => {
    const banked = Number(amount);
    if (!banked || banked <= 0) throw new Error('Banked amount must be positive.');
    if (recordVoo && (!vooAccountId || !Number(vooPrice) || Number(vooPrice) <= 0)) {
      throw new Error('Recording the VOO purchase needs the account and the VOO price paid.');
    }
    await recordMilestone(
      {
        level: row.level,
        accountValueAtHit: Number(valueAtHit),
        dateHit,
        amountBanked: roundCents(banked),
        parkedDestination: destination || null,
      },
      recordVoo ? { accountId: vooAccountId, price: Number(vooPrice) } : undefined,
    );
    onDone();
  });

  return (
    <Modal isOpen onClose={onClose} title={`Bank the ${formatCurrency(row.level)} milestone`}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Account value at hit">
            <input type="number" step="0.01" required value={valueAtHit}
              onChange={(e) => { setValueAtHit(e.target.value); setAmount(String(skimDue(Number(e.target.value) || 0))); }}
              className={inputCls} />
          </Field>
          <Field label={`Amount banked (25% = ${formatCurrency(skimDue(Number(valueAtHit) || 0))})`}>
            <input type="number" step="0.01" min="0.01" required value={amount}
              onChange={(e) => setAmount(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input type="date" required value={dateHit} onChange={(e) => setDateHit(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Where parked">
            <input value={destination} onChange={(e) => setDestination(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={recordVoo} onChange={(e) => setRecordVoo(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-600" />
          Also record the VOO purchase in the parked pile
        </label>
        {recordVoo && (
          <div className="grid grid-cols-2 gap-3">
            <AccountSelect accounts={accounts} value={vooAccountId} onChange={setVooAccountId}
              label="Pile account" kinds={['outside']} allowNone={false} />
            <Field label="VOO price paid ($)">
              <input type="number" step="any" min="0.01" value={vooPrice}
                onChange={(e) => setVooPrice(e.target.value)} className={inputCls} />
            </Field>
          </div>
        )}
        {recordVoo && Number(amount) > 0 && Number(vooPrice) > 0 && (
          <p className="text-xs text-gray-400 tabular-nums">
            Buys {(Number(amount) / Number(vooPrice)).toFixed(4)} sh of VOO — its own dated pile lot,
            marked never-trim-fuel.
          </p>
        )}
        <div className="flex gap-2 text-xs text-gray-400">
          <Landmark className="h-4 w-4 flex-shrink-0" />
          <span>Writes the MilestoneBank event to the Cash Ledger. This money never comes back to the trading account.</span>
        </div>
        <FormError message={formError} />
        <ModalFooter busy={busy} label="Bank it" busyLabel="Recording…" />
      </form>
    </Modal>
  );
}
