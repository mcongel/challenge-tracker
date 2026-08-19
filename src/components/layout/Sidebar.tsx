import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Bitcoin,
  Building2,
  Wallet,
  TrendingUp,
  ScrollText,
  Flag,
  Landmark,
  Swords,
  Archive,
  History,
  Telescope,
  HandCoins,
  PiggyBank,
  Receipt,
  Sunrise,
  ChevronDown,
  ChevronRight,
  X,
} from 'lucide-react';
import { cn } from '../../lib/utils';

/** Grouped by the app's own walls: score math vs the other pots. The nav
 * teaches the architecture — a screen's section says whose book it keeps.
 * The two deep books collapse (state remembered); the pots stay one row
 * each, and Rules/Help live in the header as reference icons. */
export const NAV_SECTIONS: {
  label: string | null;
  collapsible?: boolean;
  items: { to: string; label: string; icon: typeof LayoutDashboard }[];
}[] = [
  {
    label: null,
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/accounts', label: 'Accounts', icon: Building2 },
    ],
  },
  {
    label: 'Challenge',
    collapsible: true,
    items: [
      { to: '/ledger', label: 'Cash Ledger', icon: Wallet },
      { to: '/positions', label: 'Positions', icon: TrendingUp },
      { to: '/watchlist', label: 'Watchlist', icon: Telescope },
      { to: '/trades', label: 'Trade Log', icon: ScrollText },
      { to: '/milestones', label: 'Milestones', icon: Flag },
      { to: '/tax', label: 'Tax Reserve', icon: Landmark },
      { to: '/benchmark', label: 'Benchmark', icon: Swords },
    ],
  },
  {
    label: 'Parked pile',
    collapsible: true,
    items: [
      { to: '/parked', label: 'Parked Pile', icon: Archive },
      { to: '/activity', label: 'Activity', icon: History },
      { to: '/income', label: 'Income', icon: HandCoins },
      { to: '/pile-taxes', label: 'Pile Taxes', icon: Receipt },
      { to: '/transition', label: 'Transition', icon: Sunrise },
    ],
  },
  {
    label: null,
    items: [
      { to: '/bitcoin', label: 'Bitcoin', icon: Bitcoin },
      { to: '/retirement', label: 'Retirement', icon: PiggyBank },
    ],
  },
];

const COLLAPSE_KEY = 'sidebar-collapsed';

function loadCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Structure and classes mirror SpokenFor's Layout chunk: one aside that is a
 * slide-in drawer on mobile and static on desktop. */
export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);

  const toggle = (label: string) => {
    setCollapsed((c) => {
      const next = { ...c, [label]: !c[label] };
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      return next;
    });
  };

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden" onClick={onClose} />
      )}

      <aside
        className={cn(
          'fixed lg:static inset-y-0 left-0 z-50 w-52 density-aware-sidebar bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-700 transform transition-transform duration-200 ease-in-out',
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className="h-full flex flex-col">
          <div className="p-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
            <h1 className="text-lg font-bold text-gray-600 dark:text-slate-200">
              Challenge Tracker
            </h1>
            <button
              onClick={onClose}
              className="lg:hidden p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-md"
              aria-label="Close sidebar"
            >
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto p-3 space-y-1">
            {NAV_SECTIONS.map((section, si) => {
              // The active section never hides its screens — collapsing is a
              // stored preference that resumes once you navigate elsewhere.
              const containsActive = section.items.some((i) =>
                i.to === '/' ? pathname === '/' : pathname === i.to,
              );
              const open =
                !section.collapsible || containsActive || !collapsed[section.label ?? ''];
              return (
                <div key={si}>
                  {section.label &&
                    (section.collapsible ? (
                      <button
                        onClick={() => toggle(section.label!)}
                        className="w-full flex items-center justify-between px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300"
                        aria-expanded={open}
                      >
                        {section.label}
                        {open
                          ? <ChevronDown className="h-3.5 w-3.5" />
                          : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    ) : (
                      <p className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">
                        {section.label}
                      </p>
                    ))}
                  {open && (
                    <div className="space-y-1">
                      {section.items.map(({ to, label, icon: Icon }) => (
                        <NavLink
                          key={to}
                          to={to}
                          end={to === '/'}
                          onClick={onClose}
                          className={({ isActive }) =>
                            cn(
                              'flex items-center space-x-2 px-3 py-2 rounded-lg transition-colors relative',
                              isActive
                                ? 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-300'
                                : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800',
                            )
                          }
                        >
                          <Icon className="h-5 w-5" />
                          <span className="font-medium">{label}</span>
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>
      </aside>
    </>
  );
}
