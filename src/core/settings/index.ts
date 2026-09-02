import { isTauri } from '@/core/utils/env';

/**
 * Preferences that survive a restart.
 *
 * Written by Rust into the same `config.json` that holds the Spotify Client ID
 * and the Last.fm key, through the same read-mutate-write path — which is why
 * saving a theme cannot drop a provider's key. Kept separate from
 * `src/core/session`, which is playback state: what the record deck was doing,
 * as opposed to how someone wants the app to look.
 *
 * Same shape as `src/core/session/index.ts` and `src/platform/window.ts`: a thin
 * wrapper that becomes a no-op outside Tauri, so the browser build keeps working
 * against defaults.
 */

export type Language = 'en' | 'tr';

export interface Settings {
  /** `null` is the default palette — see `DEFAULT_THEME`. */
  theme: string | null;
  /** `null` means nothing has been chosen and the OS decides. */
  language: Language | null;
  /**
   * Independent of the OS `prefers-reduced-motion` setting rather than a mirror
   * of it. Either one being on is enough to stop the motion, so turning this on
   * cannot be undone by the OS and turning the OS one on cannot be undone here.
   */
  reduceMotion: boolean;
  alwaysOnTop: boolean;
  /**
   * Collapsed to the controls.
   *
   * Remembered because the window plugin saves position only — every launch
   * starts at the size in `tauri.conf.json`, so if this is not applied at
   * startup the window comes back full height every time.
   */
  compact: boolean;
  /**
   * The two colours a hand-rolled palette is built from.
   *
   * Kept even while a preset is selected, so switching away and back does not
   * throw the choice away.
   */
  customPrimary: string | null;
  customSecondary: string | null;
  /**
   * Raise every contrast target by a grade.
   *
   * Applies to all palettes, not only the custom one. The five hand-written
   * ones are calibrated for legibility already; this is for eyes they were not
   * calibrated for, and it only ever strengthens text — no other colour moves.
   */
  boostContrast: boolean;
  /**
   * A hairline in the accent colour around the window.
   *
   * Off by default: the shell already carries a black ring, which is what
   * separates a frameless transparent window from the desktop behind it. This
   * replaces that ring rather than adding to it.
   */
  windowBorder: boolean;
  /**
   * The last version whose "what's new" was actually shown.
   *
   * Not a preference, and the odd one out here for that reason — but this is
   * the only durable per-install store on this side, and the Rust path behind
   * it is read-mutate-write, so writing it cannot drop a provider's key. `null`
   * means nobody has been told anything yet, which is true of a first run and
   * of every install that predates this field alike; both are answered the same
   * way, by showing the summary once.
   */
  lastSeenVersion: string | null;
  /**
   * The version somebody was offered and said "later" to.
   *
   * The whole of what keeps the offer from being a nag: it is made once per
   * release, and answering it is answering it. The mark on the settings button
   * stays either way, so saying no here loses nobody the update — it only stops
   * the question being asked again about the same version.
   */
  declinedVersion: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: null,
  language: null,
  reduceMotion: false,
  alwaysOnTop: false,
  compact: false,
  customPrimary: null,
  customSecondary: null,
  boostContrast: false,
  windowBorder: false,
  lastSeenVersion: null,
  declinedVersion: null,
};

export async function loadSettings(): Promise<Settings> {
  if (!isTauri()) return DEFAULT_SETTINGS;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const stored = await invoke<Partial<Settings>>('load_settings');
    // Spread over the defaults rather than trusting the payload: a config file
    // is editable by hand, and a missing field should read as its default
    // instead of arriving as `undefined` and being written back that way.
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch (err) {
    console.warn('[settings] could not load settings', err);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Reports rather than throws.
 *
 * A preference that failed to save is worth telling someone about — they will
 * find it reset next launch — but it is not worth interrupting playback for.
 */
export async function saveSettings(settings: Settings): Promise<boolean> {
  if (!isTauri()) return true;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('save_settings', { settings });
    return true;
  } catch (err) {
    console.warn('[settings] could not save settings', err);
    return false;
  }
}
