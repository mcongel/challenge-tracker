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
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const nav = (
    <nav className="flex-1 px-2 py-4 space-y-1">
      {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={onClose}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors',
              isActive
                ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-50'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
            )
          }
        >
          <Icon className="h-4 w-4 flex-shrink-0" />
          {label}
        </NavLink>
      ))}
    </nav>
  );

  const brand = (
    <div className="h-14 flex items-center px-4 border-b border-gray-200">
      <span className="font-display font-semibold text-lg tracking-tight">
        Challenge<span className="text-indigo-600">Tracker</span>
      </span>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-52 density-aware-sidebar flex-shrink-0 bg-white border-r border-gray-200 sticky top-0 h-screen">
        {brand}
        {nav}
      </aside>

      {/* Mobile drawer */}
      {isOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75" onClick={onClose} />
          <aside className="relative flex flex-col w-64 max-w-[80vw] h-full bg-white animate-slide-in">
            <div className="flex items-center justify-between border-b border-gray-200 pr-2">
              {brand}
              <button
                onClick={onClose}
                className="p-2 rounded-md hover:bg-gray-100"
                aria-label="Close menu"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      )}
    </>
  );
}
