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

/** The widget's designed size, mirroring `tauri.conf.json`. */
const WIDTH = 340;
export const EXPANDED_HEIGHT = 480;

/**
 * Set the window's height, keeping the top edge where it is.
 *
 * Windows anchors a resize at the top left, which is exactly the behaviour
 * compact mode wants: the titlebar stays put and the bottom edge moves.
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
 * merely the wrong height.
 */
export async function setWindowHeight(height: number): Promise<void> {
  if (!isTauri()) return;

  const rounded = Math.round(height);

  try {
    const { LogicalSize } = await import('@tauri-apps/api/dpi');
    const window = await currentWindow();

    await window.setSize(new LogicalSize(WIDTH, rounded));

    const scale = await window.scaleFactor();
    const applied = (await window.innerSize()).toLogical(scale);
    if (Math.abs(applied.height - rounded) <= 1) return;

    await window.setResizable(true);
    try {
      await window.setSize(new LogicalSize(WIDTH, rounded));
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
