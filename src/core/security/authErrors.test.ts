import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HANDLED_CODES } from './authErrors';

/**
 * The one test that spans the language boundary.
 *
 * `authErrors.ts` says its keys "must stay in step with `ALL_CODES` in
 * `src-tauri/src/spotify/error.rs`", and `error.rs` says it exists "so the
 * frontend's mapping can be checked for completeness". Both were true and
 * nothing checked either, so a new Rust code would have quietly collapsed to
 * the generic message — the exact outcome both files were written to prevent.
 *
 * Reading the sources rather than a generated artefact keeps them in one step:
 * there is no build stage that can be skipped or go stale.
 */
function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

/** Codes Rust can send across the boundary. */
function rustErrorCodes(): string[] {
  const source = read('../../../src-tauri/src/spotify/error.rs');

  const array = source.match(/ALL_CODES:\s*&\[&str\]\s*=\s*&\[([\s\S]*?)\];/);
  // A parse failure must fail loudly rather than silently comparing nothing.
  expect(array, 'ALL_CODES could not be found in error.rs — has its shape changed?').toBeTruthy();

  return [...(array?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
}

/** Codes the frontend raises itself, without Rust having been reached. */
function frontendErrorCodes(): string[] {
  const codes = [...read('./spotifyAuth.ts').matchAll(/code:\s*'([^']+)'/g)].map(
    (m) => m[1] as string,
  );
  expect(codes.length, 'no thrown codes found in spotifyAuth.ts').toBeGreaterThan(0);
  return codes;
}

describe('Spotify error codes', () => {
  it('are all explained by the frontend', () => {
    const rust = rustErrorCodes();
    expect(rust.length).toBeGreaterThan(5);

    const unexplained = rust.filter((code) => !HANDLED_CODES.includes(code));
    expect(unexplained, 'these Rust codes would fall back to the generic message').toEqual([]);
  });

  it('carry no message for a code nothing can produce', () => {
    // The other direction, and it caught something on its first run: not every
    // handled code comes from Rust. The frontend raises its own when there is
    // no Tauri to ask, so a message is orphaned only if neither side emits it.
    const emitted = new Set([...rustErrorCodes(), ...frontendErrorCodes()]);

    const orphaned = HANDLED_CODES.filter((code) => !emitted.has(code));
    expect(orphaned, 'these messages describe codes nothing sends').toEqual([]);
  });
});
