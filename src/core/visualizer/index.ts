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
// `window` as well as the flag: the tests run in node, where the module is
// imported for the two functions below and there is no window to hang this on.
if (import.meta.env.DEV && typeof window !== 'undefined') {
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

/** How far a notch goes either way from the middle. */
export const NOTCHES = 4;

/**
 * What a slider at `notch` means, between the two ends of its range.
 *
 * Every one of these runs from minus four to four with nought in the middle,
 * and nought is always what the edge was tuned to before any of them existed —
 * so a fresh install, a slider nobody has touched, and the way this looked when
 * it was built are all the same thing.
 *
 * Rounded and clamped rather than refused: `config.json` is a file somebody can
 * edit, and these were fractions for one afternoon.
 */
export function span(notch: number, atLeast: number, atMost: number): number {
  const held = Math.max(
    -NOTCHES,
    Math.min(NOTCHES, Math.round(Number.isFinite(notch) ? notch : 0)),
  );
  return (atLeast + atMost) / 2 + ((atMost - atLeast) / 2) * (held / NOTCHES);
}

/**
 * The three the edge is tuned by, as the numbers the drawing wants.
 *
 * Named here rather than at the three places that read them, so the ends of
 * each range are written down together and it is one job to see that the
 * middle of every one of them is the tuning it shipped with.
 */
export const GLOW = {
  /** How wide and how hard the lights burn. */
  strength: (value: number) => span(value, 0.45, 1.55),
  /** How fast they climb. */
  speed: (value: number) => span(value, 0.5, 1.5),
  /**
   * How far above its average the bass must jump to count as a hit.
   *
   * Backwards on purpose: more sensitive is a lower bar to clear.
   */
  threshold: (value: number) => span(value, 1.7, 1.0),
} as const;

/**
 * How much more the lowest band counts than the highest.
 *
 * The bands arrive low to high, and this leans the answer onto the low ones:
 * what should move an ornament on the window's edge is the part of the music
 * you feel rather than the part you hear the words in. A hi-hat is a band at
 * full height every half second and would have the edge flickering through a
 * quiet passage; a kick is what should push it.
 *
 * Not all the way, though — the last band still carries a little, so a track
 * with no bass in it at all still lights the window.
 */
const BASS_TILT = 2.2;
const TREBLE_FLOOR = 0.12;

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
  let weights = 0;
  for (let band = 0; band < bars.length; band++) {
    const weight = Math.pow(1 - band / bars.length, BASS_TILT) + TREBLE_FLOOR;
    sum += (bars[band] ?? 0) * weight;
    weights += weight;
  }
  return Math.min(1, Math.pow(sum / weights, 0.6));
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
