import { Link } from 'react-router-dom';
import { useState } from 'react';
import { ScrollText, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorCard, SkeletonTable } from './CashLedger';
import { useData } from '../contexts/DataContext';
import {
  netRealizedYTD, realizedGain, realizedPct, roundCents, stLt, taxYearOf, tradeDaysHeld,
} from '../lib/engine';
import { cn, formatCurrency, formatPercent, todayISO } from '../lib/utils';

export function TradeLog() {
  const { trades, setTradeWashSale, deleteTrade, loading, error } = useData();
  const [rowError, setRowError] = useState<string | null>(null);

  const currentYear = taxYearOf(todayISO());
  const ytd = netRealizedYTD(trades, currentYear);
  const ordered = [...trades].sort((a, b) => b.closeDate.localeCompare(a.closeDate));

  const remove = async (id: string) => {
    if (!confirm('Delete this trade? The YTD realized number feeds the tax skim.')) return;
    try {
      await deleteTrade(id);
    } catch (e) {
      setRowError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      <PageHeader
        title="Trade Log"
        subtitle="Every close. ST = held 365 days or less; wash-sale losses don't count toward YTD."
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
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        title="Wash sale — loss disallowed"
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-500 max-w-[12rem] truncate">{t.notes}</td>
                    <td className="px-2 py-3">
                      <button onClick={() => remove(t.id)} className="p-1 rounded hover:bg-red-50" aria-label="Delete trade">
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
    </div>
  );
}
