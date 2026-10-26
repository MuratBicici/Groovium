/**
 * A palette on the move: fading it, and reading it while it fades.
 *
 * Anything drawn from the palette — the light behind the deck, the light on
 * the window's edge — wants the value on screen at each step: that is what
 * makes a canvas fade along with the window instead of switching at one end of
 * the fade or the other. `whilePaletteMoves` says when to read it.
 *
 * Anything *derived* from the palette and written back into it — the hairline
 * between the player and the drawer, the text colour on a filled button — wants
 * the value the fade is heading for, before it sets off. Given the value on
 * screen it would chase it a step behind and land late, which is what "it
 * changes with a click, a moment afterwards" looks like. `palettePeek`.
 */

import { mixOklab, parseCssColour, toHex, type Rgb } from '@/core/utils/colour';
import { pacer } from '@/core/utils/pace';

/** The colours that fade, as `@property` registers them in the stylesheet. */
export const PALETTE_COLOURS = [
  '--color-shell-900',
  '--color-shell-800',
  '--color-shell-700',
  '--color-shell-600',
  '--color-brass-400',
  '--color-brass-500',
  '--color-brass-600',
  '--color-cream-50',
  '--color-cream-200',
  '--color-cream-400',
  '--color-on-accent',
  '--color-edge',
] as const;

/**
 * How many steps a second a fade takes. Each one restyles every element in the
 * window — four milliseconds of it measured with the drawer open, and the
 * frame it lands in runs long — so not sixty: a colour moving over a second
 * and a half shows no steps at thirty, and half the steps is half the frames
 * that run long.
 */
const FADE_STEPS = 30;

/** Told on every step of a fade, and once more when it lands. */
const steps = new Set<() => void>();

/** The fade under way: its frame, and what the change itself wrote inline, to put back at the end. */
let running: { frame: number; own: Map<string, string> } | null = null;

/**
 * The colours on screen, as this module last put them there: the start of
 * the next fade, known rather than read. Reading it was the whole window's
 * styles worked out again at the moment a record is picked up.
 */
let onScreen: (Rgb | null)[] | null = null;

/**
 * Call `step` on every step of a palette fade, and once more when it lands.
 *
 * For the things that draw the palette rather than derive from it, so a canvas
 * fades along with the window instead of switching at one end of it.
 */
export function whilePaletteMoves(step: () => void): () => void {
  steps.add(step);
  return () => {
    steps.delete(step);
  };
}

function tell(): void {
  for (const step of steps) step();
}

/** The palette as the document has it this moment, or null for a colour that will not read. */
function readColours(root: HTMLElement): (Rgb | null)[] {
  const styles = getComputedStyle(root);
  return PALETTE_COLOURS.map((name) => parseCssColour(styles.getPropertyValue(name).trim()));
}

/** CSS's `ease`, near enough: quick out of the start, long into the end. */
export function ease(t: number): number {
  // cubic-bezier(0.25, 0.1, 0.25, 1): the curve's x solved for t by a few
  // Newton steps, then its y read off at the same point.
  const bez = (u: number, p1: number, p2: number) =>
    3 * (1 - u) ** 2 * u * p1 + 3 * (1 - u) * u ** 2 * p2 + u ** 3;
  const slope = (u: number, p1: number, p2: number) =>
    3 * (1 - u) ** 2 * p1 + 6 * (1 - u) * u * (p2 - p1) + 3 * u ** 2 * (1 - p2);
  let u = t;
  for (let i = 0; i < 6; i++) {
    const d = slope(u, 0.25, 0.25);
    if (Math.abs(d) < 1e-6) break;
    u = Math.min(1, Math.max(0, u - (bez(u, 0.25, 0.25) - t) / d));
  }
  return bez(u, 0.1, 1);
}

/** Stop a fade where it is, putting back what the change wrote inline. */
function settle(root: HTMLElement): void {
  if (!running) return;
  cancelAnimationFrame(running.frame);
  for (const [name, value] of running.own) {
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
  running = null;
}

/**
 * Make a change to the palette, and fade the window to it.
 *
 * The fade was the stylesheet's: the colours registered with `@property` and a
 * transition on `:root`. Which worked, and cost the earth. The colours are
 * inherited, so every frame of a fade restyled and repainted every element in
 * the window — and a transition runs on every frame the screen makes, which on
 * a 240 Hz panel is two hundred and forty of them a second. Picking the record
 * up, the window's colours going back to the theme over a second and a half
 * dropped four to eight frames at a time, and the GPU went to sixty per cent.
 *
 * So it is done here instead, on the same clock as everything else that moves
 * (`pace`): where the colours are now, the change made with nothing moving,
 * where they have arrived, and the steps between written over the top —
 * `FADE_STEPS` a second — until the change's own values are put back at the end.
 * How long it takes is still the stylesheet's to say, in `--palette-ms`.
 */
export function fadePalette(root: HTMLElement, change: () => void): void {
  if (typeof getComputedStyle !== 'function') {
    change();
    return;
  }
  const from = onScreen ?? readColours(root);
  settle(root);
  change();
  const to = readColours(root);
  onScreen = to;
  const ms = parseFloat(getComputedStyle(root).getPropertyValue('--palette-ms')) || 0;
  const moves = from.some((colour, k) => colour && to[k] && toHex(colour) !== toHex(to[k]!));
  if (ms <= 0 || !moves) {
    tell();
    return;
  }

  const own = new Map(PALETTE_COLOURS.map((name) => [name, root.style.getPropertyValue(name)]));
  const write = (t: number) => {
    const now = PALETTE_COLOURS.map((name, k) => {
      const a = from[k];
      const b = to[k];
      if (!a || !b) return b ?? null;
      const mixed = mixOklab(a, b, t);
      root.style.setProperty(name, toHex(mixed));
      return mixed;
    });
    onScreen = now;
  };
  write(0);
  const start = performance.now();
  const due = pacer(FADE_STEPS);
  const step = (now: number) => {
    if (!running) return;
    const t = Math.min(1, (now - start) / ms);
    if (t < 1 && !due(now)) {
      running.frame = requestAnimationFrame(step);
      return;
    }
    if (t >= 1) {
      settle(root);
      onScreen = to;
      tell();
      return;
    }
    write(ease(t));
    tell();
    running.frame = requestAnimationFrame(step);
  };
  running = { frame: requestAnimationFrame(step), own };
}

/**
 * Read the document as it will be once `wearing` is on it, before it moves.
 *
 * A registered property cannot be asked for its target while it is in flight,
 * so the target is fetched by going there and coming back with the transition
 * held off: put the new theme on, force the styles to resolve, read, put the
 * old theme back, force them again, and only then let the transition return.
 * The change is made for real afterwards, from exactly where it started, so it
 * still fades.
 *
 * All of it inside one task, and a browser paints between tasks rather than
 * inside one — so nothing of the two forced resolutions reaches a screen. What
 * it costs is a handful of style recalculations on a gesture a person makes by
 * hand, perhaps once a day.
 *
 * `wear` is asked to put a theme on the document; `read` to say what it sees.
 */
export function palettePeek<T>(
  root: HTMLElement,
  wearing: string | null,
  wear: (theme: string | null) => void,
  read: () => T,
): T {
  const worn = root.dataset.theme ?? null;
  const stashed = root.style.transition;

  try {
    root.style.transition = 'none';
    wear(wearing);
    const seen = read();
    wear(worn);
    // Reading a layout property is what forces the styles to resolve again, so
    // the old palette is back in place before the transition is allowed to
    // notice anything changed.
    void root.offsetWidth;
    return seen;
  } finally {
    if (stashed) root.style.transition = stashed;
    else root.style.removeProperty('transition');
  }
}
