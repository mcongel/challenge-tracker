import { useMemo, useState } from 'react';
import { Pencil, Plus, Scissors, Trash2, TrendingUp } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ErrorCard } from '../components/ui/ErrorCard';
import { SplitModal } from '../components/SplitModal';
import { SkeletonTable } from '../components/ui/SkeletonTable';
import { TableCard, theadCls } from '../components/ui/Card';
import { RowCard, RowCardStat } from '../components/ui/RowCard';
import { SortHeader, useSortState } from '../components/ui/SortHeader';
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

type PosSortKey = 'ticker' | 'shares' | 'value' | 'unrealized' | 'target' | 'daysHeld';

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

  const { sort, toggleSort } = useSortState<PosSortKey>({
    initial: { key: 'ticker', dir: 'asc' },
    naturalDir: {
      ticker: 'asc', shares: 'desc', value: 'desc',
      unrealized: 'desc', target: 'asc', daysHeld: 'desc',
    },
    storageKey: 'positionsSort',
  });
  // Sorted view of the grouped lots: groups order by their aggregate (sum of
  // shares/value/unrealized; nearest target; longest days held), lots inside a
  // group by their own value. The default (ticker asc) reproduces byTicker's
  // alphabetical order. Not memoized — priceMap is rebuilt every render anyway
  // and the strategy caps this at a handful of lots.
  const lotMetric = (lot: PositionLot): number => {
    const price = priceMap[lot.ticker] ?? lot.avgCost;
    switch (sort.key) {
      case 'shares': return lot.shares;
      case 'value': return marketValue(lot, price);
      case 'unrealized': return unrealized(lot, price);
      case 'target': return lot.exitTarget;
      case 'daysHeld': return daysHeld(lot, today);
      default: return 0;
    }
  };
  const dirMul = sort.dir === 'asc' ? 1 : -1;
  const sortedGroups = byTicker
    .map(([ticker, tickerLots]): [string, PositionLot[]] => [
      ticker,
      sort.key === 'ticker'
        ? tickerLots
        : tickerLots.slice().sort((a, b) => (lotMetric(a) - lotMetric(b)) * dirMul),
    ])
    .sort((a, b) => {
      if (sort.key === 'ticker') return a[0].localeCompare(b[0]) * dirMul;
      const agg = (groupLots: PositionLot[]) =>
        sort.key === 'target' ? Math.min(...groupLots.map(lotMetric))
        : sort.key === 'daysHeld' ? Math.max(...groupLots.map(lotMetric))
        : groupLots.reduce((s, l) => s + lotMetric(l), 0);
      return (agg(a[1]) - agg(b[1])) * dirMul;
    });

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
        <TableCard
          cards={sortedGroups.flatMap(([ticker, tickerLots]) => {
            const hasOverride = overrides[ticker] !== undefined;
            const hasPrice = hasOverride || quotes[ticker] !== undefined;
            return tickerLots.map((lot) => {
              const price = priceMap[ticker] ?? lot.avgCost;
              const u = unrealized(lot, price);
              return (
                <RowCard
                  key={lot.id}
                  title={
                    <span className="flex items-center gap-1.5">
                      <span className="font-bold">{ticker}</span>
                      <span className="text-xs font-normal text-gray-400 tabular-nums">{lot.buyDate}</span>
                      {price >= lot.exitTarget && (
                        <span className="inline-block rounded-full bg-green-50 text-green-600 px-1.5 py-0.5 text-[10px] font-bold uppercase">
                          target hit
                        </span>
                      )}
                    </span>
                  }
                  value={money(marketValue(lot, price))}
                  actions={
                    <>
                      <button onClick={() => setCloseTicker(ticker)}
                        className="p-2 rounded text-xs font-medium text-indigo-600 hover:bg-indigo-50">
                        Close
                      </button>
                      <button onClick={() => setSplitTicker(ticker)}
                        className="p-2 rounded text-xs font-medium text-gray-400 hover:bg-gray-100 flex items-center gap-0.5">
                        <Scissors className="h-3 w-3" /> Split
                      </button>
                      <button onClick={() => setPriceTicker(ticker)}
                        className="p-2 rounded text-xs font-medium text-gray-400 hover:bg-gray-100"
                        title={hasOverride
                          ? `Manual price (pinned — beats quotes${overrideSetAt[ticker] ? `, set ${overrideSetAt[ticker].slice(0, 10)}` : ''})`
                          : hasPrice ? 'Delayed quote — tap to pin a manual price' : 'Set price'}>
                        Price
                      </button>
                      <button onClick={() => setEditingLot(lot)} className="p-2 rounded hover:bg-gray-100"
                        aria-label="Edit lot">
                        <Pencil className="h-4 w-4 text-gray-300 hover:text-gray-600" />
                      </button>
                      <button onClick={() => setDeletingLot(lot)} className="p-2 rounded hover:bg-red-50"
                        aria-label="Delete lot">
                        <Trash2 className="h-4 w-4 text-gray-300 hover:text-red-600" />
                      </button>
                    </>
                  }
                >
                  <RowCardStat label="Shares">{lot.shares}</RowCardStat>
                  <RowCardStat label="Avg cost">{formatCurrency(lot.avgCost)}</RowCardStat>
                  <RowCardStat label="Price">
                    {hasPrice ? formatCurrency(price) : '—'}
                    {hasOverride && <span className="ml-1 text-[10px] uppercase text-amber-800">pin</span>}
                  </RowCardStat>
                  <RowCardStat label="Unrealized" className={u >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {money(u)} ({formatPercent(unrealizedPct(lot, price))})
                  </RowCardStat>
                  <RowCardStat label="Target"
                    className={price >= lot.exitTarget ? 'font-bold text-green-600' : undefined}>
                    {formatCurrency(lot.exitTarget)}
                    {lot.exitDate && <span className="ml-1 font-normal text-gray-400">by {lot.exitDate}</span>}
                  </RowCardStat>
                  <RowCardStat label="Days held">{daysHeld(lot, today)}</RowCardStat>
                </RowCard>
              );
            });
          })}
        >
          <table className="w-full text-sm compact-table">
            <thead className="bg-gray-50 sticky top-0 group/head">
              <tr className={theadCls}>
                <SortHeader<PosSortKey> label="Lot" sortKey="ticker" sort={sort} onSort={toggleSort} />
                <SortHeader<PosSortKey> label="Shares" sortKey="shares" sort={sort} onSort={toggleSort} align="right" />
                <th className="px-4 py-3 text-right">Avg cost</th>
                <th className="px-4 py-3 text-right">Basis</th>
                <th className="px-4 py-3 text-right">Price</th>
                <SortHeader<PosSortKey> label="Value" sortKey="value" sort={sort} onSort={toggleSort} align="right" />
                <SortHeader<PosSortKey> label="Unreal $" sortKey="unrealized" sort={sort} onSort={toggleSort} align="right" />
                <th className="px-4 py-3 text-right">Unreal %</th>
                <SortHeader<PosSortKey> label="Days" sortKey="daysHeld" sort={sort} onSort={toggleSort} align="right" />
                <th className="px-4 py-3">LT on</th>
                <SortHeader<PosSortKey> label="Target" sortKey="target" sort={sort} onSort={toggleSort} align="right" />
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedGroups.map(([ticker, tickerLots]) => {
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

