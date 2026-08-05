import { useState } from 'react';
import { Landmark } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorCard, SkeletonTable } from './CashLedger';
import { useData } from '../contexts/DataContext';
import {
  computeCheck, formatQuarterLabel, quarterOf, quartersEnded, roundCents, taxYearOf,
} from '../lib/engine';
import { cn, formatCurrency, primaryBtnCls, todayISO } from '../lib/utils';

export function TaxReserve() {
  const { trades, cashEvents, carryforwards, addCashEvent, loading, error } = useData();
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyQuarter, setBusyQuarter] = useState<string | null>(null);

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

  const recordSkim = async (label: string, amount: number) => {
    setRowError(null);
    setBusyQuarter(label);
    try {
      await addCashEvent({
        date: today,
        type: 'TaxSkim',
        amount: roundCents(amount),
        sourceDestination: 'Tax reserve',
        notes: `${label} skim — 30% of net realized YTD`,
      });
    } catch (e) {
      setRowError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyQuarter(null);
    }
  };

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
                          onClick={() => recordSkim(label, c.moveOutNow)}
                          disabled={busyQuarter === label}
                          className={cn(primaryBtnCls, 'py-1 px-2.5 text-xs')}
                        >
                          {busyQuarter === label ? 'Recording…' : `Mark moved ${formatCurrency(c.moveOutNow)}`}
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
              <tr className="bg-gray-50/50">
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
          <p className="px-4 py-3 text-xs text-gray-400 border-t border-gray-100">
            "Mark moved" writes the TaxSkim to the Cash Ledger — the money leaves the score's account
            column and joins the reserved column. There is no off switch.
          </p>
        </div>
      )}
    </div>
  );
}
