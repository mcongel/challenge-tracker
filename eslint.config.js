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
    files: ['scripts/**/*.{mjs,ts}', 'functions/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', URL: 'readonly', Response: 'readonly', Request: 'readonly', caches: 'readonly' } },
  },
);
