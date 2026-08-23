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

export const THEMES: readonly Theme[] = [
  { id: 'espresso', name: 'Espresso', swatch: ['#2e231b', '#c8945a'] },
  { id: 'prussian-blue', name: 'Prussian Blue', swatch: ['#1b2740', '#c9b171'] },
  { id: 'oxblood', name: 'Oxblood', swatch: ['#341c1e', '#b8834f'] },
  { id: 'verdigris', name: 'Verdigris', swatch: ['#1d2e2a', '#9fbfa8'] },
];

export function isThemeId(value: unknown): value is string {
  return typeof value === 'string' && THEMES.some((theme) => theme.id === value);
}
