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
   * How solid the window's surface is, 0-100.
   *
   * A property of the window rather than of a palette: the frame is
   * undecorated and transparent, so this is the shell's own background giving
   * way to whatever is behind the widget. Every theme can be glass.
   *
   * `null` is fully opaque — what every build before this one was, and what
   * an untouched installation stays.
   */
  surfaceOpacity: number | null;
  /** How far the surface frosts what is behind it, in px. Idle at full opacity. */
  surfaceBlur: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: null,
  language: null,
  reduceMotion: false,
  alwaysOnTop: false,
  compact: false,
  customPrimary: null,
  customSecondary: null,
  surfaceOpacity: null,
  surfaceBlur: null,
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
