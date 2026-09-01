import { create } from 'zustand';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type Language,
  type Settings,
} from '@/core/settings';
import {
  CUSTOM_DEFAULTS,
  CUSTOM_THEME,
  DEFAULT_THEME,
  isThemeId,
} from '@/core/settings/themes';
import { parseCssColour, toHex, type Rgb } from '@/core/utils/colour';
import { derivePalette, onAccentFor, strengthenText } from '@/core/utils/contrast';

/**
 * Preferences, in their own store.
 *
 * Not part of `playerStore`, which is nine hundred lines about what is playing.
 * A theme has nothing to do with playback, and the two have different lifetimes:
 * these load once at startup and change when someone opens a panel, rather than
 * four times a second.
 *
 * The window setting is held here but **applied** by `WindowChrome`. `src/core`
 * is deliberately unaware that there is a window at all — that boundary is why
 * `src/platform/window.ts` exists — so the store owns the value and the
 * component owns the call.
 */

interface SettingsStore extends Settings {
  /** False until disk has been read, so nothing saves over what is on it. */
  ready: boolean;
  initialize: () => Promise<void>;
  setTheme: (theme: string) => void;
  setLanguage: (language: Language) => void;
  setReduceMotion: (reduce: boolean) => void;
  setAlwaysOnTop: (onTop: boolean) => void;
  setCompact: (compact: boolean) => void;
  setCustomColour: (which: 'primary' | 'secondary', colour: string) => void;
  setBoostContrast: (boost: boolean) => void;
  setWindowBorder: (on: boolean) => void;
}

/**
 * The language to start in when nobody has chosen one.
 *
 * Consulted on a first run only. Once a choice is stored it wins, including the
 * choice to use English on a Turkish system — which is why `language: null` is
 * a distinct state from `language: 'en'` rather than a default value.
 */
function systemLanguage(): Language {
  if (typeof navigator === 'undefined') return 'en';
  return navigator.language.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

/**
 * Push what the document itself needs to know onto the document.
 *
 * The default palette sets no attribute, so `@theme` in `styles.css` stands
 * unoverridden — one palette that is the real one rather than four that are all
 * exceptions.
 *
 * `lang` is here because `text-transform: uppercase` is language-sensitive and
 * this app uppercases every section heading. Turkish has two i's: dotted and
 * dotless, and they stay distinct in capitals. With the document still claiming
 * English, "Dil" came out as "DIL" — the wrong letter — and "Kitaplık" as
 * "KITAPLIK". Telling the document what language it is in fixes both, and every
 * other case rule that comes with a language, without a single special case in
 * the components.
 */
function applyToDocument(settings: Settings): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  root.lang = settings.language ?? 'en';
  if (settings.theme && settings.theme !== DEFAULT_THEME && isThemeId(settings.theme)) {
    root.dataset.theme = settings.theme;
  } else {
    delete root.dataset.theme;
  }

  // Anything this function set last time. Cleared before the new palette is
  // written so a switch away from a custom theme cannot leave one shade of the
  // old one behind — the bug a growing list of property names invites.
  for (const name of applied) root.style.removeProperty(name);
  applied.clear();

  const set = (name: string, value: string) => {
    root.style.setProperty(name, value);
    applied.add(name);
  };

  let lightGround = false;
  let faintAccent = false;

  if (settings.theme === CUSTOM_THEME) {
    const primary = settings.customPrimary ?? CUSTOM_DEFAULTS.primary;
    const secondary = settings.customSecondary ?? CUSTOM_DEFAULTS.secondary;

    // The whole ramp is derived here rather than by `color-mix()` in the
    // stylesheet. Not a preference: CSS cannot measure what it produced, and
    // what it produced for a light surface was light text on a light ground.
    const derived = derivePalette(primary, secondary, settings.boostContrast);
    if (derived) {
      for (const [name, value] of Object.entries(derived.variables)) set(name, value);
      lightGround = derived.lightGround;
      faintAccent = derived.accentUnreadable;
    }
    // The light in the room, which every palette tints to match its own.
    // `DiscLight` needs raw channels to mix its own alphas against, so this is
    // the one value that cannot be a colour.
    set('--sheen', sheenFrom(primary, lightGround));
  } else {
    // The five hand-written palettes are calibrated hex in the stylesheet, so
    // there is nothing to rebuild. Two things still have to be computed from
    // them, and both are read back off the document rather than copied into
    // TypeScript, so a palette added later gets them without being told.
    const seen = readPalette(root);
    if (seen) {
      // What reads on an accent-filled button. Every palette needs this, not
      // just a custom one — the five built-in accents are all light, but a
      // hard-coded dark text colour is a guess that happens to be right rather
      // than an answer.
      set('--color-on-accent', toHex(onAccentFor(seen.accents, settings.boostContrast)));

      if (settings.boostContrast) {
        for (const [name, value] of Object.entries(
          strengthenText(seen.surfaces, seen.text, true),
        )) {
          set(name, value);
        }
      }
    }
  }

  if (faintAccent) {
    root.dataset.accent = 'faint';
  } else {
    delete root.dataset.accent;
  }

  if (lightGround) {
    root.dataset.ground = 'light';
  } else {
    delete root.dataset.ground;
  }

  if (settings.windowBorder) {
    root.dataset.border = 'on';
  } else {
    delete root.dataset.border;
  }

  if (settings.reduceMotion) {
    root.dataset.motion = 'off';
  } else {
    delete root.dataset.motion;
  }
}

/**
 * Property names this module has written onto the root element.
 *
 * Module-level rather than recomputed: the set of names changed when the custom
 * ramp moved out of the stylesheet, and a hard-coded list of what to clean up
 * is a list that goes stale silently — leaving one variable from the previous
 * theme behind, which reads as a palette that half-applied.
 */
const applied = new Set<string>();

/**
 * The palette as the document currently resolves it.
 *
 * Returns null outside a browser, and whenever a value comes back empty —
 * which is what happens if these variables are ever renamed. Better to leave
 * the palette untouched than to strengthen text against a colour of `''`.
 */
function readPalette(root: HTMLElement): {
  surfaces: Rgb[];
  accents: Rgb[];
  text: { strong: Rgb; body: Rgb; quiet: Rgb };
} | null {
  if (typeof getComputedStyle !== 'function') return null;
  const styles = getComputedStyle(root);
  const read = (name: string): Rgb | null => {
    const value = styles.getPropertyValue(name).trim();
    // `parseCssColour`, not `parseHex`: the palette variables are registered
    // with `@property` so they can animate, and a registered colour comes back
    // re-serialised as `rgb(...)` rather than as the hex that was written.
    return value ? parseCssColour(value) : null;
  };

  const surfaces = ['--color-shell-700', '--color-shell-800', '--color-shell-900'].map(read);
  // 600 first: it is the darker of the two a button fills with, so it leads the
  // list `onAccentFor` tints from.
  const accents = ['--color-brass-600', '--color-brass-500'].map(read);
  const strong = read('--color-cream-50');
  const body = read('--color-cream-200');
  const quiet = read('--color-cream-400');

  if (surfaces.some((s) => s === null) || accents.some((a) => a === null)) return null;
  if (!strong || !body || !quiet) return null;
  return {
    surfaces: surfaces as Rgb[],
    accents: accents as Rgb[],
    text: { strong, body, quiet },
  };
}

/**
 * The light in the room, carrying a trace of the surface it will fall on.
 *
 * Plain sRGB rather than anything perceptual on purpose: this is a highlight
 * drawn at a quarter opacity or less, where the difference between colour
 * spaces is far below what anyone can see, and the alternative is computing
 * something invisible.
 *
 * On a light surface it inverts. The deck is lit from above by something
 * brighter than the shell, and on a pale shell nothing is brighter — a
 * near-white highlight over near-white is not a highlight. There the same
 * gradients have to read as shadow instead, so this returns a near-black
 * tinted the same way.
 */
function sheenFrom(hex: string, lightGround: boolean): string {
  const fallback = lightGround ? '20 16 12' : '255 247 235';
  const value = hex.replace('#', '');
  if (value.length !== 6) return fallback;
  const channels = [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16));
  if (channels.some(Number.isNaN)) return fallback;

  const towards = lightGround ? 0 : 255;
  return channels.map((c) => Math.round(c * 0.08 + towards * 0.92)).join(' ');
}

export const useSettingsStore = create<SettingsStore>((set, get) => {
  /** Apply, then persist. Never called before `ready`. */
  const commit = (patch: Partial<Settings>) => {
    set(patch);
    const { theme, language, reduceMotion, alwaysOnTop, compact } = get();
    const { customPrimary, customSecondary, boostContrast, windowBorder } = get();
    const settings = {
      theme,
      language,
      reduceMotion,
      alwaysOnTop,
      compact,
      customPrimary,
      customSecondary,
      boostContrast,
      windowBorder,
    };
    applyToDocument(settings);
    void saveSettings(settings);
  };

  return {
    ...DEFAULT_SETTINGS,
    ready: false,

    async initialize() {
      if (get().ready) return;

      const stored = await loadSettings();
      const settings: Settings = {
        ...stored,
        language: stored.language ?? systemLanguage(),
      };
      applyToDocument(settings);
      set({ ...settings, ready: true });
    },

    setTheme: (theme) => commit({ theme }),
    setLanguage: (language) => commit({ language }),
    setReduceMotion: (reduceMotion) => commit({ reduceMotion }),
    setAlwaysOnTop: (alwaysOnTop) => commit({ alwaysOnTop }),
    setCompact: (compact) => commit({ compact }),
    setCustomColour: (which, colour) =>
      commit(
        which === 'primary'
          ? { customPrimary: colour, theme: CUSTOM_THEME }
          : { customSecondary: colour, theme: CUSTOM_THEME },
      ),
    setBoostContrast: (boostContrast) => commit({ boostContrast }),
    setWindowBorder: (windowBorder) => commit({ windowBorder }),
  };
});

/** The current language, readable outside React — the tray labels need it. */
export function currentLanguage(): Language {
  return useSettingsStore.getState().language ?? 'en';
}

export const useLanguage = () => useSettingsStore((s) => s.language ?? 'en');
export const useTheme = () => useSettingsStore((s) => s.theme ?? DEFAULT_THEME);
