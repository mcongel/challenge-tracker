import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Wallet, TrendingUp, ScrollText, Flag } from 'lucide-react';
import { cn } from '../../lib/utils';

const ITEMS = [
  { to: '/', label: 'Score', icon: LayoutDashboard },
  { to: '/ledger', label: 'Ledger', icon: Wallet },
  { to: '/positions', label: 'Positions', icon: TrendingUp },
  { to: '/trades', label: 'Trades', icon: ScrollText },
  { to: '/milestones', label: 'Milestones', icon: Flag },
];

export function MobileBottomNav() {
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-gray-200 grid grid-cols-5">
      {ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            cn(
              'flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium',
              isActive ? 'text-green-700' : 'text-gray-500',
            )
          }
        >
          <Icon className="h-5 w-5" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
