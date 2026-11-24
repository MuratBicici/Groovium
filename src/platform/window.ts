import { isTauri } from '@/core/utils/env';
import { log } from '@/platform/log';

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
 * The page's width, which on the left is not the shell's.
 *
 * Opening to the left means the player has to stay where it is while the drawer
 * appears beside it. Moving the window's left edge with the page inside it
 * flickered: the window takes its existing pixels with it and the webview lays
 * out again a frame later, so for that frame the shell is drawn where the
 * window used to be.
 *
 * So on the left the *page* does not change at all. It is always as wide as the
 * drawer needs, and the shell grows inside it. What changes is the window: shut,
 * it is only the player, and the page reaches past its left edge by the
 * drawer's width (`Placement.reach`; `place_window` in Rust, with a patched wry).
 * The page is never laid out again for it, so nothing on screen moves but the
 * window's edge.
 */
export function windowWidthFor(drawerOpen: boolean, side: 'left' | 'right'): number {
  return side === 'left' ? PLAYER_WIDTH + DRAWER_WIDTH : widthFor(drawerOpen);
}

/**
 * Say which part of the window takes clicks, or `null` for all of it.
 *
 * Asked in the page's pixels, and moved into the window's here, by the page's
 * reach past the window's left edge (`Placement`). At rest the window is only
 * the shell and all of it takes clicks. While the drawer opens or shuts on the
 * left, the window is as wide as the drawer for the length of the animation and
 * the shell grows or shrinks inside it; what is not shell yet is transparent
 * window, which would otherwise swallow clicks meant for whatever is behind it.
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

/**
 * Where the window goes around the page: which side the player is on, and how
 * much of the page lies past the window's left edge, in the page's pixels.
 */
export interface Placement {
  side: 'left' | 'right';
  reach: number;
}

/** The placement the window is in now, for the clickable area and for a zoom. */
let placed: Placement = { side: 'right', reach: 0 };

/**
 * How large the window is drawn: see `Settings.scale`.
 *
 * Everything the page asks of the window is in the page's own pixels, and the
 * page is zoomed by this. So the window's size and its clickable area are
 * multiplied by it on the way out, here, and nowhere else has to know.
 */
let zoom = 1;
/** The last size asked for, in the page's pixels, to redo when the zoom changes. */
let lastSize: { width: number; height: number; place: Placement } | null = null;
/** The last clickable area asked for, likewise; undefined before the first. */
let lastArea: { x: number; y: number; width: number; height: number } | null | undefined;

/**
 * Everything that changes the window, one at a time and in the order asked.
 *
 * Sizing the window is several round trips — set, read back, maybe set again —
 * and two of them at once raced. At startup the first size (for the designed
 * scale) and the zoom's own resize (for the stored one) ran side by side; the
 * first finished last, read back the second's size, took it for a failed
 * resize, and put its own back. The page was then zoomed in a window sized for
 * no zoom at all: stretched, the player off to one side, and the clickable area
 * — worked out for the zoom — somewhere the player was not. Queued, each job
 * reads the zoom when it runs, not when it was asked for.
 */
let queue: Promise<unknown> = Promise.resolve();

function inOrder(job: () => Promise<void>): Promise<void> {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

/** Draw the whole window at `scale` times its designed size. */
export function setWindowZoom(scale: number): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return inOrder(async () => {
    if (scale === zoom) return;
    zoom = scale;
    try {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      await getCurrentWebview().setZoom(scale);
    } catch (err) {
      log('warn', 'window', 'could not zoom the page', err);
    }
    // The same page at the new size: the window follows, and so does the
    // part of it that takes clicks.
    if (lastSize) await applySize(lastSize.width, lastSize.height, lastSize.place);
    if (lastArea !== undefined) {
      clickable = 'unknown';
      await applyArea(lastArea);
    }
  });
}

export function setClickArea(
  rect: { x: number; y: number; width: number; height: number } | null,
): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  lastArea = rect;
  return inOrder(() => applyArea(rect));
}

async function applyArea(
  asked: { x: number; y: number; width: number; height: number } | null,
): Promise<void> {
  // Asked in the page's pixels; the window starts `reach` into the page.
  let rect = asked && { ...asked, x: asked.x - placed.reach };
  // The whole of what is shown is the same as all of it.
  const shown = lastSize ? lastSize.width - placed.reach : Infinity;
  if (rect && rect.width > 0 && rect.x <= 0 && rect.x + rect.width >= shown) rect = null;
  const scaled = rect && {
    x: rect.x * zoom,
    y: rect.y * zoom,
    width: rect.width * zoom,
    height: rect.height * zoom,
  };

  // Skipped when it would change nothing. Every animation asks for the whole
  // window before it starts, which on the right is what it always had.
  const wanted = scaled
    ? [scaled.x, scaled.y, scaled.width, scaled.height].map(Math.round).join(',')
    : 'none';
  if (wanted === clickable) return;
  clickable = wanted;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_click_area', {
      x: Math.round(scaled?.x ?? 0),
      y: Math.round(scaled?.y ?? 0),
      // Negative for "all of it".
      width: scaled ? Math.round(scaled.width) : -1,
      height: scaled ? Math.round(scaled.height) : -1,
    });
  } catch (err) {
    // Forgotten again, so the next attempt is not skipped as a repeat of
    // something the window never took.
    clickable = 'unknown';
    // The window still shows what it should. The cost is clicks landing on a
    // transparent edge, which is worth a warning and not an interruption.
    log('warn', 'window', 'could not set the clickable area', err);
  }
}

/**
 * Lay the page out `width` by `height` and put the window round it, keeping
 * the player where it is on screen.
 *
 * `place` says which side the player is on and how much of the page lies past
 * the window's left edge; see `Placement` and `windowWidthFor`. The window is
 * moved and sized in one go, in Rust, so the player never lands anywhere else
 * for a frame — on the left, where the window's edge moves, nor when the drawer
 * changes sides.
 *
 * Every path is caught: an uncaught rejection here would surface as an
 * unhandled promise from a `void` call site, over a window that is merely the
 * wrong size.
 */
export function setWindowSize(width: number, height: number, place: Placement): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  lastSize = { width, height, place };
  return inOrder(() => applySize(width, height, place));
}

async function applySize(width: number, height: number, place: Placement): Promise<void> {
  const w = Math.round(width * zoom);
  const h = Math.round(height * zoom);

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('place_window', {
      width: w,
      height: h,
      reach: Math.round(place.reach * zoom),
      side: place.side,
      player: Math.round(PLAYER_WIDTH * zoom),
    });
    placed = place;
    return;
  } catch (err) {
    // Falling through to a plain resize of the whole page: a window at the
    // right size, wider than it needs to be on the left, beats one at neither.
    log('warn', 'window', 'could not place the window', err);
    placed = { side: place.side, reach: 0 };
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
    log('warn', 'window', 'could not resize', err);
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
