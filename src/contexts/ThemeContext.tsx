import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { safeStorage } from '../lib/utils';

/** One owner for the theme. index.html's inline script sets the initial
 * html.dark class before first paint (no flash); this provider adopts that
 * state, and from then on it is the ONLY writer of the class and the stored
 * preference. Charts read `dark` from here instead of watching the DOM. */
const ThemeContext = createContext<{ dark: boolean; toggle: () => void } | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    safeStorage.set('theme', dark ? 'dark' : 'light');
  }, [dark]);

  const toggle = useCallback(() => setDark((d) => !d), []);

  return <ThemeContext.Provider value={{ dark, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): { dark: boolean; toggle: () => void } {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
