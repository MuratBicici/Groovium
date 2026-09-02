import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// The same define `vite.config.ts` makes, from the same file, so that a test
// may import `src/core/version.ts`. Without it `__APP_VERSION__` is simply not
// declared at runtime here, and the changelog guard — does the version being
// built have a section written for it? — could not be a test at all.
const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string };

/**
 * Tests run in node, not jsdom, and that is a deliberate constraint.
 *
 * Everything worth protecting here is pure: name matching, suggestion picking,
 * the geometry helpers, the mapping between stored and playable shapes. The
 * parts that need a DOM or Tauri are the parts a test would have to fake so
 * heavily that it would stop proving anything. `src/core/utils/env.ts` was
 * written so the core imports cleanly outside Tauri, which is what makes this
 * possible at all.
 */
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
