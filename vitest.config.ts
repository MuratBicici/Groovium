import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

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
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
