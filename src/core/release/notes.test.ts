import { describe, expect, it } from 'vitest';
import { summaryForThisVersion } from './index';
import { paragraphsOf, pickSummary, summaryFor, versionsIn } from './notes';
import { APP_VERSION } from '@/core/version';
import enChangelog from '../../../CHANGELOG.md?raw';
import trChangelog from '../../../CHANGELOG.tr.md?raw';

const SAMPLE = [
  '# Changelog',
  '',
  'Newest first.',
  '',
  '## 1.0.40 — 2026-09-01',
  '',
  'A much later release.',
  '',
  'HIGHLIGHTS',
  '· something',
  '',
  '## 1.0.4 — 2026-08-29',
  '',
  'One line.',
  '',
  'And another paragraph that runs',
  'across two source lines.',
  '',
  'HIGHLIGHTS',
  '· not part of the summary',
  '',
  'ALL CHANGES',
  '· nor this',
  '',
  '## 1.0.3 — 2026-08-28',
  '',
  'The oldest one, with nothing after it.',
].join('\n');

describe('finding a release in the changelog', () => {
  it('takes the prose and stops at HIGHLIGHTS', () => {
    expect(summaryFor(SAMPLE, '1.0.4')).toBe(
      'One line.\n\nAnd another paragraph that runs\nacross two source lines.',
    );
  });

  it('does not mistake 1.0.40 for 1.0.4', () => {
    // The version has to end at the heading, not merely start it. Reading the
    // file top-down, 1.0.40 comes first, so a prefix match would answer with
    // the wrong release rather than fail visibly.
    expect(summaryFor(SAMPLE, '1.0.4')).not.toContain('A much later release');
    expect(summaryFor(SAMPLE, '1.0.40')).toBe('A much later release.');
  });

  it('reads to the end of the file for the oldest release', () => {
    expect(summaryFor(SAMPLE, '1.0.3')).toBe('The oldest one, with nothing after it.');
  });

  it('stops at ALL CHANGES for a release with no highlights', () => {
    const noHighlights = ['## 2.0.0 — 2026-09-02', '', 'Just prose.', '', 'ALL CHANGES', '· one'];
    expect(summaryFor(noHighlights.join('\n'), '2.0.0')).toBe('Just prose.');
  });

  it('gives null for a version with no section', () => {
    expect(summaryFor(SAMPLE, '9.9.9')).toBeNull();
  });

  it('gives null rather than an empty string for a section with no prose', () => {
    // A dialog with a heading and nothing under it is worse than no dialog, so
    // the caller has to be able to tell this apart without measuring whitespace.
    const empty = ['## 3.0.0 — 2026-09-02', '', 'HIGHLIGHTS', '· one'].join('\n');
    expect(summaryFor(empty, '3.0.0')).toBeNull();
  });

  it('survives CRLF line endings', () => {
    expect(summaryFor(SAMPLE.replace(/\n/g, '\r\n'), '1.0.3')).toBe(
      'The oldest one, with nothing after it.',
    );
  });

  it('lists the versions it holds, newest first', () => {
    expect(versionsIn(SAMPLE)).toEqual(['1.0.40', '1.0.4', '1.0.3']);
  });
});

describe('reflowing the summary', () => {
  it('joins the lines within a paragraph and keeps the paragraphs apart', () => {
    // The file is hard-wrapped for reading as a file. At 340px those breaks
    // would each become a short line of their own.
    expect(paragraphsOf('One line.\n\nAnd another paragraph that runs\nacross two source lines.')).toEqual([
      'One line.',
      'And another paragraph that runs across two source lines.',
    ]);
  });

  it('drops blank paragraphs rather than rendering empty ones', () => {
    expect(paragraphsOf('First.\n\n\n\nSecond.')).toEqual(['First.', 'Second.']);
  });
});

describe('choosing which language to answer in', () => {
  const both = {
    en: '## 1.0.4 — 2026-08-29\n\nIn English.',
    tr: '## 1.0.4 — 2026-08-29\n\nTürkçe.',
  };

  it('answers in the language asked for', () => {
    expect(pickSummary(both, '1.0.4', 'tr')).toEqual({ text: 'Türkçe.', language: 'tr' });
  });

  it('falls back to English when the translation is missing', () => {
    // Costing the reader the language rather than the message, which is what
    // `tr` being a `Partial` of the English dictionary already does in i18n.
    const untranslated = { en: both.en, tr: '## 1.0.3 — 2026-08-28\n\nEski.' };
    expect(pickSummary(untranslated, '1.0.4', 'tr')).toEqual({
      text: 'In English.',
      language: 'en',
    });
  });

  it('gives null when neither language has the release', () => {
    expect(pickSummary(both, '9.9.9', 'tr')).toBeNull();
  });
});

describe('what this build actually ships with', () => {
  it('has a section for the running version in English', () => {
    // The guard: bumping the version without writing the release fails here,
    // rather than shipping a build with nothing to say for itself. The release
    // workflow refuses the same thing, but only once the tag is pushed.
    expect(summaryFor(enChangelog, APP_VERSION)).not.toBeNull();
  });

  it('has a section for the running version in Turkish', () => {
    expect(summaryFor(trChangelog, APP_VERSION)).not.toBeNull();
  });

  it('names the same releases in both languages', () => {
    // Headings are what the parser matches on, so they have to agree exactly —
    // including the em dash and the date.
    expect(versionsIn(trChangelog)).toEqual(versionsIn(enChangelog));
  });

  it('gives the reader their own language when there is one', () => {
    expect(summaryForThisVersion('tr')).toEqual({
      text: summaryFor(trChangelog, APP_VERSION),
      language: 'tr',
    });
    expect(summaryForThisVersion('en')?.language).toBe('en');
  });
});
