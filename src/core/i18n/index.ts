import { useCallback } from 'react';
import { currentLanguage, useLanguage } from '@/core/settings/store';
import type { Language } from '@/core/settings';
import { en } from './en';
import { tr } from './tr';

/**
 * Translation, without a library.
 *
 * `react-i18next` is forty kilobytes and a plugin system; this app has four
 * runtime dependencies and one window measuring 340×480. What is actually
 * needed is a lookup, a substitution and a plural rule, which is what this is.
 *
 * `en` is the source of truth in both senses: it holds every string, and its
 * type defines what a valid key is. `tr` is a `Partial` of it, so a missing
 * translation falls back to English rather than rendering a key — a half
 * translated build is ugly, but a build showing `library.empty.title` is
 * broken. The test in `i18n.test.ts` is what stops the half translated one
 * shipping quietly.
 */

export type TranslationKey = keyof typeof en;

type Vars = Record<string, string | number>;

const DICTIONARIES: Record<Language, Partial<Record<TranslationKey, string>>> = {
  en,
  tr,
};

/**
 * Pick a string out of one dictionary, plural form included.
 *
 * The plural decision has to be made **inside** the dictionary being read, not
 * against English. English wants "1 file" and "3 files"; Turkish wants "3
 * dosya", because the number already says how many and the noun does not repeat
 * it. Deciding from English and then looking the result up in Turkish is how
 * this first went wrong: `tr` has no `_plural` key, so every count above one
 * fell through to the English plural — a Turkish window counting in English.
 *
 * A language that needs no plural simply provides no `_plural` key, and its
 * singular answers for every count.
 */
function pick(
  dictionary: Partial<Record<TranslationKey, string>>,
  key: TranslationKey,
  vars: Vars | undefined,
): string | undefined {
  if (vars && typeof vars.count === 'number' && vars.count !== 1) {
    const plural = dictionary[`${key}_plural` as TranslationKey];
    if (plural) return plural;
  }
  return dictionary[key];
}

export function translate(language: Language, key: TranslationKey, vars?: Vars): string {
  const dictionary = DICTIONARIES[language] ?? en;
  const template = pick(dictionary, key, vars) ?? pick(en, key, vars) ?? key;

  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    // An unknown placeholder is left as written rather than blanked, so a typo
    // in a key shows up as `{cont}` on screen instead of as a silent gap.
    name in vars ? String(vars[name]) : whole,
  );
}

/**
 * The hook every component uses.
 *
 * Subscribes to the language, so switching it re-renders whatever is showing
 * text — which is the whole tree, and is exactly what should happen.
 */
/**
 * The same lookup for code that is not a component — the store's errors and the
 * tray's labels. Reads the language at call time rather than subscribing, which
 * is right for both: an error is written once when it happens, and the tray is
 * rebuilt explicitly when the language changes.
 */
export function say(key: TranslationKey, vars?: Vars): string {
  return translate(currentLanguage(), key, vars);
}

export function useT(): (key: TranslationKey, vars?: Vars) => string {
  const language = useLanguage();
  return useCallback((key: TranslationKey, vars?: Vars) => translate(language, key, vars), [
    language,
  ]);
}

export { en, tr };
