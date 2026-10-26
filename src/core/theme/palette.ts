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

/**
 * How often the slow parts of the window — the drawers, marked
 * `data-palette-slow` — take a step: four times a second.
 *
 * The drawer is most of the window: two thousand elements and a few hundred
 * covers, measured in the user's own window. A step there restyles all of it,
 * nine to twelve milliseconds, and repaints it. Four times a second is six of
 * those over a second and a half rather than forty-five, and a colour moving
 * that slowly shows no steps at four.
 */
const SLOW_STEP_MS = 250;

/** Told on every step of a fade, and once more when it lands. */
const steps = new Set<() => void>();

/** The fade under way: its frame, and the places it has pinned colours on. */
let running: { frame: number; pinned: HTMLElement[] } | null = null;

/**
 * The colours on screen, as this module last put them there: the start of
 * the next fade, known rather than read. Reading it was the whole window's
 * styles worked out again at the moment a record is picked up.
 */
let onScreen: (Rgb | null)[] | null = null;

/**
 * Where the palette as it looks right now can be read: the window's own
 * background, which takes every step of a fade. The document's root has the
 * colours a fade is going to rather than the ones on screen — see
 * `fadePalette` — so anything that draws the palette reads it here.
 */
export function paletteFace(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-palette-face]') ?? document.documentElement;
}

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

/** Stop a fade where it is: every place it pinned goes back to the document's colours. */
function settle(): void {
  if (!running) return;
  cancelAnimationFrame(running.frame);
  for (const el of running.pinned) for (const name of PALETTE_COLOURS) el.style.removeProperty(name);
  running = null;
}

/**
 * Make a change to the palette, and fade the window to it.
 *
 * The fade was the stylesheet's: the colours registered with `@property` and a
 * transition on `:root`. Every frame of it restyled and repainted every element
 * in the window, on every frame the screen made — two hundred and forty a
 * second on the panel it was measured on. Then it was stepped here, thirty a
 * second, still on the root: and in the user's own window, with the drawer
 * open, each step restyled all two thousand-odd elements, nine to twelve
 * milliseconds a step, and the record stuttered in the hand.
 *
 * So the root is not where it happens. The change goes onto the document at
 * once, and the places that should be seen to fade are held where they were
 * and walked across: the window's background, its title bar and the player
 * (`data-palette-fast`), thirty steps a second at under two milliseconds each;
 * the drawers (`data-palette-slow`) four times a second. When it lands the
 * holds come off and everything is simply the document's colours again. How
 * long it takes is still the stylesheet's to say, in `--palette-ms`.
 */
export function fadePalette(root: HTMLElement, change: () => void): void {
  if (typeof getComputedStyle !== 'function') {
    change();
    return;
  }
  const from = onScreen ?? readColours(root);
  settle();
  change();
  const to = readColours(root);
  onScreen = to;
  const ms = parseFloat(getComputedStyle(root).getPropertyValue('--palette-ms')) || 0;
  const moves = from.some((colour, k) => colour && to[k] && toHex(colour) !== toHex(to[k]!));
  if (ms <= 0 || !moves) {
    tell();
    return;
  }

  const fast = [...document.querySelectorAll<HTMLElement>('[data-palette-fast]')];
  const slow = [...document.querySelectorAll<HTMLElement>('[data-palette-slow]')];
  const mixAt = (t: number) =>
    PALETTE_COLOURS.map((_, k) => {
      const a = from[k];
      const b = to[k];
      return a && b ? mixOklab(a, b, t) : (b ?? null);
    });
  const paint = (els: HTMLElement[], colours: (Rgb | null)[]) => {
    for (const el of els) {
      PALETTE_COLOURS.forEach((name, k) => {
        const colour = colours[k];
        if (colour) el.style.setProperty(name, toHex(colour));
      });
    }
  };
  let slowAt = -Infinity;
  const write = (now: number, t: number) => {
    const colours = mixAt(t);
    paint(fast, colours);
    if (now - slowAt >= SLOW_STEP_MS) {
      slowAt = now;
      paint(slow, colours);
    }
    onScreen = colours;
  };
  // Held where they were in the same task as the change, so nothing is
  // painted in between with the new colours.
  write(performance.now(), 0);
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
      settle();
      onScreen = to;
      tell();
      return;
    }
    write(now, ease(t));
    tell();
    running.frame = requestAnimationFrame(step);
  };
  running = { frame: requestAnimationFrame(step), pinned: [...fast, ...slow] };
  tell();
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
