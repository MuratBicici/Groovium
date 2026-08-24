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
  setSurface: (surface: { opacity?: number; blur?: number }) => void;
}

/**
 * The language to start in when nobody has chosen one.
 *
 * Consulted on a first run only. Once a choice is stored it wins, including the
 * choice to use English on a Turkish system — which is why `language: null` is
 * a distinct state from `language: 'en'` rather than a default value.
 */
/**
 * How far the surface frosts, when nobody has said.
 *
 * Not zero: raw transparency over whatever happens to be on the desktop is
 * unreadable, and someone reaching for the opacity slider is asking for
 * glass rather than for a hole.
 */
const DEFAULT_BLUR = 12;

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

  if (settings.theme === CUSTOM_THEME) {
    const primary = settings.customPrimary ?? CUSTOM_DEFAULTS.primary;
    const secondary = settings.customSecondary ?? CUSTOM_DEFAULTS.secondary;
    root.style.setProperty('--custom-primary', primary);
    root.style.setProperty('--custom-secondary', secondary);
    // The light in the room, which every palette tints to match its own. This
    // one is the only value `color-mix` cannot supply, because `DiscLight`
    // needs raw channels to mix its own alphas against.
    root.style.setProperty('--sheen', sheenFrom(primary));
  } else {
    for (const name of ['--custom-primary', '--custom-secondary', '--sheen']) {
      root.style.removeProperty(name);
    }
  }

  // The window's own surface. Written as an alpha and a blur radius rather
  // than as a colour, so a palette and the glass it is made of stay separate
  // facts: every theme reads these, and changing one does not touch the other.
  const opacity = settings.surfaceOpacity ?? 100;
  root.style.setProperty('--surface-alpha', `${opacity}%`);
  root.style.setProperty('--surface-blur', `${settings.surfaceBlur ?? DEFAULT_BLUR}px`);
  // A flag rather than a number, because `backdrop-filter` is not free: at
  // full opacity nothing behind the window is visible anyway, and leaving the
  // filter on would have the compositor sampling a backdrop nobody can see.
  if (opacity < 100) root.dataset.glass = '';
  else delete root.dataset.glass;

  if (settings.reduceMotion) {
    root.dataset.motion = 'off';
  } else {
    delete root.dataset.motion;
  }
}

/**
 * A near-white carrying a trace of the surface it will fall on.
 *
 * Plain sRGB rather than anything perceptual on purpose: this is a highlight
 * drawn at a quarter opacity or less, where the difference between colour
 * spaces is far below what anyone can see, and the alternative is pulling in a
 * colour library to compute something invisible.
 */
function sheenFrom(hex: string): string {
  const value = hex.replace('#', '');
  if (value.length !== 6) return '255 247 235';
  const channels = [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16));
  if (channels.some(Number.isNaN)) return '255 247 235';
  return channels.map((c) => Math.round(c * 0.08 + 255 * 0.92)).join(' ');
}

export const useSettingsStore = create<SettingsStore>((set, get) => {
  /** Apply, then persist. Never called before `ready`. */
  const commit = (patch: Partial<Settings>) => {
    set(patch);
    const { theme, language, reduceMotion, alwaysOnTop, compact } = get();
    const { customPrimary, customSecondary, surfaceOpacity, surfaceBlur } = get();
    const settings = {
      theme,
      language,
      reduceMotion,
      alwaysOnTop,
      compact,
      customPrimary,
      customSecondary,
      surfaceOpacity,
      surfaceBlur,
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
    setSurface: ({ opacity, blur }) =>
      commit({
        ...(opacity === undefined ? {} : { surfaceOpacity: opacity }),
        ...(blur === undefined ? {} : { surfaceBlur: blur }),
      }),
    setCustomColour: (which, colour) =>
      commit(
        which === 'primary'
          ? { customPrimary: colour, theme: CUSTOM_THEME }
          : { customSecondary: colour, theme: CUSTOM_THEME },
      ),
  };
});

/** The current language, readable outside React — the tray labels need it. */
export function currentLanguage(): Language {
  return useSettingsStore.getState().language ?? 'en';
}

export const useLanguage = () => useSettingsStore((s) => s.language ?? 'en');
export const useTheme = () => useSettingsStore((s) => s.theme ?? DEFAULT_THEME);
