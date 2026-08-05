/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        'surface-elevated': 'rgb(var(--color-surface-elevated) / <alpha-value>)',
        'surface-muted': 'rgb(var(--color-surface-muted) / <alpha-value>)',
        'border-base': 'rgb(var(--color-border) / <alpha-value>)',
        'text-primary': 'rgb(var(--color-text-primary) / <alpha-value>)',
        'text-secondary': 'rgb(var(--color-text-secondary) / <alpha-value>)',
        'text-muted': 'rgb(var(--color-text-muted) / <alpha-value>)',
      },
      fontFamily: {
        // No sans override: SpokenFor's app runs on Tailwind's default stack
        // (ui-sans-serif/system-ui — Segoe UI on Windows). DM Sans and Georgia
        // are its LANDING-page faces only; Georgia survives here just for the
        // login screen's landing-style wordmark.
        display: ['Georgia', 'ui-serif', 'serif'],
      },
    },
  },
  plugins: [],
};
