import { luminance, mixOklab, parseHex, shiftLightness, toHex, type Rgb } from './colour';

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
}

export const NORMAL_TARGETS: Targets = {
  strong: 7,
  body: 4.5,
  quiet: 3,
};

/**
 * Two floors that `boost` deliberately cannot reach.
 *
 * Kept out of `Targets` rather than left in it and not raised. They govern the
 * accent — whether it stands out from the surface, and what reads on top of it
 * — and the readability setting must not move the palette. Having no boosted
 * value to reach for makes that structural instead of something to remember:
 * the previous release *did* raise these, and raising them changed the accent.
 */
export const ACCENT_VISIBLE = 3;
export const ON_ACCENT_TARGET = 4.5;

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
};

export function targetsFor(boost: boolean): Targets {
  return boost ? BOOSTED_TARGETS : NORMAL_TARGETS;
}

/**
 * How far each shade of the surface sits from the colour it was given.
 *
 * Two different operations, because they model two different things, and the
 * five hand-written palettes agree: **a recess is mixed toward black** and a
 * **raised surface is lifted in lightness**. Shadow on a coloured material
 * absorbs its chroma along with its light; a highlight does not. Swept against
 * those palettes, mixing reproduces their 800 and 900 within three units per
 * channel while a lightness shift is four times further off — and for 600 it is
 * the other way round.
 *
 * **The direction never flips**, on any ground. These shades encode depth, not
 * theme: 900 paints the well behind the platter and the inside of every input,
 * and a recess lighter than what surrounds it reads as something raised. Only
 * text changes which way it goes.
 *
 * The light steps are far shorter. A third of the way to black from a near-white
 * shell is a mid grey, which is not a recess but a hole; light interfaces
 * separate their depths by a few percent and let the shadow do the rest.
 */
const SHELL_SHADE = { 900: 0.33, 800: 0.175 } as const;
const LIGHT_SHELL_SHADE = { 900: 0.09, 800: 0.045 } as const;

/** How far the raised shade of the surface is lifted, in Oklab lightness. */
const SHELL_LIFT = 0.07;
const LIGHT_SHELL_LIFT = 0.03;

/**
 * The accent's two other shades, as lightness shifts.
 *
 * **Not contrast walks.** They used to be, and that is the fault this release
 * exists for: `brass-600` is a *fill* — the play button, the record label, the
 * tonearm, every panel button — and it was being derived as "a colour with
 * 4.5:1 against the accent", which is the definition of a text colour. Somebody
 * choosing a dark blue got a pale blue play button; a light yellow gave a dark
 * olive one. The colour they picked was not the colour they saw.
 *
 * Swept against the five hand-written palettes, a lightness shift reproduces
 * what they do by hand within a couple of units per channel, and holds the
 * chroma that mixing toward white throws away.
 */
const ACCENT_LIFT = 0.085;
const ACCENT_DROP = 0.115;

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

/**
 * What *increase readability* does, and the whole of it.
 *
 * Text and icons go to the pure end instead of carrying a trace of the surface.
 * No palette colour moves — not the surface, not the accent, not one of their
 * shades. The previous release raised contrast targets across the board and so
 * changed the accent too, which is exactly the complaint this fixes.
 */
const BOOST_TEXT_STEPS = { strong: 1, body: 1, quiet: 0.88 } as const;

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
 * How visible the hairline around a recess has to be.
 *
 * Measured off the five hand-written palettes rather than chosen: their
 * `shell-600` rings sit between 1.34 and 1.73 against the surfaces they
 * separate. This app draws a very soft edge and lets the inset shadow do the
 * work, and 1.35 is the floor that keeps every one of them exactly as drawn.
 *
 * The boosted value is WCAG's 3:1 minimum for the boundary of a user interface
 * component. An edge is drawn *over* a surface rather than being one of the
 * palette's own colours, so raising it is the readability setting doing its
 * job, not it reaching for the palette again.
 */
export const EDGE_VISIBLE = 1.35;
export const EDGE_BOOSTED = 3;

/**
 * A hairline that can actually be seen against what it separates.
 *
 * Every cue that says "this is an input" is darker than its surroundings — the
 * fill is `shell-900`, the inset shadow is black — and on a very dark surface
 * there is no darker. A lightness step from a near-black colour barely moves,
 * so the `shell-600` ring these used to take fell to 1.12:1 against its own
 * fill and 1.01:1 at pure black. The box stopped existing.
 *
 * So the edge is measured instead of stepped, and goes lighter when there is
 * nowhere darker to go. On a palette where the ring already reads it is handed
 * straight back, which is why the five built-in ones are untouched.
 *
 * Measured against the recess fill and the panel behind it — **not** against
 * `shell-700`. That one is the shade `shell-600` is derived from, one step
 * away by design, and the five hand-written palettes sit at 1.19 to 1.34
 * against it. Demanding a visible edge there is demanding the ramp not be a
 * ramp: it moved every built-in palette, Espresso by twenty-six units a
 * channel. Excluding it moves four of the five not at all.
 */
export function edgeFor(surfaces: Rgb[], from: Rgb, boost = false): Rgb {
  if (surfaces.length === 0) return from;
  const floor = boost ? EDGE_BOOSTED : EDGE_VISIBLE;
  return towardReadable(surfaces, from, floor) ?? mostReadableOn(surfaces);
}

/**
 * The colour for text and icons drawn **on** an accent fill.
 *
 * Near-white or near-black, whichever reads across every accent shade a fill
 * can use — the buttons hover between 500 and 600, so one answer has to serve
 * both. Tinted with the accent unless `boost` is on, in which case it goes to
 * the pure end.
 *
 * Exported because the five hand-written palettes need it too, and their
 * colours live in the stylesheet rather than here: `applyToDocument` reads
 * theirs back off the document and calls this.
 *
 * This is the whole of what adapts to somebody's accent. The fill itself is
 * their colour, untouched; only what is drawn over it moves.
 */
export function onAccentFor(accentShades: Rgb[], boost = false): Rgb {
  if (accentShades.length === 0) return WHITE;

  const end = mostReadableOn(accentShades);
  if (boost) return end;

  // A trace of the accent left in it, the same way text on the surface carries
  // a trace of the surface. Floored afterwards, so the tint never costs the
  // legibility it is decorating.
  const tinted = mixOklab(accentShades[0] as Rgb, end, 0.9);
  return towardReadable(accentShades, tinted, ON_ACCENT_TARGET) ?? end;
}

/**
 * Build the whole custom palette from two colours.
 *
 * **Nothing here changes either colour somebody picked.** The surface and the
 * accent come back exactly as given, and their other shades are the same colour
 * at a different lightness — a recess mixed toward black, everything else
 * shifted in lightness so the chroma survives.
 *
 * The only thing measured into a different colour is text, which was never one
 * of the two: it goes toward whichever end reads on the surfaces it will sit
 * on, and `--color-on-accent` does the same over the accent.
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

  const shade = lightGround ? LIGHT_SHELL_SHADE : SHELL_SHADE;
  const lift = lightGround ? LIGHT_SHELL_LIFT : SHELL_LIFT;
  const shell = {
    900: mixOklab(primary, BLACK, shade[900]),
    800: mixOklab(primary, BLACK, shade[800]),
    700: primary,
    600: shiftLightness(primary, lift),
  };

  // Text has to clear every surface it will ever sit on, not the average one:
  // panels use 800 and the well behind the platter is 900. All three go in
  // rather than one being picked as "hardest", because which is hardest depends
  // on the direction the text ends up going, and that is decided by measuring.
  const surfaces = [shell[700], shell[800], shell[900]];

  // Text is mixed to a fixed distance and *then* floored by measurement, which
  // is two different jobs and needs both steps. The proportions are what makes
  // a palette look like this app; the measurement only ever pushes further,
  // never back. With `boost` on they go to the pure end instead — that setting
  // adjusts what is drawn over a colour, never the colour.
  const end = mostReadableOn(surfaces);
  const textSteps = boost ? BOOST_TEXT_STEPS : lightGround ? LIGHT_TEXT_STEPS : TEXT_STEPS;
  const tint = (amount: number) => mixOklab(primary, end, amount);
  const strong = towardReadable(surfaces, tint(textSteps.strong), targets.strong);
  const body = towardReadable(surfaces, tint(textSteps.body), targets.body);
  const quiet = towardReadable(surfaces, tint(textSteps.quiet), targets.quiet);

  // The accent's own shades. No contrast anywhere in these three lines, which
  // is the point: whatever was chosen is what gets painted.
  const accent = {
    400: shiftLightness(secondary, ACCENT_LIFT),
    500: secondary,
    600: shiftLightness(secondary, -ACCENT_DROP),
  };

  // Reported, never repaired. Repairing it would mean overruling the colour
  // somebody picked, which is the thing this release exists to stop.
  const accentOk = contrastRatio(shell[700], secondary) >= ACCENT_VISIBLE;

  const variables: Record<string, string> = {
    '--color-shell-900': toHex(shell[900]),
    '--color-shell-800': toHex(shell[800]),
    '--color-shell-700': toHex(shell[700]),
    '--color-shell-600': toHex(shell[600]),

    '--color-brass-400': toHex(accent[400]),
    '--color-brass-500': toHex(accent[500]),
    '--color-brass-600': toHex(accent[600]),

    // Falling back to the best end available is the honest answer to an
    // impossible target, not a shrug: a mid-tone maroon tops out near 6.9
    // against white, so 7:1 is not available on it at any colour. That end
    // *is* the most readable text the surface can carry, and the shortfall is
    // not visible. What matters is that it was measured — the old mix could
    // land at 1.2 and had no way to know.
    '--color-cream-50': toHex(strong ?? end),
    '--color-cream-200': toHex(body ?? end),
    '--color-cream-400': toHex(quiet ?? end),

    '--color-on-accent': toHex(onAccentFor([accent[600], accent[500]], boost)),

    // The hairline around every recess and sheet. Derived from `shell-600`,
    // which is what it used to be outright, and lifted only when that has
    // stopped being visible against what it separates.
    '--color-edge': toHex(edgeFor([shell[900], shell[800]], shell[600], boost)),
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
