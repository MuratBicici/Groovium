/**
 * Which lyrics source somebody chose for a song, when they chose one.
 *
 * The usual order finds the right words for nearly everything, but it cannot
 * hear them: a record timed wrongly is used as readily as one timed well, and
 * only the listener can tell. Once they have asked for the other source for a
 * song, that song keeps coming from it.
 *
 * Kept in the webview's own storage rather than the settings file. It is a
 * convenience remembered per song, not a preference, and losing it costs one
 * press; everything here tolerates that storage being missing or full.
 */

export type LyricsSource = 'lrclib' | 'netease';

const KEY = 'groovium.lyricsSource';

/** Enough songs for anyone's habits, few enough to stay small. */
const KEEP = 500;

function read(): Record<string, LyricsSource> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, LyricsSource>) : {};
  } catch {
    return {};
  }
}

/** The source chosen for this song, or null for the usual order. */
export function chosenFor(trackId: string): LyricsSource | null {
  const choice = read()[trackId];
  return choice === 'lrclib' || choice === 'netease' ? choice : null;
}

/** Remember a choice for this song. The newest are kept when there are too many. */
export function choose(trackId: string, source: LyricsSource): void {
  try {
    const all = read();
    delete all[trackId];
    all[trackId] = source;
    const ids = Object.keys(all);
    for (const id of ids.slice(0, Math.max(0, ids.length - KEEP))) delete all[id];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage refused: the choice holds for as long as the song is on.
  }
}
