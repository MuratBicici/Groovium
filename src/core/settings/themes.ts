/**
 * The palettes.
 *
 * Switching one costs nothing at runtime: Tailwind v4 emits every theme colour
 * as a custom property and every utility resolves it through `var()`, so
 * `bg-shell-700` is literally `background-color: var(--color-shell-700)`.
 * Redefining those variables under `:root[data-theme=…]` recolours the whole
 * window without a single component knowing a theme exists. The values live in
 * `styles.css`; this file is only the catalogue the picker reads.
 *
 * Named after pigments rather than categories. "Slate" and "Moss" say what
 * family a colour belongs to; "Verdigris" is a particular colour with a
 * particular history, which is the difference between a label and a name.
 * Brands were avoided on purpose — the obvious ones here are trademarks.
 *
 * Sakura is the one that is not a pigment, and it is cherry blossom at night
 * rather than in daylight: every palette here is dark, because the shadows, the
 * recessed well and the light on the record are all built against a dark
 * ground. A pale pink shell would need the whole deck relit, not a new set of
 * variables. Deep plum with blossom on it is the same colour at the hour this
 * app is usually open.
 */

export interface Theme {
  id: string;
  name: string;
  /** Two colours for the picker's swatch: the shell it paints, and its accent. */
  swatch: [string, string];
}

/**
 * The default sets no `data-theme` attribute at all, so the `@theme` block in
 * `styles.css` stands as written. That keeps one palette — the original — free
 * of any override, and makes "did the theme apply" answerable by looking at the
 * attribute rather than by comparing colours.
 */
export const DEFAULT_THEME = 'espresso';

/**
 * The palette somebody builds themselves, from two colours.
 *
 * Not in `THEMES`: it has no fixed swatch to show, because its swatch is
 * whatever was picked. The picker draws it from the stored colours instead.
 */
export const CUSTOM_THEME = 'custom';

/** What a custom palette starts from — Espresso, so the first move is an edit. */
export const CUSTOM_DEFAULTS = { primary: '#2e231b', secondary: '#c8945a' };

export const THEMES: readonly Theme[] = [
  { id: 'espresso', name: 'Espresso', swatch: ['#2e231b', '#c8945a'] },
  { id: 'prussian-blue', name: 'Prussian Blue', swatch: ['#1b2740', '#c9b171'] },
  { id: 'oxblood', name: 'Oxblood', swatch: ['#341c1e', '#b8834f'] },
  { id: 'verdigris', name: 'Verdigris', swatch: ['#1d2e2a', '#9fbfa8'] },
  { id: 'sakura', name: 'Sakura', swatch: ['#2e2136', '#e29ab1'] },
];

export function isThemeId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return value === CUSTOM_THEME || THEMES.some((theme) => theme.id === value);
}
