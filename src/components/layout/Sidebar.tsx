import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Wallet,
  TrendingUp,
  ScrollText,
  Flag,
  Landmark,
  Swords,
  Archive,
  BookOpen,
  HelpCircle,
  X,
} from 'lucide-react';
import { cn } from '../../lib/utils';

export const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/ledger', label: 'Cash Ledger', icon: Wallet },
  { to: '/positions', label: 'Positions', icon: TrendingUp },
  { to: '/trades', label: 'Trade Log', icon: ScrollText },
  { to: '/milestones', label: 'Milestones', icon: Flag },
  { to: '/tax', label: 'Tax Reserve', icon: Landmark },
  { to: '/benchmark', label: 'Benchmark', icon: Swords },
  { to: '/parked', label: 'Parked Pile', icon: Archive },
  { to: '/rules', label: 'Rules', icon: BookOpen },
  { to: '/help', label: 'Help', icon: HelpCircle },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Structure and classes mirror SpokenFor's Layout chunk: one aside that is a
 * slide-in drawer on mobile and static on desktop. */
export function Sidebar({ isOpen, onClose }: SidebarProps) {
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

          <nav className="flex-1 p-3 space-y-1">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
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
          </nav>
        </div>
      </aside>
    </>
  );
}
