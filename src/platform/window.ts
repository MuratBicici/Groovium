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

/** The shell's width for a given drawer state. One place decides this. */
export function widthFor(drawerOpen: boolean): number {
  return drawerOpen ? PLAYER_WIDTH + DRAWER_WIDTH : PLAYER_WIDTH;
}

/**
 * The window's width, which on the left is not the shell's.
 *
 * Opening to the left means the player has to stay where it is while the drawer
 * appears beside it, and the only way to do that by resizing is to move the
 * window's left edge — which flickers, unfixably: the window takes its existing
 * pixels with it and the webview lays out again a frame later, so for that frame
 * the shell is drawn where the window used to be. No ordering of the two calls
 * helps, because the lag is inside the webview.
 *
 * So on the left the window does not change at all. It is always as wide as the
 * drawer needs and the shell grows into it, exactly as the shell grows inside a
 * widening window on the right — except that here there is no widening. What it
 * leaves is transparent window beside the player, which `setWindowMask` cuts
 * away so that clicks land on whatever is actually behind it.
 */
export function windowWidthFor(drawerOpen: boolean, side: 'left' | 'right'): number {
  return side === 'left' ? PLAYER_WIDTH + DRAWER_WIDTH : widthFor(drawerOpen);
}

/**
 * Say which part of the window takes clicks, or `null` for all of it.
 *
 * The drawer opening leftwards needs the window wider than what it shows, which
 * is what lets it stay still — and a window that stays still cannot flicker.
 * What that leaves is a stretch of transparent window beside the player, which
 * would otherwise swallow clicks meant for whatever is behind it.
 *
 * Cutting the window's *shape* was the obvious answer and was the wrong one. A
 * window that composes with per-pixel alpha stops doing so once it is given a
 * region: the corners outside the rounded shell, transparent until then, began
 * to be painted — a square corner sitting past the rounded one, repainted every
 * time focus went elsewhere. Rounding the cut and holding it clear of the shell
 * both failed, because the shape was never what was drawing there.
 *
 * So the shape is left alone, and Rust watches the cursor instead: over the
 * player the window takes its clicks, anywhere else it is transparent to the
 * mouse. The window's outline, and its transparency, are exactly as they were.
 */
let clickable = 'none';

export async function setClickArea(
  rect: { x: number; y: number; width: number; height: number } | null,
): Promise<void> {
  if (!isTauri()) return;

  // Skipped when it would change nothing. Every animation asks for the whole
  // window before it starts, which on the right is what it always had.
  const wanted = rect
    ? [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(',')
    : 'none';
  if (wanted === clickable) return;
  clickable = wanted;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_click_area', {
      x: Math.round(rect?.x ?? 0),
      y: Math.round(rect?.y ?? 0),
      // Negative for "all of it".
      width: rect ? Math.round(rect.width) : -1,
      height: rect ? Math.round(rect.height) : -1,
    });
  } catch (err) {
    // Forgotten again, so the next attempt is not skipped as a repeat of
    // something the window never took.
    clickable = 'unknown';
    // The window still shows what it should. The cost is clicks landing on a
    // transparent edge, which is worth a warning and not an interruption.
    console.warn('[window] could not set the clickable area', err);
  }
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
export async function setWindowSize(width: number, height: number, dx = 0): Promise<void> {
  if (!isTauri()) return;

  const w = Math.round(width);
  const h = Math.round(height);

  // Anything that moves the window goes through Rust, where the resize and the
  // move happen microseconds apart inside one command rather than across two
  // IPC round trips. The drawer opening leftwards changes the width and the x
  // by the same amount, and either of them landing a frame before the other
  // puts the player six hundred and eighty pixels from where it was.
  if (dx !== 0) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_window_box', { width: w, height: h, dx: Math.round(dx) });
      return;
    } catch (err) {
      // Falling through to the plain resize. A window at the right size in the
      // wrong place beats one at neither.
      console.warn('[window] could not move and resize', err);
    }
  }

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
