import { isTauri } from '@/core/utils/env';
import { NOTCHES } from '@/core/visualizer';

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
   * The Spotify drawer, pulled out beside the player.
   *
   * Remembered for the reason `compact` is: the window plugin saves position
   * only, so every launch starts at the width in `tauri.conf.json` and a drawer
   * that was open would close itself overnight.
   */
  drawerOpen: boolean;
  /**
   * Which side of the player the drawer comes out of.
   *
   * The window grows sideways to make room, and which edge stays still is the
   * whole of the difference: opening right moves the right edge, opening left
   * moves the left one so the player stays where the eye left it. Worth having
   * because a widget parked near the right edge of a screen has nowhere to grow
   * to the right.
   */
  drawerSide: DrawerSide;
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
   * Bars behind the deck, moving to what this app is playing.
   *
   * Fed by listening to this app's own webview — where both Spotify and the
   * local player make their sound — and to nothing else on the machine.
   */
  visualizer: boolean;
  /**
   * Light around the window's edge, climbing with how loud the music is.
   *
   * Fed by the same frames as the visualiser, read as one number rather than
   * two dozen. Off unless asked for: the blocks are behind the deck where an
   * ornament belongs, and this is on the window's own border — which starting
   * to move on its own after an update would read as the app changing shape
   * rather than as something added to it.
   */
  windowGlow: boolean;
  /**
   * Take the palette from the cover of whatever is playing.
   *
   * The two colours come out of the artwork the same way a person picks them
   * in the colour settings, and the same machinery builds the ramp — so the
   * text stays readable by the route it always did. What a cover cannot supply
   * is refused rather than invented: a sleeve with no colour in it leaves the
   * chosen theme alone.
   *
   * Kept apart from `theme` and the two custom colours on purpose. This is a
   * layer over whatever was chosen, not a replacement for it, so switching it
   * off puts back exactly what was there.
   */
  themeFromCover: boolean;
  /**
   * How the edge light is tuned: a notch from -4 to 4 each, nought in the
   * middle.
   *
   * Nought is not an arbitrary default: it is what these were before there was
   * anything to move them with, so a config file from before they existed and
   * a slider nobody has touched are the same thing. `strength` is how wide and
   * how hard the lights burn, `sensitivity` how readily the music sets one
   * off, `speed` how fast they climb.
   */
  glowStrength: number;
  glowSensitivity: number;
  glowSpeed: number;
  glowFlash: number;
  glowFlare: number;
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

export type DrawerSide = 'left' | 'right';

/** Which of the edge light's dials the settings panel is moving. */
export const GLOW_KNOBS = [
  'glowStrength',
  'glowSensitivity',
  'glowSpeed',
  'glowFlash',
  'glowFlare',
] as const;

export type GlowKnob = (typeof GLOW_KNOBS)[number];

export const DEFAULT_SETTINGS: Settings = {
  theme: null,
  language: null,
  reduceMotion: false,
  alwaysOnTop: false,
  compact: false,
  drawerOpen: false,
  drawerSide: 'right',
  customPrimary: null,
  customSecondary: null,
  boostContrast: false,
  windowBorder: false,
  visualizer: true,
  windowGlow: false,
  themeFromCover: false,
  glowStrength: 0,
  glowSensitivity: 0,
  glowSpeed: 0,
  glowFlash: 0,
  glowFlare: 0,
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
    const settings = { ...DEFAULT_SETTINGS, ...stored };
    // And the same argument one step further for the one field with a shape
    // narrower than its type. `drawerSide` decides which way the window grows;
    // a word nobody recognises would leave it growing in neither.
    if (settings.drawerSide !== 'left') settings.drawerSide = 'right';
    // And the sliders, which are numbers somebody could put anything in — a
    // fraction among them, since these were fractions for one afternoon.
    for (const knob of GLOW_KNOBS) {
      const held = Math.round(Number(settings[knob]));
      settings[knob] = Number.isFinite(held) ? Math.max(-NOTCHES, Math.min(NOTCHES, held)) : 0;
    }
    return settings;
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
