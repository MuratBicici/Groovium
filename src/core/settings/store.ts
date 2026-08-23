import { create } from 'zustand';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type Language,
  type Settings,
} from '@/core/settings';
import { DEFAULT_THEME, isThemeId } from '@/core/settings/themes';

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

  if (settings.reduceMotion) {
    root.dataset.motion = 'off';
  } else {
    delete root.dataset.motion;
  }
}

export const useSettingsStore = create<SettingsStore>((set, get) => {
  /** Apply, then persist. Never called before `ready`. */
  const commit = (patch: Partial<Settings>) => {
    set(patch);
    const { theme, language, reduceMotion, alwaysOnTop, compact } = get();
    const settings = { theme, language, reduceMotion, alwaysOnTop, compact };
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
  };
});

/** The current language, readable outside React — the tray labels need it. */
export function currentLanguage(): Language {
  return useSettingsStore.getState().language ?? 'en';
}

export const useLanguage = () => useSettingsStore((s) => s.language ?? 'en');
export const useTheme = () => useSettingsStore((s) => s.theme ?? DEFAULT_THEME);
