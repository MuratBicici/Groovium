import enChangelog from '../../../CHANGELOG.md?raw';
import trChangelog from '../../../CHANGELOG.tr.md?raw';
import { APP_VERSION } from '@/core/version';
import type { Language } from '@/core/settings';
import { pickSummary, type ReleaseSummary } from './notes';

/**
 * What this build has to say for itself.
 *
 * Both changelogs are bundled at build time rather than fetched, for the reason
 * the version is: the app has to be able to answer this offline, on a machine
 * that installed the .exe by hand and will never speak to the updater at all.
 * A few kilobytes of prose against a guarantee that the text is always there
 * and always matches the build it shipped in.
 *
 * Everything that decides anything is in `./notes`, which knows nothing about
 * either file. This module is only the two of them plus the running version.
 */

const CHANGELOGS: Record<Language, string> = {
  en: enChangelog,
  tr: trChangelog,
};

/** The running version's summary, in the reader's language where there is one. */
export function summaryForThisVersion(language: Language): ReleaseSummary | null {
  return pickSummary(CHANGELOGS, APP_VERSION, language);
}

export { paragraphsOf, pickSummary, summaryFor, summaryOfNotes, versionsIn } from './notes';
export type { ReleaseSummary } from './notes';
