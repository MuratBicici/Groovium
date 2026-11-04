/**
 * The equaliser's settings, apart from anything that draws or plays them.
 *
 * The sound itself is Rust's: see `src-tauri/src/equaliser`. Rust holds these to
 * the same limits again, since a config file can be edited by hand.
 */

/** The bands' names, an octave apart, as Rust's `BANDS` has them. */
export const EQ_BANDS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'] as const;

/** How far a band or the preamp can go either way, in decibels. */
export const EQ_MOST = 12;

/** Every band at nought. */
export const EQ_FLAT: readonly number[] = EQ_BANDS.map(() => 0);

export type EqPresetId = 'flat' | 'bass' | 'vocal' | 'vinyl' | 'bright';

/** The settings that come with the app, in the order they are offered. */
export const EQ_PRESETS: readonly { id: EqPresetId; bands: readonly number[] }[] = [
  { id: 'flat', bands: EQ_FLAT },
  { id: 'bass', bands: [8, 7, 5, 2, 0, 0, 0, 0, 0, 0] },
  { id: 'vocal', bands: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1] },
  { id: 'vinyl', bands: [3, 2, 1, 0, -1, 0, 1, 1, -1, -3] },
  { id: 'bright', bands: [-1, -1, 0, 0, 0, 1, 2, 4, 5, 6] },
];

/** One value, as a whole number of decibels within reach. Nonsense reads as nought. */
export function heldDb(value: unknown): number {
  const db = Number(value);
  if (!Number.isFinite(db)) return 0;
  return Math.max(-EQ_MOST, Math.min(EQ_MOST, Math.round(db))) + 0;
}

/** One value for each band, whatever was stored. */
export function heldBands(value: unknown): number[] {
  const given: unknown[] = Array.isArray(value) ? value : [];
  return EQ_BANDS.map((_, at) => heldDb(given[at]));
}

export const sameBands = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((db, at) => db === b[at]);

/** Which of the settings that come with the app these bands are, if any. */
export function presetOf(bands: readonly number[]): EqPresetId | null {
  return EQ_PRESETS.find((preset) => sameBands(preset.bands, bands))?.id ?? null;
}
