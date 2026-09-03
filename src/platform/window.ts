import { isTauri } from '@/core/utils/env';

/**
 * Window operations, kept out of `src/core`.
 *
 * `src/core` is the playback core — it has no business knowing there is a window
 * at all. Keeping these here means the UI can be rewritten without the window
 * logic moving with it: a redesign replaces the buttons, not this file.
 *
 * Every function is a no-op outside Tauri, the same shape used by
 * `src/core/session`, so the browser build keeps working.
 */

async function currentWindow() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

/**
 * Hide rather than close.
 *
 * Closing the window is a request to get it out of the way, not to stop the
 * music — the tray icon is where quitting lives. Rust also intercepts the native
 * close request for the same reason (`main.rs`).
 */
export async function hideWindow(): Promise<void> {
  if (!isTauri()) return;
  await (await currentWindow()).hide();
}

export async function minimizeWindow(): Promise<void> {
  if (!isTauri()) return;
  await (await currentWindow()).minimize();
}

export async function setAlwaysOnTop(enabled: boolean): Promise<void> {
  if (!isTauri()) return;
  await (await currentWindow()).setAlwaysOnTop(enabled);
}

/** The player's designed size, mirroring `tauri.conf.json`. */
export const PLAYER_WIDTH = 340;
export const EXPANDED_HEIGHT = 480;

/**
 * How much wider the window gets when the drawer is out.
 *
 * Twice the player, so the window opens out to three times its own width. The
 * drawer is the room the records live in — a grid of full-size sleeves rather
 * than a column of them — and it is the player that is the narrow half.
 */
export const DRAWER_WIDTH = 680;

/** The window's width for a given drawer state. One place decides this. */
export function widthFor(drawerOpen: boolean): number {
  return drawerOpen ? PLAYER_WIDTH + DRAWER_WIDTH : PLAYER_WIDTH;
}

/**
 * Set the window's size, keeping the top left corner where it is.
 *
 * Windows anchors a resize at the top left, which is what both callers want:
 * collapsing moves the bottom edge and leaves the titlebar, and the drawer
 * moves the right edge and leaves everything else.
 *
 * The window is declared `resizable: false`, which governs whether someone can
 * drag its edges rather than whether it can be resized in code — but rather
 * than take that on faith, this reads the size back and, if nothing moved,
 * retries with the flag lifted for the duration of the call. The check costs
 * one IPC round trip on a gesture that happens by hand, and it means the
 * uncertainty is answered at runtime instead of assumed.
 *
 * Every path is caught. Each of these calls is gated by a capability in
 * `capabilities/default.json`, and a missing one is rejected rather than
 * ignored — an uncaught rejection here would surface as an unhandled promise
 * from a `void` call site with nothing to catch it, over a window that is
 * merely the wrong size.
 */
export async function setWindowSize(width: number, height: number): Promise<void> {
  if (!isTauri()) return;

  const w = Math.round(width);
  const h = Math.round(height);

  try {
    const { LogicalSize } = await import('@tauri-apps/api/dpi');
    const window = await currentWindow();

    await window.setSize(new LogicalSize(w, h));

    const scale = await window.scaleFactor();
    const applied = (await window.innerSize()).toLogical(scale);
    if (Math.abs(applied.height - h) <= 1 && Math.abs(applied.width - w) <= 1) return;

    await window.setResizable(true);
    try {
      await window.setSize(new LogicalSize(w, h));
    } finally {
      await window.setResizable(false);
    }
  } catch (err) {
    console.warn('[window] could not resize', err);
  }
}

/** Read the current pinned state, so the UI can start from the truth. */
export async function isAlwaysOnTop(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await (await currentWindow()).isAlwaysOnTop();
  } catch {
    return false;
  }
}
