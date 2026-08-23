import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Narrow on purpose.
 *
 * `tsc --noEmit` already carries the type rules, and the project is strict
 * (`noUnusedLocals`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`).
 * What it cannot see is hook dependency correctness — which this project has
 * two deliberate suppressions for, and those suppressions were inert for weeks
 * because no linter was installed to read them.
 */
export default tseslint.config(
  { ignores: ['dist', 'src-tauri/target', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The type checker owns this one and reports it better.
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
