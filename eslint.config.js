// Flat config. The compiler already enforces types and unused locals; this
// layer exists for the classes of bug tsc can't see — above all the
// react-hooks rules (stale deps were a review finding).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'design-reference', 'supabase/functions'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The React-Compiler-era advisories flag legitimate house patterns
      // (prefill-in-effect, mutated memo inputs) — this app doesn't run the
      // compiler, so keep only the two classic high-signal hook rules hard.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      // Guidance errors deliberately embed the cause's message in prose
      // (errorMessage(err) inside the new message) — cause-chaining is
      // redundant with the house pattern.
      'preserve-caught-error': 'off',
      // tsc --noEmit owns unused checking (noUnusedLocals) — no double report.
      '@typescript-eslint/no-unused-vars': 'off',
      // The db layer is deliberately loosely typed at the row boundary.
      '@typescript-eslint/no-explicit-any': 'off',
      // House style allows `while (true)`-ish guards and non-null asserts
      // where the invariant is documented.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // daily-snapshot.ts is TypeScript — tsconfig.scripts.json owns it; the
    // plain-JS block here would choke on its syntax.
    files: ['scripts/**/*.mjs', 'functions/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: {
        process: 'readonly', console: 'readonly', fetch: 'readonly', URL: 'readonly',
        Response: 'readonly', Request: 'readonly', caches: 'readonly',
        setTimeout: 'readonly', setInterval: 'readonly', clearTimeout: 'readonly',
      },
    },
  },
);
