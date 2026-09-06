import { isTauri } from '@/core/utils/env';

/**
 * The spectrum Rust sends, and what more than one thing can do with it.
 *
 * `src-tauri/src/visualizer` listens to this app's own webview and emits a
 * frame of bands thirty times a second. Two things on this side want that now —
 * the blocks behind the deck and the light around the window's edge — and the
 * capture is a single process-wide thing with a plain start and stop. Two
 * components calling those directly is one of them switching the other off.
 *
 * So the capture is counted here: it starts when the first watcher arrives and
 * stops when the last one leaves.
 */

/** The event Rust emits. One array of floats in 0..=1. */
const EVENT = 'visualizer:bars';

type Watcher = (bars: number[]) => void;

const watchers = new Set<Watcher>();
let stop: (() => void) | null = null;
/**
 * Which run of the capture is the current one.
 *
 * Starting reaches Rust and back, and a watcher can arrive and leave inside
 * that. The number is what lets a start that is no longer wanted put itself
 * away instead of leaving a listener attached to a window that may be closing.
 */
let run = 0;

async function begin(mine: number): Promise<void> {
  const [{ invoke }, { listen }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
  ]);

  const unlisten = await listen<number[]>(EVENT, (event) => {
    for (const watcher of watchers) watcher(event.payload);
  });

  if (mine !== run) {
    unlisten();
    return;
  }
  // Both, and in this order: a listener attached after the capture started
  // would miss frames.
  stop = () => {
    unlisten();
    void invoke('visualizer_stop');
  };
  await invoke('visualizer_start');
}

/**
 * Hand a frame to everything watching, from outside Rust.
 *
 * Development only, and the only way to see any of this in a plain browser:
 * the frames come from a Windows audio interface, so `npm run dev` has no
 * sound to draw and every edge stays dark. The same shape as the store handles
 * in `main.tsx`, and stripped from a build by the `DEV` guard.
 */
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__grooviumBars = (bars: number[]) => {
    for (const watcher of watchers) watcher(bars);
  };
}

/** Hear every frame until the returned function is called. */
export function watchBars(watcher: Watcher): () => void {
  watchers.add(watcher);
  if (watchers.size === 1 && isTauri()) {
    run += 1;
    void begin(run);
  }

  return () => {
    watchers.delete(watcher);
    if (watchers.size > 0) return;
    // Bumped so a start still on its way home knows it is not wanted.
    run += 1;
    stop?.();
    stop = null;
  };
}

/**
 * One number for how loud it is, from a frame of bands.
 *
 * A mean rather than a peak. Music lights a handful of bands hard and leaves
 * the rest low, so a peak sits near the top through anything with a drum in it
 * and says nothing about loudness — but a plain mean sits around a third even
 * when it is loud, which reads as a meter that never arrives. The curve lifts
 * the middle of the range without letting quiet read as loud: silence is still
 * nothing, and the difference between a verse and a chorus is still visible.
 */
export function levelFrom(bars: number[]): number {
  if (bars.length === 0) return 0;
  let sum = 0;
  for (const bar of bars) sum += bar;
  return Math.min(1, Math.pow(sum / bars.length, 0.6));
}

/** Below this a level is nothing, and saying so stops it decaying forever. */
const LEVEL_FLOOR = 0.003;

/** How much of a level survives a frame it was not renewed in. */
const LEVEL_FALL = 0.86;

/**
 * The level to show, given the one being shown and the one just measured.
 *
 * Straight up and slow down, which is what a meter does: a transient should
 * arrive the instant it happens, and the fall afterwards is what makes the
 * light read as one thing moving rather than as a row of numbers.
 */
export function settleLevel(showing: number, measured: number): number {
  if (measured >= showing) return measured;
  const fallen = Math.max(measured, showing * LEVEL_FALL);
  return fallen < LEVEL_FLOOR ? 0 : fallen;
}
