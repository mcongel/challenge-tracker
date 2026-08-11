import { useEffect, useState } from 'react';

/** Tracks the html.dark class so Recharts (which can't read CSS overrides)
 * gets explicit colors per theme. */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains('dark')),
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

/** The house chart chrome, theme-aware — one definition for every chart. */
export function useChartColors(): { isDark: boolean; gridColor: string; axisColor: string } {
  const isDark = useIsDark();
  return {
    isDark,
    gridColor: isDark ? '#334155' : '#e5e7eb',
    axisColor: isDark ? '#94a3b8' : '#6b7280',
  };
}
