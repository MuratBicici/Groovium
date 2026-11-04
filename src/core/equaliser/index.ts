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

/** How many settings of their own somebody can keep, and how long a name can be. */
export const EQ_SAVED_MOST = 3;
export const EQ_NAME_MOST = 16;

/** A setting somebody kept, by the name they gave it. */
export interface EqSaved {
  name: string;
  bands: number[];
}

/** A name as it is kept: no spaces at the ends, and short enough for its button. */
export const cleanName = (name: string): string => name.trim().slice(0, EQ_NAME_MOST).trim();

const nameKey = (name: string) => cleanName(name).toLocaleLowerCase();

/** Whether a name is in use. "Gece" and "gece" are one setting, not two. */
export const isTaken = (saved: readonly EqSaved[], name: string): boolean =>
  saved.some((own) => nameKey(own.name) === nameKey(name));

/** What was stored, in the shape it should have, however it got there. */
export function heldSaved(value: unknown): EqSaved[] {
  if (!Array.isArray(value)) return [];
  // A plain list of numbers is the one unnamed setting of a build that was
  // never released. Named as that build called it, in the language it spoke.
  if (value.length > 0 && value.every((item) => typeof item === 'number')) {
    return [{ name: 'Benim ayarım', bands: heldBands(value) }];
  }
  const held: EqSaved[] = [];
  for (const item of value as { name?: unknown; bands?: unknown }[]) {
    const name = cleanName(typeof item?.name === 'string' ? item.name : '');
    if (name && !isTaken(held, name) && held.length < EQ_SAVED_MOST) {
      held.push({ name, bands: heldBands(item.bands) });
    }
  }
  return held;
}

/**
 * The list with this setting kept: over the one of that name if there is one,
 * and otherwise at the end. Unchanged if the name is empty, or there is no room.
 */
export function withSaved(saved: readonly EqSaved[], name: string, bands: readonly number[]): EqSaved[] {
  const clean = cleanName(name);
  if (!clean) return [...saved];
  if (isTaken(saved, clean)) {
    return saved.map((own) => (nameKey(own.name) === nameKey(clean) ? { name: own.name, bands: heldBands(bands) } : own));
  }
  if (saved.length >= EQ_SAVED_MOST) return [...saved];
  return [...saved, { name: clean, bands: heldBands(bands) }];
}

export const withoutSaved = (saved: readonly EqSaved[], name: string): EqSaved[] =>
  saved.filter((own) => nameKey(own.name) !== nameKey(name));
