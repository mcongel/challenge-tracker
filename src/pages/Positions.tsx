import { useMemo, useState } from 'react';
import { Pencil, Plus, Scissors, Trash2, TrendingUp } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ErrorCard } from '../components/ui/ErrorCard';
import { SplitModal } from '../components/SplitModal';
import { SkeletonTable } from '../components/ui/SkeletonTable';
import { TableCard, theadCls } from '../components/ui/Card';
import { EditLotModal } from '../components/positions/EditLotModal';
import { AddPositionModal } from '../components/positions/AddPositionModal';
import { ClosePositionModal } from '../components/positions/ClosePositionModal';
import { PriceModal } from '../components/positions/PriceModal';
import { useData } from '../contexts/DataContext';
import { priceMapFor } from '../lib/alerts';
import type { PositionLot } from '../lib/engine';
import {
  costBasis, daysHeld, longTermDate, marketValue,
  unrealized, unrealizedPct,
} from '../lib/engine';
import {
  cn, formatCurrency, formatPercent, money, primaryBtnCls, todayISO,
} from '../lib/utils';
import { useIndustries } from '../lib/useIndustries';

export function Positions() {
  const data = useData();
  const { lots, overrides, overrideSetAt, quotes, loading, error } = data;
  const priceMap = priceMapFor(lots, overrides, quotes);
  const [addOpen, setAddOpen] = useState(false);
  const [closeTicker, setCloseTicker] = useState<string | null>(null);
  const [splitTicker, setSplitTicker] = useState<string | null>(null);
  const [priceTicker, setPriceTicker] = useState<string | null>(null);
  const [editingLot, setEditingLot] = useState<PositionLot | null>(null);
  const [deletingLot, setDeletingLot] = useState<PositionLot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const today = todayISO();
  const industries = useIndustries(lots.map((l) => l.ticker));
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
      {notice && (
        <div className="mb-4 bg-amber-50 text-amber-800 rounded-lg px-4 py-3 text-sm">{notice}</div>
      )}

      {loading ? (
        <SkeletonTable />
      ) : byTicker.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="No open positions"
          hint="Each buy becomes its own lot. Closing moves it to the Trade Log and writes the Sell to the Cash Ledger."
        />
      ) : (
        <TableCard>
          <table className="w-full text-sm compact-table">
            <thead className="bg-gray-50 sticky top-0">
              <tr className={theadCls}>
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
                <th className="px-2 py-3" />
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
                          {industries[ticker] && ` · ${industries[ticker]}`}
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
                        title={hasOverride
                          ? `Manual price (pinned — beats quotes${overrideSetAt[ticker] ? `, set ${overrideSetAt[ticker].slice(0, 10)}` : ''})`
                          : hasPrice ? 'Delayed quote — click to pin a manual price' : 'Set price'}>
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
                    <td colSpan={4} />
                  </tr>,
                  ...tickerLots.map((lot) => {
                    const price = priceMap[ticker] ?? lot.avgCost;
                    const u = unrealized(lot, price);
                    return (
                      <tr key={lot.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-500 tabular-nums pl-8">{lot.buyDate}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{lot.shares}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(lot.avgCost)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{money(costBasis(lot))}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-500">
                          {hasPrice ? formatCurrency(price) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{money(marketValue(lot, price))}</td>
                        <td className={cn('px-4 py-2 text-right tabular-nums', u >= 0 ? 'text-green-600' : 'text-red-600')}>
                          {money(u)}
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
                        <td className="px-2 py-2 whitespace-nowrap">
                          <button onClick={() => setEditingLot(lot)} className="p-2 sm:p-1 rounded hover:bg-gray-100"
                            aria-label="Edit lot">
                            <Pencil className="h-4 w-4 text-gray-300 hover:text-gray-600" />
                          </button>
                          <button onClick={() => setDeletingLot(lot)} className="p-2 sm:p-1 rounded hover:bg-red-50"
                            aria-label="Delete lot">
                            <Trash2 className="h-4 w-4 text-gray-300 hover:text-red-600" />
                          </button>
                        </td>
                      </tr>
                    );
                  }),
                ];
              })}
            </tbody>
          </table>
        </TableCard>
      )}

      <AddPositionModal isOpen={addOpen} onClose={() => setAddOpen(false)} />
      {editingLot && <EditLotModal lot={editingLot} onClose={() => setEditingLot(null)} />}
      {deletingLot && (
        <DeleteLotConfirm
          lot={deletingLot}
          onClose={() => setDeletingLot(null)}
          onNotice={setNotice}
        />
      )}
      {closeTicker && <ClosePositionModal ticker={closeTicker} onClose={() => setCloseTicker(null)} />}
      {splitTicker && <SplitModal ticker={splitTicker} onClose={() => setSplitTicker(null)} />}
      {priceTicker && <PriceModal ticker={priceTicker} onClose={() => setPriceTicker(null)} />}
    </div>
  );
}

function DeleteLotConfirm({
  lot, onClose, onNotice,
}: {
  lot: PositionLot;
  onClose: () => void;
  onNotice: (msg: string | null) => void;
}) {
  const { deleteLot } = useData();
  return (
    <ConfirmModal
      title={`Delete ${lot.ticker} lot`}
      message={`Delete the ${lot.buyDate} ${lot.ticker} lot (${lot.shares} sh @ ${formatCurrency(lot.avgCost)})? If exactly one matching Buy sits on the Cash Ledger it goes too; otherwise the ledger row stays and you'll be told to remove it yourself. This is for entry mistakes — a real exit goes through Close.`}
      onConfirm={async () => {
        const { buyEventDeleted } = await deleteLot(lot.id);
        onNotice(
          buyEventDeleted
            ? null
            : `Lot deleted. No unambiguous Buy match — remove the ${lot.buyDate} ${lot.ticker} Buy row on the Cash Ledger yourself, or account cash overstates.`,
        );
      }}
      onClose={onClose}
    />
  );
}

