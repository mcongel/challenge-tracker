import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Wallet, TrendingUp, ScrollText, Archive } from 'lucide-react';
import { cn } from '../../lib/utils';

const ITEMS = [
  { to: '/', label: 'Score', icon: LayoutDashboard },
  { to: '/ledger', label: 'Ledger', icon: Wallet },
  { to: '/positions', label: 'Positions', icon: TrendingUp },
  { to: '/trades', label: 'Trades', icon: ScrollText },
  { to: '/parked', label: 'Pile', icon: Archive },
];

/** Classes mirror SpokenFor's mobile bottom nav. */
export function MobileBottomNav() {
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-700 shadow-lg z-40 flex">
      {ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            cn(
              'flex flex-col items-center justify-center min-w-0 flex-1 px-1 py-2 rounded-lg transition-all relative',
              isActive
                ? 'text-green-600 dark:text-green-300'
                : 'text-gray-500 dark:text-slate-400',
            )
          }
        >
          <Icon className="h-5 w-5" />
          <span className="text-[10px] font-medium">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
