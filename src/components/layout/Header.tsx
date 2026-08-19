import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Download, HelpCircle, LogOut, Menu, Moon, RefreshCw, Sun } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import { Modal } from '../ui/Modal';
import { downloadJson, downloadTableCsv } from '../../lib/export';
import { cn, secondaryBtnCls, todayISO } from '../../lib/utils';

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { signOut } = useAuth();
  const { quotesAsOf, quotesError, refreshQuotes } = useData();
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [refreshing, setRefreshing] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshQuotes();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <header className="h-14 flex items-center justify-between px-3 sm:px-6 bg-white border-b border-gray-200 sticky top-0 z-30">
      <div className="flex items-center gap-2">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-md hover:bg-gray-100"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5 text-gray-600" />
        </button>
        <span className="lg:hidden text-lg font-bold text-gray-600 dark:text-slate-200">
          Challenge Tracker
        </span>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        {quotesAsOf && (
          <span className={cn('text-xs tabular-nums', quotesError ? 'text-amber-600 font-medium' : 'text-gray-400')}>
            {/* Short form on phones, full on wider screens — staleness must be visible everywhere. */}
            <span className="sm:hidden">
              {quotesError ? 'stale ' : ''}{new Date(quotesAsOf).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </span>
            <span className="hidden sm:inline">
              {quotesError ? 'quotes stale — last ' : 'prices as of '}
              {new Date(quotesAsOf).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </span>
          </span>
        )}
        {!quotesAsOf && quotesError && (
          <span className="text-xs text-amber-600 font-medium">quotes unavailable</span>
        )}
        {/* Reference material lives up here, not in the nav — it's reading,
            not workflow. */}
        <Link to="/rules" className="p-2 rounded-md hover:bg-gray-100" aria-label="Rules" title="Rules">
          <BookOpen className="h-5 w-5 text-gray-500" />
        </Link>
        <Link to="/help" className="p-2 rounded-md hover:bg-gray-100" aria-label="Help" title="Help">
          <HelpCircle className="h-5 w-5 text-gray-500" />
        </Link>
        <button
          onClick={doRefresh}
          className="p-2 rounded-md hover:bg-gray-100"
          aria-label="Refresh prices"
          title="Refresh prices"
        >
          <RefreshCw className={cn('h-5 w-5 text-gray-500', refreshing && 'animate-spin')} />
        </button>
        <button
          onClick={() => setExportOpen(true)}
          className="p-2 rounded-md hover:bg-gray-100"
          aria-label="Export data"
          title="Export data"
        >
          <Download className="h-5 w-5 text-gray-500" />
        </button>
        <button
          onClick={() => setDark((d) => !d)}
          className="p-2 rounded-md hover:bg-gray-100"
          aria-label="Toggle dark mode"
        >
          {dark ? (
            <Sun className="h-5 w-5 text-gray-500" />
          ) : (
            <Moon className="h-5 w-5 text-gray-500" />
          )}
        </button>
        <button
          onClick={signOut}
          className="p-2 rounded-md hover:bg-gray-100"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="h-5 w-5 text-gray-500" />
        </button>
      </div>

      {exportOpen && <ExportModal onClose={() => setExportOpen(false)} />}
    </header>
  );
}

function ExportModal({ onClose }: { onClose: () => void }) {
  const {
    cashEvents, lots, trades, milestones, benchmarkDeposits, parked, parkedLots, parkedSales,
    parkedCashEvents, parkedLotAdjustments, incomeScenarios, scenarioRotations, accounts,
    outsideSales, snapshots, carryforwards, overrides, settings, watchlist, pileTaxSetAsides,
  } = useData();
  const stamp = todayISO();

  const tables: [string, Record<string, unknown>[]][] = [
    ['accounts', accounts as unknown as Record<string, unknown>[]],
    ['cash-events', cashEvents as unknown as Record<string, unknown>[]],
    ['position-lots', lots as unknown as Record<string, unknown>[]],
    ['trades', trades as unknown as Record<string, unknown>[]],
    ['outside-sales', outsideSales as unknown as Record<string, unknown>[]],
    ['milestones', milestones as unknown as Record<string, unknown>[]],
    ['benchmark-deposits', benchmarkDeposits as unknown as Record<string, unknown>[]],
    ['parked-positions', parked as unknown as Record<string, unknown>[]],
    ['parked-lots', parkedLots as unknown as Record<string, unknown>[]],
    ['parked-lot-adjustments', parkedLotAdjustments as unknown as Record<string, unknown>[]],
    ['parked-sales', parkedSales as unknown as Record<string, unknown>[]],
    ['parked-cash-events', parkedCashEvents as unknown as Record<string, unknown>[]],
    ['income-scenarios', incomeScenarios as unknown as Record<string, unknown>[]],
    ['scenario-rotations', scenarioRotations as unknown as Record<string, unknown>[]],
    ['snapshots', snapshots as unknown as Record<string, unknown>[]],
    ['loss-carryforwards', carryforwards as unknown as Record<string, unknown>[]],
    ['watchlist', watchlist as unknown as Record<string, unknown>[]],
    ['pile-tax-set-asides', pileTaxSetAsides as unknown as Record<string, unknown>[]],
    ['price-overrides', Object.entries(overrides).map(([ticker, price]) => ({ ticker, price }))],
    ['app-settings', Object.entries(settings).map(([key, value]) => ({ key, value }))],
  ];

  return (
    <Modal isOpen onClose={onClose} title="Export your data">
      <div className="space-y-4">
        <button
          onClick={() =>
            downloadJson(Object.fromEntries(tables.map(([n, rows]) => [n.replace(/-/g, '_'), rows])), stamp)
          }
          className="w-full rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
        >
          Download everything (JSON)
        </button>
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Or CSV per table</p>
          <div className="grid grid-cols-2 gap-2">
            {tables.map(([name, rows]) => (
              <button
                key={name}
                onClick={() => downloadTableCsv(name, rows, stamp)}
                disabled={rows.length === 0}
                className={cn(secondaryBtnCls, 'text-xs py-1.5 disabled:opacity-40')}
              >
                {name} ({rows.length})
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-gray-400">
          Export anytime — it's your data, and it doubles as a backup.
        </p>
      </div>
    </Modal>
  );
}
