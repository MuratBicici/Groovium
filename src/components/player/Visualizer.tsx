import { useEffect, useRef } from 'react';
import { isTauri } from '@/core/utils/env';
import { prefersReducedMotion } from '@/core/utils/motion';

/**
 * Bars behind the deck, moving to whatever the speakers are playing.
 *
 * Fed from Rust, which listens to the machine's output device — see
 * `src-tauri/src/visualizer`. That is the only place a spectrum could have come
 * from: what this app mostly plays is DRM-protected media from Spotify's SDK,
 * which cannot be routed through a Web Audio graph at all. It also means the
 * bars answer to the whole machine rather than to this app, which the setting
 * that turns them on says out loud.
 *
 * A canvas rather than two dozen elements. This repaints thirty times a second
 * for as long as the app is open, and doing that by writing heights onto DOM
 * nodes is thirty style recalculations a second on the element that everything
 * else in the window sits on top of.
 */

/** Drawn once and stretched, because the shell is the same size all evening. */
const GAP = 2;

/** Below this a bar is not worth a pixel, and clearing is cheaper than drawing. */
const FLOOR = 0.004;

interface Palette {
  /** The lit part of a bar, bottom to top. */
  low: string;
  high: string;
  /** The unlit blocks behind it. */
  dark: string;
}

/**
 * The theme's own colours, read from the stylesheet rather than named here.
 *
 * A custom palette is two colours somebody chose and every surface in the app
 * follows them; a visualiser that did not would be the one thing on screen
 * ignoring the theme. Read once per resize rather than per frame — a computed
 * style read is a style recalculation, and thirty a second is what the canvas
 * is here to avoid.
 */
function palette(root: HTMLElement): Palette {
  const css = getComputedStyle(root);
  const pick = (name: string, fallback: string) =>
    css.getPropertyValue(name).trim() || fallback;
  return {
    low: pick('--color-brass-600', '#a2743f'),
    high: pick('--color-brass-400', '#e0b071'),
    dark: pick('--color-shell-700', '#2e231b'),
  };
}

export function Visualizer({ on }: { on: boolean }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  /**
   * The latest frame from Rust.
   *
   * A ref and not state. Thirty events a second through `setState` is thirty
   * renders a second of the whole window, to move something nobody is looking
   * directly at.
   */
  const bars = useRef<number[]>([]);

  useEffect(() => {
    if (!on || !isTauri()) return;
    let alive = true;
    let stop: (() => void) | undefined;

    void (async () => {
      const [{ invoke }, { listen }] = await Promise.all([
        import('@tauri-apps/api/core'),
        import('@tauri-apps/api/event'),
      ]);
      const unlisten = await listen<number[]>('visualizer:bars', (event) => {
        bars.current = event.payload;
      });
      // Both, and in this order: a listener attached after the capture started
      // would miss frames, and one left attached after it stopped would hold a
      // handle to a window that may be closing.
      if (!alive) {
        unlisten();
        return;
      }
      stop = () => {
        unlisten();
        void invoke('visualizer_stop');
      };
      await invoke('visualizer_start');
    })();

    return () => {
      alive = false;
      stop?.();
    };
  }, [on]);

  useEffect(() => {
    const el = canvas.current;
    if (!on || !el) return;

    const context = el.getContext('2d');
    if (!context) return;

    let colours = palette(document.documentElement);
    let width = 0;
    let height = 0;

    /** The canvas follows the element's real size, at the screen's real pixels. */
    const measure = () => {
      const box = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = Math.max(1, Math.round(box.width));
      height = Math.max(1, Math.round(box.height));
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      colours = palette(document.documentElement);
    };
    measure();

    const resize = new ResizeObserver(measure);
    resize.observe(el);
    // A theme change rewrites the custom properties on the root and changes no
    // size at all, so the observer above would never hear about it.
    const themed = new MutationObserver(() => {
      colours = palette(document.documentElement);
    });
    themed.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-ground', 'style'],
    });

    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const values = bars.current;
      context.clearRect(0, 0, width, height);
      if (values.length === 0) return;

      const columns = values.length;
      const columnWidth = (width - GAP * (columns - 1)) / columns;
      // Square blocks, so the column count decides the row count rather than a
      // second number that could disagree with it.
      const block = columnWidth;
      const rows = Math.max(1, Math.floor((height + GAP) / (block + GAP)));

      for (let c = 0; c < columns; c++) {
        const x = c * (columnWidth + GAP);
        const value = values[c] ?? 0;
        const lit = value <= FLOOR ? 0 : Math.max(1, Math.round(value * rows));
        for (let r = 0; r < rows; r++) {
          const y = height - (r + 1) * block - r * GAP;
          if (r < lit) {
            // Up the column rather than across it: a block's colour says how
            // high it is, which is what makes a tall bar read as loud from the
            // corner of an eye.
            context.fillStyle = r / Math.max(1, rows - 1) < 0.55 ? colours.low : colours.high;
          } else {
            context.fillStyle = colours.dark;
          }
          context.fillRect(x, y, columnWidth, block);
        }
      }
    };

    // With motion turned down the bars are drawn once, unlit, and left alone.
    if (prefersReducedMotion()) draw();
    else frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      themed.disconnect();
    };
  }, [on]);

  if (!on) return null;

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      // `-z-10`, which is the one place in this window's layer table that is
      // below the content rather than above it: a negative index paints over
      // the shell's own background and under everything in flow. The shell has
      // to be a stacking context for that to mean "under the shell's content"
      // rather than "under the shell".
      className="pointer-events-none absolute inset-0 -z-10 opacity-25"
    />
  );
}
