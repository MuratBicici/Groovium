/**
 * Reading a release's summary out of the changelog.
 *
 * `CHANGELOG.md` says of itself that each section is the text shown in the app
 * when it offers that version — plain prose, no markup. That was already true
 * of the update the app is *about to* install, which arrives as the updater's
 * notes. This is the same text for the version already running, which the
 * updater cannot supply: it hands over the notes for what is on offer and
 * discards them once the offer is gone, so nothing survives the restart that
 * installs it.
 *
 * Kept pure, and told the version rather than reading it. `vitest.config.ts` is
 * a separate config from `vite.config.ts`, and a parser that reached for
 * `APP_VERSION` itself would drag the build-time define into every test that
 * touched it.
 */

import type { Language } from '@/core/settings';

/** The bare lines that end the summary and begin the itemised part. */
const AFTER_THE_SUMMARY = ['HIGHLIGHTS', 'ALL CHANGES'];

/**
 * The summary paragraphs of one release, or null when there is no such section.
 *
 * Null rather than a guess or an empty string. A build whose version has no
 * section — a dev build, or a bump somebody wrote before the prose — should
 * say nothing at all; an empty dialog is worse than no dialog, and the caller
 * needs to be able to tell the difference without inspecting whitespace.
 *
 * The heading match mirrors the awk in `.github/workflows/release.yml`, which
 * is what cuts the same section for the GitHub release and the updater. Both
 * require the version to end at the heading rather than merely start it, so
 * that asking for 1.0.4 cannot land on 1.0.40.
 */
export function summaryFor(changelog: string, version: string): string | null {
  const lines = changelog.split(/\r?\n/);
  const opens = `## ${version}`;

  let at = lines.findIndex(
    (line) => line.startsWith(opens) && (line.length === opens.length || line[opens.length] === ' '),
  );
  if (at === -1) return null;

  const summary: string[] = [];
  for (at += 1; at < lines.length; at++) {
    const line = lines[at] as string;
    // The next release, or the point where this one stops being prose.
    if (line.startsWith('## ')) break;
    if (AFTER_THE_SUMMARY.includes(line.trim())) break;
    summary.push(line);
  }

  const text = summary.join('\n').trim();
  return text ? text : null;
}

/**
 * A summary broken into paragraphs, each one reflowable.
 *
 * The changelog is hard-wrapped at about 78 columns, which is right for a file
 * and wrong for a 340px window: rendered with the line breaks kept, every
 * source line would become its own short line and the paragraph would come out
 * ragged. So the breaks *inside* a paragraph are dropped and the blank lines
 * *between* them are what survives, leaving the browser to wrap at the width it
 * actually has.
 */
export function paragraphsOf(summary: string): string[] {
  return summary
    .split(/\n\s*\n/)
    .map((para) => para.split(/\s*\n\s*/).join(' ').trim())
    .filter((para) => para.length > 0);
}

export interface ReleaseSummary {
  text: string;
  /**
   * The language the text is actually in, which is not always the one asked
   * for. The caller writes it onto the element as `lang`, because a Turkish
   * page holding an English paragraph gets `text-transform` and screen readers
   * wrong otherwise — the same reason `WindowChrome` marks the wordmark.
   */
  language: Language;
}

/**
 * One release's summary in the reader's language, or in English failing that.
 *
 * Falls back rather than showing nothing, which is what `tr` being a `Partial`
 * of the English dictionary does in `src/core/i18n`: a translation that has not
 * been written yet should cost the reader the language, not the message.
 */
export function pickSummary(
  changelogs: Record<Language, string>,
  version: string,
  language: Language,
): ReleaseSummary | null {
  const wanted = summaryFor(changelogs[language], version);
  if (wanted) return { text: wanted, language };

  if (language !== 'en') {
    const english = summaryFor(changelogs.en, version);
    if (english) return { text: english, language: 'en' };
  }
  return null;
}

/** Every version this changelog has a section for, newest first. */
export function versionsIn(changelog: string): string[] {
  return changelog
    .split(/\r?\n/)
    .map((line) => /^## (\S+)/.exec(line))
    .filter((found): found is RegExpExecArray => found !== null)
    .map((found) => found[1] as string);
}
