import { useEffect, useRef } from 'react';
import { levelFrom, visualizerOpacity, watchBars } from '@/core/visualizer';
import { usePlayerStore } from '@/core/store';
import {
  FLARE_FADE,
  FLARE_TAU,
  FLOOR_LINE,
  GROOVES,
  HALO,
  GLINT,
  LEVEL_TAU,
  SWING,
  curvePoints,
  ease,
  glintAt,
  glintSpeed,
  presence,
  springStep,
  SINK,
  FLAT,
  flatten,
  sounding,
  spread,
} from '@/core/visualizer/grooves';
import { NO_BEAT, listen, type Beat } from '@/core/visualizer/onset';
import type { DrawerSide, VisualizerLook } from '@/core/settings';
import { SQUEEZE, uncovered } from './squeeze';
import { prefersReducedMotion } from '@/core/utils/motion';
import { useShown } from '@/platform/shown';
import { whilePaletteMoves } from '@/core/theme/palette';

/**
 * Bars behind the deck, moving to whatever the speakers are playing — or, in
 * the look that is the default now, grooves: a few thin lines stacked like a
 * record's, a light fill under each, and a glint travelling along them. See
 * `core/visualizer/grooves` for how they move and why.
 *
 * Fed from Rust, which listens to the machine's output device — see
 * `src-tauri/src/visualizer`. That is the only place a spectrum could have come
 * from: what this app mostly plays is DRM-protected media from Spotify's SDK,
 * which cannot be routed through a Web Audio graph at all. It also means the
 * bars answer to the whole machine rather than to this app, which the setting
 * that turns them on says out loud.
 *
 * A canvas rather than two dozen elements. This answers the capture for as long
 * as the app is open, and doing that by writing heights onto DOM nodes is a
 * style recalculation per frame on the element that everything else in the
 * window sits on top of.
 *
 * A column is only redrawn when it has changed height. It used to lay the whole
 * grid down again on every frame — at this size, two and a half thousand blocks
 * sixty times a second — and it did that with the machine silent as well, since
 * a grid of unlit blocks is still a grid that has to be drawn. Silence now
 * costs nothing at all: every column is already showing what it should, so
 * nothing is painted, and a layer nothing paints into is a layer the compositor
 * has no new work for.
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

/** A colour as its three channels, for drawing it at any strength. */
type Rgb = [number, number, number];

/**
 * The channels of a CSS colour, as the stylesheet hands them back.
 *
 * Hex as written, or `rgb()` as the browser reports a colour mid-transition;
 * anything else is the fallback rather than a thrown error inside the loop.
 */
function rgbOf(colour: string, fallback: Rgb): Rgb {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim());
  if (hex) {
    const digits = hex[1] ?? '';
    const full = digits.length === 3 ? digits.replace(/./g, (d) => d + d) : digits;
    return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16)) as Rgb;
  }
  const parts = /rgba?\(([^)]+)\)/i.exec(colour)?.[1]?.split(/[\s,/]+/).filter(Boolean);
  if (parts && parts.length >= 3) {
    const channels = parts.slice(0, 3).map(Number);
    if (channels.every(Number.isFinite)) return channels as Rgb;
  }
  return fallback;
}

/** A colour at a strength, for a gradient stop. */
const rgba = ([r, g, b]: Rgb, alpha: number) =>
  `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.max(0, Math.min(1, alpha))})`;

/** The glint's middle: the bright brass most of the way to white. */
const hotter = ([r, g, b]: Rgb): Rgb => [r + (255 - r) * 0.6, g + (255 - g) * 0.6, b + (255 - b) * 0.6];

/**
 * A smooth line through points: Catmull-Rom, drawn as the Béziers it is.
 * `joined` carries on from wherever the path already is, for a shape whose
 * second edge is a line too.
 */
function trace(
  context: CanvasRenderingContext2D,
  points: [number, number][],
  joined = false,
): void {
  const first = points[0];
  if (!first) return;
  if (joined) context.lineTo(first[0], first[1]);
  else context.moveTo(first[0], first[1]);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[Math.max(0, i - 1)] ?? first;
    const b = points[i] ?? first;
    const c = points[i + 1] ?? b;
    const d = points[Math.min(points.length - 1, i + 2)] ?? c;
    context.bezierCurveTo(
      b[0] + (c[0] - a[0]) / 6,
      b[1] + (c[1] - a[1]) / 6,
      c[0] - (d[0] - b[0]) / 6,
      c[1] - (d[1] - b[1]) / 6,
      c[0],
      c[1],
    );
  }
}

/** Below this nothing is moving, and the grooves can stop being drawn. */
const STILL = 0.002;

/**
 * How many ribbons a groove's fill is laid down in.
 *
 * The fill hangs from the line and fades over `GROOVES.depth`, following the
 * line wherever it goes. No one gradient can do that — the line is at a
 * different height at every point — and strips of one under each point left
 * seams and steps down the window. So it is ribbons instead: each the groove's
 * own shape, from the line down to a little further than the last, all added
 * together. Near the line every ribbon covers it; further down, fewer do. Six
 * steps of a sixth of the fill each, which at a quarter opacity is a fade
 * nobody can count — and each is a shape filled on every frame, so no more of
 * them than that.
 */
const RIBBONS = 6;

/**
 * The most pixels the grooves are drawn in, per CSS pixel.
 *
 * They are drawn whole on every frame — the blocks only ever redraw a column
 * that moved — and what that costs is the canvas's area. The window's own
 * scale and the display's multiply into the device pixel ratio, so at 150% of
 * each the canvas was five times its size at 100%, and the window felt it.
 * Soft lines and a fill a quarter seen are not worth those pixels: drawn at
 * one per CSS pixel and stretched, they look the same, and cost the same at
 * any scale.
 */
const SHARPEST = 1;

export function Visualizer({
  on,
  look,
  brightness,
  covered,
}: {
  on: boolean;
  look: VisualizerLook;
  /** A notch from -4 to 4; see `visualizerOpacity`. */
  brightness: number;
  /**
   * The side whose drawer the lyrics record is covering, or null. The grooves
   * squeeze into what is left of the window; see `squeeze`.
   */
  covered: DrawerSide | null;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  /**
   * The latest frame from Rust.
   *
   * A ref and not state. Thirty events a second through `setState` is thirty
   * renders a second of the whole window, to move something nobody is looking
   * directly at.
   */
  const bars = useRef<number[]>([]);
  const shown = useShown();
  /**
   * Whether the music is playing, from the player rather than the sound.
   *
   * Paused, the capture is sent nothing new and goes on handing over the last
   * window it had — a frame of music, frozen — so the sound cannot be trusted
   * to say the song has stopped. A ref, read by the loop, so pausing does not
   * tear the drawing down.
   */
  const playing = useRef(false);
  const isPlaying = usePlayerStore((s) => s.playbackState === 'PLAYING');
  useEffect(() => {
    playing.current = isPlaying;
  }, [isPlaying]);
  /** The side covered, for the loop; a ref so the record opening does not restart it. */
  const covering = useRef<DrawerSide | null>(covered);
  useEffect(() => {
    covering.current = covered;
  }, [covered]);

  useEffect(() => {
    if (!on || !shown) return;
    // Counted rather than started here. The light around the window's edge
    // wants the same frames, and two components calling the capture's own stop
    // is one of them switching the other off.
    return watchBars((frame) => {
      bars.current = frame;
    });
  }, [on, shown]);

  useEffect(() => {
    const el = canvas.current;
    if (!on || !shown || !el) return;

    const context = el.getContext('2d');
    if (!context) return;

    let colours = palette(document.documentElement);
    let deep: Rgb = rgbOf(colours.low, [162, 116, 63]);
    let bright: Rgb = rgbOf(colours.high, [224, 176, 113]);
    const recolour = () => {
      deep = rgbOf(colours.low, [162, 116, 63]);
      bright = rgbOf(colours.high, [224, 176, 113]);
    };
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
      // The grooves at no more than one pixel to the CSS pixel; see `SHARPEST`.
      const dpr = look === 'grooves'
        ? Math.min(SHARPEST, window.devicePixelRatio || 1)
        : window.devicePixelRatio || 1;
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      if (w === width && h === height && el.width === Math.round(w * dpr)) return;
      width = w;
      height = h;
      // A resize empties the canvas and moves every column, so what each one
      // is showing is no longer known.
      afresh = true;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      // Writing either of those resets the context, so the scale goes back on
      // afterwards and not once at the start.
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      colours = palette(document.documentElement);
      recolour();
    };
    // A theme change rewrites the custom properties on the root and changes no
    // size at all, so nothing watching the element for its size would hear
    // about it.
    const reread = () => {
      colours = palette(document.documentElement);
      recolour();
      afresh = true;
    };
    const themed = new MutationObserver(reread);
    themed.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-ground', 'style'],
    });
    // And every frame for as long as the fade lasts. The variables are
    // registered and transitioned, so the document reports wherever the
    // animation currently is — which is exactly what should be drawn, and
    // exactly what makes this fade along with the window instead of switching
    // at one end of it. Reading once, at the moment the attribute changed, is
    // what left these a theme behind.
    const fading = whilePaletteMoves(reread);

    let frame = 0;
    /** How high each column is drawn, so one that has not moved is left alone. */
    let standing: number[] = [];
    /** Everything down again: the first frame, a resize, a change of palette. */
    let afresh = true;

    const drawBlocks = () => {
      const values = bars.current;
      if (values.length === 0) return;

      const step = BLOCK + GAP;
      const columns = Math.max(1, Math.floor((width + GAP) / step));
      const rows = Math.max(1, Math.floor((height + GAP) / step));
      // Centred in whatever is left over, so the grid does not sit against one
      // edge with a wider gap at the other.
      const left = Math.round((width - (columns * step - GAP)) / 2);

      if (standing.length !== columns) {
        standing = new Array<number>(columns).fill(-1);
        afresh = true;
      }
      // The margins either side of the grid are never drawn in, so they are
      // only ever cleared here — where the grid may just have moved.
      if (afresh) context.clearRect(0, 0, width, height);

      for (let c = 0; c < columns; c++) {
        const value = spread(values, c, columns);
        const lit = value <= FLOOR ? 0 : Math.max(1, Math.round(value * rows));
        // Already showing exactly this. The blocks below are what a column is,
        // and drawing them again would put down the same picture.
        if (!afresh && standing[c] === lit) continue;
        standing[c] = lit;

        const x = left + c * step;
        if (!afresh) context.clearRect(x, 0, BLOCK, height);
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
      afresh = false;
    };

    /** Each band's spring, where it is and how fast it is going. */
    let pos: number[] = [];
    let vel: number[] = [];
    let level = 0;
    /** A kick's flare: where it is heading, and where it is. */
    let flareTo = 0;
    let flare = 0;
    let beat: Beat = NO_BEAT;
    /** How far the glint has travelled, in widths. */
    let travelled = 0;
    let last = performance.now();
    /** Whether the canvas is already empty, so stillness is not cleared again. */
    let blank = false;
    /** Where across the window the grooves are drawn, as it eases; see `squeeze`. */
    let spanFrom = 0;
    let spanTo = 0;
    /** How present the grooves are, nought to one; see `presence`. */
    let present = 0;

    const drawGrooves = (now: number) => {
      // Capped, so a window hidden for a while does not come back to a leap.
      const seconds = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const target = bars.current;
      if (pos.length !== target.length) {
        pos = target.map(() => 0);
        vel = target.map(() => 0);
      }

      let moving = false;
      const stopped = !playing.current;

      // Where across the window the grooves go: all of it, or what the lyrics
      // record leaves — eased there, so they squeeze in and spread back out.
      const side = covering.current;
      const [toFrom, toTo] = side ? uncovered(width, height, side) : [0, width];
      if (spanTo <= spanFrom) {
        spanFrom = toFrom;
        spanTo = toTo;
      }
      spanFrom = ease(spanFrom, toFrom, seconds, SQUEEZE / 3);
      spanTo = ease(spanTo, toTo, seconds, SQUEEZE / 3);
      if (Math.abs(spanFrom - toFrom) > 0.5 || Math.abs(spanTo - toTo) > 0.5) moving = true;
      const span = Math.max(1, spanTo - spanFrom);
      for (let band = 0; band < target.length; band++) {
        if (stopped) {
          // Flattening where they are, at the pace chosen for it; see `FLATTEN`.
          pos[band] = flatten(pos[band] ?? 0, seconds);
          vel[band] = 0;
        } else {
          const next = springStep(pos[band] ?? 0, vel[band] ?? 0, target[band] ?? 0, seconds);
          pos[band] = next.pos;
          vel[band] = next.vel;
        }
        if ((pos[band] ?? 0) > STILL || Math.abs(vel[band] ?? 0) > STILL) moving = true;
      }
      level = ease(level, levelFrom(pos.map((at) => Math.min(1, at))), seconds, LEVEL_TAU);
      const heard = listen(beat, target, seconds);
      beat = heard.beat;
      flareTo = Math.max(heard.hit, flareTo - seconds * FLARE_FADE);
      flare = ease(flare, flareTo, seconds, FLARE_TAU);
      travelled += seconds * glintSpeed(level, flare);
      present = presence(
        present,
        !stopped && sounding(target),
        pos.every((at) => at < FLAT),
        seconds,
      );

      // Nothing moving and nothing lit: the canvas is already what it should
      // be, so silence is not a frame's work.
      if (present < STILL && !moving && flare < STILL && !afresh) {
        if (!blank) context.clearRect(0, 0, width, height);
        blank = true;
        return;
      }
      blank = false;
      afresh = false;
      context.clearRect(0, 0, width, height);
      context.save();
      context.translate(spanFrom, 0);
      context.globalCompositeOperation = 'lighter';

      const scale = height * SWING;
      // Down past the foot when there is no sound, and back up when there is.
      const sunk = (1 - present) * height * SINK;
      const depth = Math.max(6, height * GROOVES.depth);
      const hot = hotter(bright);
      // Back to front, so the top groove is laid over the rest.
      for (let layer = GROOVES.layers - 1; layer >= 0; layer--) {
        const down = GROOVES.layers > 1 ? layer / (GROOVES.layers - 1) : 0;
        const points = curvePoints(pos, span, height * FLOOR_LINE - layer * GROOVES.gap + sunk, scale);

        // The fill, hanging from the line wherever the line is; see `RIBBONS`.
        const strength = (GROOVES.fill * (1 - down * 0.5) * (1 + 0.4 * flare)) / RIBBONS;
        context.fillStyle = rgba(deep, 1);
        context.globalAlpha = Math.min(1, strength);
        for (let ribbon = 1; ribbon <= RIBBONS; ribbon++) {
          const drop = (depth * ribbon) / RIBBONS;
          const below: [number, number][] = [];
          for (let at = points.length - 1; at >= 0; at--) {
            const [x, y] = points[at] ?? [0, 0];
            // Not held to the canvas: past its foot is simply not drawn, and
            // holding it there piled every ribbon up along the bottom edge.
            below.push([x, y + drop]);
          }
          context.beginPath();
          trace(context, points);
          trace(context, below, true);
          context.closePath();
          context.fill();
        }

        // The glint, as a band of light along the line: a halo first, then the
        // line itself, which is dim away from it.
        const at = glintAt(travelled, down);
        const along = (reach: number, rest: number, peak: number) => {
          const light = context.createLinearGradient(0, 0, span, 0);
          const clamp = (v: number) => Math.max(0, Math.min(1, v));
          light.addColorStop(0, rgba(bright, rest));
          light.addColorStop(clamp(at - reach), rgba(bright, rest));
          light.addColorStop(clamp(at), rgba(hot, peak));
          light.addColorStop(clamp(at + reach), rgba(bright, rest));
          light.addColorStop(1, rgba(bright, rest));
          return light;
        };
        context.globalAlpha = 1 - down * 0.4;
        context.beginPath();
        trace(context, points);
        context.strokeStyle = along(HALO, 0, GROOVES.glow * 0.35 * (1 + flare * 0.8));
        context.lineWidth = 9;
        context.stroke();
        context.beginPath();
        trace(context, points);
        context.strokeStyle = along(GLINT, 0.22 + 0.25 * flare, GROOVES.glow);
        context.lineWidth = layer === 0 ? 1.8 : 1.2;
        context.stroke();
      }
      context.restore();
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
    };

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      measure();
      if (look === 'blocks') drawBlocks();
      else drawGrooves(now);
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
      fading();
    };
  }, [on, shown, look]);

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
      // Rounded like the shell, for the same reason the edge light is: a
      // canvas repainting every frame gets a compositor layer of its own, and a
      // promoted layer can escape an ancestor's rounded clip.
      // How strongly it shows through is the brightness setting's, a quarter
      // unless somebody has moved it.
      style={{ opacity: visualizerOpacity(brightness) }}
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full rounded-[var(--radius-widget)]"
    />
  );
}
