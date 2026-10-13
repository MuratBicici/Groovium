import { describe, expect, it } from 'vitest';
import { translate } from '@/core/i18n';
import type { TranslationKey } from '@/core/i18n';
import { CUSTOM_THEME } from '@/core/settings/themes';
import { summarise } from './categories';
import type { SettingsFacts } from './categories';

const FACTS: SettingsFacts = {
  theme: 'espresso',
  themeFromCover: false,
  scale: 1,
  visualizer: true,
  windowGlow: false,
  language: 'tr',
  drawerSide: 'right',
  spotifyReady: true,
  stationReady: false,
  version: '1.2.3',
  offered: null,
};

const tr = (key: TranslationKey, vars?: Record<string, string | number>) => translate('tr', key, vars);
const en = (key: TranslationKey, vars?: Record<string, string | number>) => translate('en', key, vars);

describe('the line under each page of Settings', () => {
  it('names the palette and the size', () => {
    expect(summarise('appearance', FACTS, tr)).toBe('Espresso · 100%');
    expect(summarise('appearance', { ...FACTS, theme: CUSTOM_THEME, scale: 1.25 }, tr)).toBe('Özel · 125%');
  });

  it('names the cover instead of the palette while the cover sets the colours', () => {
    expect(summarise('appearance', { ...FACTS, themeFromCover: true }, en)).toBe(
      'Colours from the cover · 100%',
    );
  });

  it('says which lights are on', () => {
    expect(summarise('lights', FACTS, tr)).toBe('Görselleştirici açık · Kenar ışığı kapalı');
    expect(summarise('lights', FACTS, en)).toBe('Visualiser on · Edge light off');
  });

  it('gives the language by its own name, whatever the window is in', () => {
    expect(summarise('general', FACTS, en)).toBe('Türkçe · Drawer on the right');
    expect(summarise('general', { ...FACTS, language: 'en', drawerSide: 'left' }, tr)).toBe(
      'English · Çekmece solda',
    );
  });

  it('says which services are set up', () => {
    expect(summarise('connections', FACTS, tr)).toBe('Spotify kurulu · Last.fm kurulu değil');
    expect(summarise('connections', FACTS, en)).toBe('Spotify set up · Last.fm not set up');
  });

  it('gives the version, and a newer one when there is one', () => {
    expect(summarise('about', FACTS, tr)).toBe('Sürüm 1.2.3');
    expect(summarise('about', { ...FACTS, offered: '1.2.4' }, en)).toBe('Version 1.2.3 · 1.2.4 ready');
  });
});
