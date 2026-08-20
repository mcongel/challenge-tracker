import { useTheme } from '../contexts/ThemeContext';

/** Theme state for Recharts (which can't read CSS overrides) — now just a
 * view of ThemeContext, the single owner of the html.dark class. */
export function useIsDark(): boolean {
  return useTheme().dark;
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
