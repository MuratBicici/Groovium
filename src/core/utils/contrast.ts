import { luminance, mixOklab, parseHex, toHex, type Rgb } from './colour';

/**
 * Making a palette readable instead of hoping it is.
 *
 * The custom palette is built from two colours somebody chose, and it used to be
 * derived entirely by `color-mix()` in the stylesheet. That produced an even,
 * good-looking ramp and could not check a single thing about it, which the
 * stylesheet admitted: *"What this cannot do is promise the result is readable."*
 *
 * The worst case was not a near miss. Text was mixed from the surface **toward
 * white**, so a light surface gave light text on a light ground — unreadable,
 * with only a warning in the panel to say so.
 *
 * So the ramp moved here, where the result can be measured and walked until it
 * passes. Two rules govern the whole file:
 *
 * 1. **The two chosen colours are never altered.** Somebody picked a surface and
 *    an accent; everything derived *from* them is fair game, but the colours
 *    themselves come back exactly as given. When the accent itself cannot be
 *    made to work against the surface, that is reported rather than repaired.
 * 2. **Direction is measured, not assumed.** Text goes toward white on a dark
 *    ground and toward black on a light one, decided by which end actually wins.
 */

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/**
 * WCAG 2.1 contrast ratio: 1 for two identical colours, 21 for black on white.
 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Whether things drawn on this colour should be dark.
 *
 * Defined by which end actually wins rather than by a luminance threshold: a
 * ground is light exactly when black shows up on it better than white does.
 * The crossover lands near a luminance of 0.18, which is far below where it
 * looks like it should be — mid-grey is already dark as far as white text is
 * concerned, and guessing at 0.5 gets a whole band of colours wrong.
 *
 * Not the same question the picker's marker asks
 * (`ColourPicker.tsx`), which is about a ring staying visible over a gradient
 * and is tuned by eye. Two different questions that happen to sound alike.
 */
export function isLightGround(background: Rgb): boolean {
  return contrastRatio(background, BLACK) > contrastRatio(background, WHITE);
}

/** The worst contrast this colour has against any of these backgrounds. */
function worstAgainst(backgrounds: Rgb[], colour: Rgb): number {
  return backgrounds.reduce((worst, on) => Math.min(worst, contrastRatio(on, colour)), Infinity);
}

/**
 * Whichever of black or white reads best across all of these backgrounds.
 *
 * The fallback when a target cannot be met at any colour. Measured rather than
 * inferred from the surface, for the reason `towardReadable` tries both ends.
 */
function mostReadableOn(backgrounds: Rgb[]): Rgb {
  return worstAgainst(backgrounds, WHITE) >= worstAgainst(backgrounds, BLACK) ? WHITE : BLACK;
}

/**
 * Move `from` toward black or white until it reads on **every** background.
 *
 * Returns the adjusted colour, or **null when the target is unreachable** — a
 * mid-tone background tops out well below 21:1, and a caller that wants 7:1 on
 * one of those has to be told rather than handed the closest miss dressed up as
 * a success.
 *
 * Both ends are tried rather than one being chosen from the surface. Choosing
 * up front looks obviously right and is wrong on the boundary: a vivid red sits
 * a hair on the light side of the crossover, so black wins on the shell — and
 * loses on the shade below it, which is darker. One decision cannot serve three
 * surfaces. Measuring both directions against all of them can.
 *
 * When both work, the winner is whichever stayed **closer to `from`**. That is
 * what keeps the text tinted with the surface instead of collapsing to pure
 * black or white the moment either would pass.
 *
 * Binary search rather than stepping: the ratio is monotonic along the blend, so
 * twenty halvings settle it far finer than a byte per channel, and it costs the
 * same whether the answer is near or far.
 */
export function towardReadable(
  background: Rgb | Rgb[],
  from: Rgb,
  target: number,
): Rgb | null {
  const backgrounds = Array.isArray(background) ? background : [background];
  if (backgrounds.length === 0) return null;
  if (worstAgainst(backgrounds, from) >= target) return from;

  let best: Rgb | null = null;
  let bestDistance = Infinity;

  for (const end of [BLACK, WHITE]) {
    if (worstAgainst(backgrounds, end) < target) continue;

    let low = 0;
    let high = 1;
    for (let step = 0; step < 20; step++) {
      const mid = (low + high) / 2;
      if (worstAgainst(backgrounds, mixOklab(from, end, mid)) >= target) high = mid;
      else low = mid;
    }
    // The blend is floating point and the result is bytes, so the rounded
    // colour can land a hair under. Fall back to the endpoint rather than
    // return something that fails the check this function exists to pass.
    const found = mixOklab(from, end, high);
    const candidate = worstAgainst(backgrounds, found) >= target ? found : end;
    const distance = worstAgainst(backgrounds, candidate) >= target ? high : 1;

    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

/**
 * Contrast targets, by the job each colour does.
 *
 * WCAG's own numbers: 4.5 for body text, 3 for large or secondary text, 7 for
 * the AAA grade. `boost` is the readability setting — it does not invent a new
 * scale, it moves every role up a grade.
 */
export interface Targets {
  /** Headings and primary text. */
  strong: number;
  /** Body text. */
  body: number;
  /** Secondary and meta text. */
  quiet: number;
  /** The accent, against the surface it sits on. */
  accent: number;
  /** Dark text on an accent-filled button. */
  onAccent: number;
}

export const NORMAL_TARGETS: Targets = {
  strong: 7,
  body: 4.5,
  quiet: 3,
  accent: 3,
  onAccent: 4.5,
};

/**
 * Above AAA, because AAA does not move anything here.
 *
 * The first attempt raised each role by a grade — 7 to 8.5, 4.5 to 7, 3 to 4.5
 * — which is the tidy answer and did nothing at all. Measured against the five
 * hand-written palettes, every one of them already clears those: Espresso's
 * worst case is 13.4 / 10.1 / 5.4, Sakura's 13.2 / 10.0 / 5.2. A setting called
 * *increase readability* that changes no pixel on any built-in palette is a
 * setting somebody will reasonably report as broken.
 *
 * So these are pitched where they bite. **Secondary text is the one that
 * actually moves** on the presets, and it is the one worth moving: at 5.2 it is
 * the hardest thing in the window to read, while body and heading text are
 * already far past the point where more contrast helps rather than just glares.
 */
export const BOOSTED_TARGETS: Targets = {
  strong: 12,
  body: 9,
  quiet: 7,
  accent: 4.5,
  onAccent: 7,
};

export function targetsFor(boost: boolean): Targets {
  return boost ? BOOSTED_TARGETS : NORMAL_TARGETS;
}

/**
 * How far each shade of the surface sits from the colour it was given.
 *
 * Positive is toward black, negative toward white — and **the direction never
 * flips**, on any ground. These shades encode depth, not theme: 900 paints the
 * well behind the platter and the inside of every input, and a recess that is
 * lighter than the surface around it reads as something raised. Only text
 * changes which way it goes.
 *
 * The dark steps are lifted from Espresso, the same proportions the stylesheet
 * used: its 900 sits about half way to black from its 700, its 600 a little way
 * toward white. A custom palette built from Espresso's own two colours
 * therefore lands back on something close to Espresso, which is what makes it a
 * sane place to start adjusting from.
 *
 * The light steps are far shorter. Half way to black from a near-white shell is
 * a mid grey, which is not a recess but a hole; light interfaces separate their
 * depths by a few percent and let the shadow do the rest.
 */
const SHELL_STEPS = { 900: 0.48, 800: 0.26, 700: 0, 600: -0.1 } as const;
const LIGHT_SHELL_STEPS = { 900: 0.1, 800: 0.05, 700: 0, 600: -0.045 } as const;

/**
 * How far each text shade travels toward the readable end.
 *
 * The dark set is what the stylesheet used — 7%, 24% and 48% of the surface
 * left in — and on Espresso it lands at 13.2 / 8.8 / 4.7 against the shell.
 *
 * The light set is **not** its mirror, because the two directions are not
 * symmetric. Running the same fractions toward black gives `#010101`: a
 * heading with no trace of the palette left in it, which is both harsher than
 * the dark side's near-white and further from the colour it came from. These
 * were swept against a cream shell to land in the same band the dark set
 * reaches — about 11.9 / 8.9 / 4.6 — while keeping enough of the surface to
 * still read as warm.
 */
const TEXT_STEPS = { strong: 0.93, body: 0.76, quiet: 0.52 } as const;
const LIGHT_TEXT_STEPS = { strong: 0.84, body: 0.7, quiet: 0.52 } as const;

export interface DerivedPalette {
  /** CSS custom property name to colour, ready to set on the root element. */
  variables: Record<string, string>;
  /**
   * The accent could not be made to read against the surface.
   *
   * The one failure the app cannot fix for somebody, because fixing it would
   * mean changing the colour they picked. The panel warns instead.
   */
  accentUnreadable: boolean;
  /** The surface is light, so the room has to be lit from the other side. */
  lightGround: boolean;
}

/**
 * Build the whole custom palette from two colours.
 *
 * The surface ramp is a straight perceptual blend — nothing to measure, it is
 * the ground everything else is measured against. The text ramp and the accent
 * are then walked until they read against the *worst* shade of that ramp, so a
 * panel sitting on `shell-800` is as legible as the shell itself.
 */
export function derivePalette(
  primaryHex: string,
  secondaryHex: string,
  boost = false,
): DerivedPalette | null {
  const primary = parseHex(primaryHex);
  const secondary = parseHex(secondaryHex);
  if (!primary || !secondary) return null;

  const targets = targetsFor(boost);
  const lightGround = isLightGround(primary);

  const shellSteps = lightGround ? LIGHT_SHELL_STEPS : SHELL_STEPS;
  const shell = Object.fromEntries(
    Object.entries(shellSteps).map(([shade, amount]) => [
      shade,
      amount >= 0 ? mixOklab(primary, BLACK, amount) : mixOklab(primary, WHITE, -amount),
    ]),
  ) as Record<'600' | '700' | '800' | '900', Rgb>;

  // Text has to clear every surface it will ever sit on, not the average one:
  // panels use 800 and the well behind the platter is 900. All three go in
  // rather than one being picked as "hardest", because which is hardest depends
  // on the direction the text ends up going, and that is decided by measuring.
  const surfaces = [shell['700'], shell['800'], shell['900']];

  // Text is mixed to a fixed distance and *then* floored by measurement, which
  // is two different jobs and needs both steps.
  //
  // Starting at the surface and walking only as far as the target needs was
  // tried, and it is the accessible answer and the wrong one to look at: it
  // stops the moment it passes, so a dark custom palette got a flat grey
  // heading at exactly 7:1 where every hand-written palette here has a warm
  // near-white at 13. Readable, and visibly duller than the thing it was
  // copying.
  //
  // So the proportions come first — they are what makes a palette look like
  // this app — and the measurement only ever pushes further, never back. The
  // direction is `mostReadableOn`, so on a pale shell these mix toward black
  // instead, which is the whole repair.
  const end = mostReadableOn(surfaces);
  const textSteps = lightGround ? LIGHT_TEXT_STEPS : TEXT_STEPS;
  const tint = (amount: number) => mixOklab(primary, end, amount);
  const strong = towardReadable(surfaces, tint(textSteps.strong), targets.strong);
  const body = towardReadable(surfaces, tint(textSteps.body), targets.body);
  const quiet = towardReadable(surfaces, tint(textSteps.quiet), targets.quiet);

  const accentOk = contrastRatio(shell['700'], secondary) >= targets.accent;

  // brass-400 is the accent lifted for text use; brass-600 is the accent
  // darkened for a button with dark text on it. The old stylesheet found 85%
  // by sweeping — 80% landed at 4.3 against a 4.5 floor — and noted that
  // darkening further moves it *towards* the shell and makes things worse,
  // which is the opposite of what it looks like it should do. Measuring
  // removes the need to remember that, but the trap is worth keeping written
  // down.
  const accentText = towardReadable(surfaces, secondary, targets.body) ?? secondary;
  const onAccent = towardReadable(secondary, secondary, targets.onAccent) ?? secondary;

  const variables: Record<string, string> = {
    '--color-shell-900': toHex(shell['900']),
    '--color-shell-800': toHex(shell['800']),
    '--color-shell-700': toHex(shell['700']),
    '--color-shell-600': toHex(shell['600']),

    '--color-brass-400': toHex(accentText),
    '--color-brass-500': toHex(secondary),
    '--color-brass-600': toHex(onAccent),

    // Falling back to the best end available is the honest answer to an
    // impossible target, not a shrug: a mid-tone maroon tops out near 6.9
    // against white, so 7:1 is not available on it at any colour. That end
    // *is* the most readable text the surface can carry, and the shortfall is
    // not visible. What matters is that it was measured — the old mix could
    // land at 1.2 and had no way to know.
    '--color-cream-50': toHex(strong ?? mostReadableOn(surfaces)),
    '--color-cream-200': toHex(body ?? mostReadableOn(surfaces)),
    '--color-cream-400': toHex(quiet ?? mostReadableOn(surfaces)),
  };

  return { variables, accentUnreadable: !accentOk, lightGround };
}

/**
 * Strengthen an existing palette's text without rebuilding it.
 *
 * What the readability setting does to the five hand-written palettes. Those
 * are calibrated hex in the stylesheet and there is no reason to re-derive
 * them — only to walk the three text shades further until they clear the
 * raised targets, and leave everything else exactly as drawn.
 *
 * Takes colours already read off the document, so a palette added later gets
 * this for free rather than needing its values copied into TypeScript.
 */
export function strengthenText(
  surfaces: Rgb[],
  text: { strong: Rgb; body: Rgb; quiet: Rgb },
  boost: boolean,
): Record<string, string> {
  const targets = targetsFor(boost);
  if (surfaces.length === 0) return {};

  // Every surface, for the reason `derivePalette` passes all three: which one
  // is hardest depends on which way the text ends up going.
  const keep = (from: Rgb, target: number) => toHex(towardReadable(surfaces, from, target) ?? from);

  return {
    '--color-cream-50': keep(text.strong, targets.strong),
    '--color-cream-200': keep(text.body, targets.body),
    '--color-cream-400': keep(text.quiet, targets.quiet),
  };
}
