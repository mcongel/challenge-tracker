import { useState } from 'react';
import { Landmark } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { AccountSelect } from '../components/ui/AccountSelect';
import { ErrorCard, SkeletonTable } from './CashLedger';
import { useData } from '../contexts/DataContext';
import {
  computeCheck, estimatedPileTax, formatQuarterLabel, quarterOf, quartersEnded,
  reservedByAccount, roundCents, taxYearOf,
} from '../lib/engine';
import { cn, formatCurrency, primaryBtnCls, todayISO } from '../lib/utils';

export function TaxReserve() {
  const { trades, cashEvents, carryforwards, accounts, parkedSales, loading, error } = useData();
  const pileEstTax = parkedSales
    .filter((s) => s.costBasis != null)
    .reduce((sum, s) => sum + estimatedPileTax(s.proceeds - (s.costBasis as number), s.shares, s.ltShares), 0);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pendingSkim, setPendingSkim] = useState<{ label: string; amount: number } | null>(null);

  const today = todayISO();
  const firstDate = [...trades.map((t) => t.closeDate), ...cashEvents.map((e) => e.date)].sort()[0];
  const ended = firstDate
    ? quartersEnded(firstDate, today).map((q) => computeCheck(q, trades, cashEvents, carryforwards))
    : [];
  // The running quarter, shown as a preview so the number is never a surprise.
  const current = computeCheck(
    { year: taxYearOf(today), quarter: quarterOf(today) },
    trades, cashEvents, carryforwards,
  );
  const carryThisYear = carryforwards.find((c) => c.taxYear === taxYearOf(today));
  const heldIn = [...reservedByAccount(cashEvents)].filter(([, amount]) => amount > 0);

  return (
    <div>
      <PageHeader
        title="Tax Reserve"
        subtitle="Every quarter: 30% of net realized gains YTD moves out of play. Non-negotiable — it's what makes a blown account a shrug instead of a debt."
      />

      {error && <ErrorCard message={error} />}
      {rowError && <ErrorCard message={rowError} />}

      {carryThisYear && (
        <div className="mb-4 bg-sky-50 text-sky-800 rounded-lg px-4 py-3 text-sm">
          Loss carryforward into {carryThisYear.taxYear}: {formatCurrency(carryThisYear.amount)} —
          offsets gains before the 30% applies.
        </div>
      )}

      {loading ? (
        <SkeletonTable />
      ) : !firstDate ? (
        <EmptyState
          icon={Landmark}
          title="No quarters to settle yet"
          hint="The checklist starts once there's activity. Each quarter's number auto-computes from the Trade Log the day the quarter ends."
        />
      ) : (
        <div className="bg-white rounded-lg shadow-lg overflow-x-auto">
          <table className="w-full text-sm compact-table">
            <thead className="bg-gray-50 sticky top-0">
              <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Quarter</th>
                <th className="px-4 py-3 text-right">Net realized YTD</th>
                <th className="px-4 py-3 text-right">Target (30%)</th>
                <th className="px-4 py-3 text-right">Already reserved</th>
                <th className="px-4 py-3 text-right">Move out now</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ended.map((c) => {
                const label = formatQuarterLabel(c);
                const due = c.moveOutNow > 0;
                return (
                  <tr key={label} className={cn('hover:bg-gray-50', due && 'bg-yellow-50')}>
                    <td className="px-4 py-3 font-medium whitespace-nowrap">
                      {label}
                      <span className="ml-2 text-xs font-normal text-gray-400">ended {c.endDate}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(roundCents(c.netRealizedYTD))}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(c.reserveTarget)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(roundCents(c.alreadyReserved))}</td>
                    <td className={cn('px-4 py-3 text-right tabular-nums font-bold', due ? 'text-yellow-700' : 'text-gray-400')}>
                      {formatCurrency(c.moveOutNow)}
                    </td>
                    <td className="px-4 py-3">
                      {due ? (
                        <button
                          onClick={() => setPendingSkim({ label, amount: c.moveOutNow })}
                          className={cn(primaryBtnCls, 'py-1 px-2.5 text-xs')}
                        >
                          {`Mark moved ${formatCurrency(c.moveOutNow)}`}
                        </button>
                      ) : (
                        <span className="inline-block rounded-full bg-green-50 text-green-700 px-2 py-0.5 text-xs font-medium">
                          Settled
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-gray-50">
                <td className="px-4 py-3 font-medium whitespace-nowrap text-gray-500">
                  {formatQuarterLabel(current)}
                  <span className="ml-2 text-xs font-normal text-gray-400">in progress</span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">{formatCurrency(roundCents(current.netRealizedYTD))}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">{formatCurrency(current.reserveTarget)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">{formatCurrency(roundCents(current.alreadyReserved))}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-400">{formatCurrency(current.moveOutNow)}</td>
                <td className="px-4 py-3">
                  <span className="text-xs text-gray-400">due {current.endDate}</span>
                </td>
              </tr>
            </tbody>
          </table>
          {heldIn.length > 0 && (
            <p className="px-4 py-2 text-xs text-gray-500 border-t border-gray-100">
              Reserve held in:{' '}
              {heldIn
                .map(([accountId, amount]) =>
                  `${accountId ? accounts.find((a) => a.id === accountId)?.name ?? 'unknown' : 'unassigned'} ${formatCurrency(roundCents(amount))}`)
                .join(' · ')}
            </p>
          )}
          <p className="px-4 py-3 text-xs text-gray-400 border-t border-gray-100">
            "Mark moved" writes the TaxSkim to the Cash Ledger — the money leaves the score's account
            column and joins the reserved column. There is no off switch.
          </p>
          {pileEstTax > 0 && (
            <p className="px-4 pb-3 text-xs text-gray-400">
              Separately: parked-pile sales carry est. tax of ~{formatCurrency(roundCents(pileEstTax))}{' '}
              — the skim never covers the pile; set that aside yourself.
            </p>
          )}
        </div>
      )}

      {pendingSkim && (
        <RecordSkimModal
          label={pendingSkim.label}
          amount={pendingSkim.amount}
          onClose={() => setPendingSkim(null)}
          onError={setRowError}
        />
      )}
    </div>
  );
}

interface RecordSkimProps {
  label: string;
  amount: number;
  onClose: () => void;
  onError: (msg: string) => void;
}

function RecordSkimModal({ label, amount, onClose, onError }: RecordSkimProps) {
  const { accounts, addCashEvent } = useData();
  const banks = accounts.filter((a) => a.kind === 'bank');
  const [destination, setDestination] = useState(banks[0]?.id ?? '');
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await addCashEvent({
        date: todayISO(),
        type: 'TaxSkim',
        amount: roundCents(amount),
        sourceDestination: 'Tax reserve',
        destinationAccountId: destination || null,
        notes: `${label} skim — 30% of net realized YTD`,
      });
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Move ${formatCurrency(amount)} out of play`}>
      <div className="space-y-3">
        <AccountSelect accounts={accounts} value={destination} onChange={setDestination}
          label="Where is the reserve parked?" kinds={['bank']} />
        <p className="text-xs text-gray-400">
          {label} skim. The destination is bookkeeping only — the reserved amount counts toward
          Total Score either way.
        </p>
        <div className="flex justify-end">
          <button onClick={confirm} disabled={busy} className={primaryBtnCls}>
            {busy ? 'Recording…' : 'Mark moved'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
