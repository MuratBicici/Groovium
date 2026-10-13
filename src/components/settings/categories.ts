import type { TranslationKey } from '@/core/i18n';
import type { DrawerSide, Language } from '@/core/settings';
import { CUSTOM_THEME, THEMES } from '@/core/settings/themes';

/**
 * The pages Settings is divided into, in the order the list shows them.
 *
 * Grouped by what somebody comes looking for rather than by how the settings
 * are stored: how it looks, what lights up with the music, how the window
 * behaves, what it is connected to, and what it is.
 */
export const CATEGORIES = ['appearance', 'lights', 'general', 'connections', 'about'] as const;

export type SettingsCategory = (typeof CATEGORIES)[number];

export const CATEGORY_NAME: Record<SettingsCategory, TranslationKey> = {
  appearance: 'settings.appearance',
  lights: 'settings.lights',
  general: 'settings.general',
  connections: 'settings.connections',
  about: 'settings.about',
};

/** What the list says about each page, gathered in one place. */
export interface SettingsFacts {
  theme: string;
  themeFromCover: boolean;
  scale: number;
  visualizer: boolean;
  windowGlow: boolean;
  language: Language;
  drawerSide: DrawerSide;
  spotifyReady: boolean;
  stationReady: boolean;
  version: string;
  /** A newer version on offer or already installed, if there is one. */
  offered: string | null;
}

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/**
 * The line under a page's name in the list: where it stands now, so that most
 * visits can end without opening anything.
 */
export function summarise(category: SettingsCategory, facts: SettingsFacts, t: Translate): string {
  switch (category) {
    case 'appearance': {
      // The cover overrides the theme while it is on, so that is what to name.
      const palette = facts.themeFromCover
        ? t('settings.themeFromCover')
        : facts.theme === CUSTOM_THEME
          ? t('settings.custom')
          : (THEMES.find((entry) => entry.id === facts.theme)?.name ?? '');
      // Written as the size slider writes it.
      return `${palette} · ${Math.round(facts.scale * 100)}%`;
    }
    case 'lights': {
      const state = (on: boolean) => t(on ? 'settings.on' : 'settings.off');
      return t('settings.summary.lights', {
        visualizer: state(facts.visualizer),
        glow: state(facts.windowGlow),
      });
    }
    case 'general': {
      // Each language by its own name, as the buttons that choose it are.
      const language = facts.language === 'tr' ? 'Türkçe' : 'English';
      const drawer = t(
        facts.drawerSide === 'left' ? 'settings.summary.drawerLeft' : 'settings.summary.drawerRight',
      );
      return `${language} · ${drawer}`;
    }
    case 'connections': {
      const state = (name: string, ready: boolean) =>
        t(ready ? 'settings.summary.ready' : 'settings.summary.notReady', { name });
      return `${state(t('panel.spotify'), facts.spotifyReady)} · ${state('Last.fm', facts.stationReady)}`;
    }
    case 'about': {
      const version = t('settings.version', { version: facts.version });
      return facts.offered
        ? `${version} · ${t('settings.summary.update', { version: facts.offered })}`
        : version;
    }
  }
}
