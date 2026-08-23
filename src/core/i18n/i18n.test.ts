import { describe, expect, it } from 'vitest';
import { en, tr, translate } from './index';

describe('translation', () => {
  it('covers every English key in Turkish', () => {
    // The fallback to English exists so a missing string degrades instead of
    // breaking. This is what stops that safety net becoming the normal state:
    // a string added to `en.ts` and forgotten in `tr.ts` fails here rather than
    // showing up as English in a Turkish window.
    const missing = Object.keys(en).filter(
      // Turkish does not inflect a noun after a number, so a `_plural` key has
      // nothing to translate into — the singular answers for every count.
      (key) => !key.endsWith('_plural') && !(key in tr),
    );
    expect(missing).toEqual([]);
  });

  it('does not carry keys English has never heard of', () => {
    const strays = Object.keys(tr).filter((key) => !(key in en));
    expect(strays).toEqual([]);
  });

  it('keeps every placeholder a translation was given', () => {
    // A translation that drops `{count}` renders a sentence missing its number,
    // which reads as finished text and is not.
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

    for (const [key, english] of Object.entries(en)) {
      const turkish = tr[key as keyof typeof en];
      if (!turkish) continue;
      expect(placeholders(turkish), `${key} keeps its placeholders`).toEqual(
        placeholders(english),
      );
    }
  });

  it('substitutes values into a template', () => {
    expect(translate('en', 'library.importing', { done: 3, total: 12 })).toBe('Adding 3 of 12');
    expect(translate('tr', 'library.importing', { done: 3, total: 12 })).toBe(
      '12 şarkıdan 3. ekleniyor',
    );
  });

  it('leaves an unknown placeholder visible rather than blank', () => {
    // A gap in a sentence looks like a design choice; `{artist}` looks like the
    // bug it is.
    expect(translate('en', 'error.startup', { oops: 'x' })).toBe('Could not start up: {message}');
  });

  it('picks the plural form only where one exists, and only above one', () => {
    expect(translate('en', 'library.confirmImport', { count: 1, size: '2 MB' })).toContain('file (');
    expect(translate('en', 'library.confirmImport', { count: 4, size: '2 MB' })).toContain(
      'files (',
    );
    // Turkish has no plural form for this, so both counts take the same string.
    expect(translate('tr', 'library.confirmImport', { count: 1, size: '2 MB' })).toBe(
      '1 dosya (2 MB) kitaplığınıza kopyalansın mı?',
    );
    expect(translate('tr', 'library.confirmImport', { count: 4, size: '2 MB' })).toBe(
      '4 dosya (2 MB) kitaplığınıza kopyalansın mı?',
    );
  });

  it('falls back to English for a key Turkish is missing', () => {
    // Proven against a real key rather than a fake one, since the fallback path
    // is a `Partial` lookup and a fake key would exercise a different branch.
    expect(translate('tr', 'library.confirmImport_plural', { count: 4, size: '2 MB' })).toBe(
      'Copy 4 files (2 MB) into your library?',
    );
  });
});
