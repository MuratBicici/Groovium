/**
 * Runtime environment detection.
 *
 * The whole core is written to run in two places: inside the Tauri webview
 * (real desktop widget) and inside a plain browser via `npm run dev`. The second
 * one is what makes the player testable without a Rust toolchain installed, and
 * it keeps the core reachable from jsdom tests later.
 */

declare global {
  interface Window {
    /** Injected by Tauri v2 into the webview's global scope. */
    __TAURI_INTERNALS__?: unknown;
  }
}

/** True when running inside the Tauri webview rather than a plain browser. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
}
