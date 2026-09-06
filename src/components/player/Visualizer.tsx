import { useEffect, useRef } from 'react';
import { watchBars } from '@/core/visualizer';
import { prefersReducedMotion } from '@/core/utils/motion';
import { whenPaletteSettles } from '@/core/theme/palette';

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

/**
 * One block, and the space around it, in px.
 *
 * A fixed size rather than a share of the width, which is what this used to be
 * — twenty-four columns however wide the window was, so a block was the width
 * divided by twenty-four. Opening the drawer takes the window from 340 to 1020
 * and that turned a grid of 24 by 33 small squares into 24 by 11 great slabs:
 * not the same thing wider, a different thing.
 *
 * With the size pinned, the *number* of columns follows the width instead. Two
 * dozen across the player alone, three times that with the drawer out, and a
 * block is the same block either way.
 */
const BLOCK = 12;
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

/**
 * One column's height, read across however many bands there are.
 *
 * Rust sends a fixed two dozen; how many columns fit is up to the window. With
 * the drawer out there are three columns per band, so each is read between its
 * two nearest neighbours rather than repeated — repeating draws the same
 * spectrum in steps three blocks wide, which reads as the bars having got fat
 * rather than as there being more of them.
 */
function spread(values: number[], column: number, columns: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0] ?? 0;
  const at = (column / Math.max(1, columns - 1)) * (values.length - 1);
  const i = Math.min(values.length - 2, Math.floor(at));
  const t = at - i;
  return (values[i] ?? 0) * (1 - t) + (values[i + 1] ?? 0) * t;
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
    if (!on) return;
    // Counted rather than started here. The light around the window's edge
    // wants the same frames, and two components calling the capture's own stop
    // is one of them switching the other off.
    return watchBars((frame) => {
      bars.current = frame;
    });
  }, [on]);

  useEffect(() => {
    const el = canvas.current;
    if (!on || !el) return;

    const context = el.getContext('2d');
    if (!context) return;

    let colours = palette(document.documentElement);
    let width = 0;
    let height = 0;

    /**
     * Match the backing store to the element's real size, if it has changed.
     *
     * Checked at the top of every frame rather than watched for. A
     * `ResizeObserver` is the obvious tool and was the first one used, but its
     * callbacks are delivered as part of updating the rendering — so anywhere
     * that is not painting, it never fires at all, not even the call it makes
     * when you first observe something. The first measurement then happens
     * before layout, at zero, and nothing ever corrects it. Reading the size
     * each frame costs one layout read on one element and cannot get stuck.
     */
    const measure = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      if (w === width && h === height && el.width === Math.round(w * dpr)) return;
      width = w;
      height = h;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      // Writing either of those resets the context, so the scale goes back on
      // afterwards and not once at the start.
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      colours = palette(document.documentElement);
    };
    // A theme change rewrites the custom properties on the root and changes no
    // size at all, so nothing watching the element for its size would hear
    // about it.
    const reread = () => {
      colours = palette(document.documentElement);
    };
    const themed = new MutationObserver(reread);
    themed.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-ground', 'style'],
    });
    // And again when the fade between palettes is over. The variables are
    // registered and transitioned, so what the document reports the instant
    // the attribute changes is where the animation *starts* — the palette on
    // the way out, which is why these bars were a theme behind.
    const settled = whenPaletteSettles(reread);

    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      measure();
      const values = bars.current;
      context.clearRect(0, 0, width, height);
      if (values.length === 0) return;

      const step = BLOCK + GAP;
      const columns = Math.max(1, Math.floor((width + GAP) / step));
      const rows = Math.max(1, Math.floor((height + GAP) / step));
      // Centred in whatever is left over, so the grid does not sit against one
      // edge with a wider gap at the other.
      const left = Math.round((width - (columns * step - GAP)) / 2);

      for (let c = 0; c < columns; c++) {
        const x = left + c * step;
        const value = spread(values, c, columns);
        const lit = value <= FLOOR ? 0 : Math.max(1, Math.round(value * rows));
        for (let r = 0; r < rows; r++) {
          const y = height - (r + 1) * BLOCK - r * GAP;
          if (r < lit) {
            // Up the column rather than across it: a block's colour says how
            // high it is, which is what makes a tall bar read as loud from the
            // corner of an eye.
            context.fillStyle = r / Math.max(1, rows - 1) < 0.55 ? colours.low : colours.high;
          } else {
            context.fillStyle = colours.dark;
          }
          context.fillRect(x, y, BLOCK, BLOCK);
        }
      }
    };

    // With motion turned down the bars are drawn once, unlit, and left alone.
    if (prefersReducedMotion()) {
      measure();
      context.clearRect(0, 0, width, height);
    } else {
      frame = requestAnimationFrame(draw);
    }

    return () => {
      cancelAnimationFrame(frame);
      themed.disconnect();
      settled();
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
      // `h-full w-full` as well as `inset-0`, which on its own does nothing
      // here: a canvas is a replaced element, so with no CSS size it draws at
      // its own intrinsic size — the `width`/`height` attributes — and the
      // offsets are simply over-constrained and ignored. Measuring that and
      // writing it back grew it every frame; it reached twenty-six thousand
      // pixels across, covered the window and washed everything out.
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-25"
    />
  );
}
