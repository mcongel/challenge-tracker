import { useEffect, useState } from 'react';
import { LogOut, Menu, Moon, Sun } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { signOut } = useAuth();
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

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
        <span className="lg:hidden font-display font-semibold tracking-tight">
          Challenge<span className="text-indigo-600">Tracker</span>
        </span>
      </div>

      <div className="flex items-center gap-2">
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
    </header>
  );
}
