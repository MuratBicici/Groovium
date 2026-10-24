/**
 * The searches somebody made lately, to start the next one from.
 *
 * Kept in the webview's own storage rather than the settings file, as the
 * lyrics source choice is: a convenience, not a preference, and losing it
 * costs a few letters typed again. Each side of the drawer keeps its own,
 * since a word looked for on this computer is not one looked for on Spotify.
 *
 * Only a search that found something somebody chose is kept — a song played,
 * a playlist or an album opened. Every word typed on the way there is not a
 * search anybody would want offered back to them.
 */

export type SearchSide = 'local' | 'spotify';

/** As many as fit on a line or two of the empty search, and no more. */
export const KEEP = 6;

const key = (side: SearchSide) => `groovium.recentSearches.${side}`;

/** The same search however it was spaced or capitalised. */
const same = (a: string, b: string) => tidy(a).toLocaleLowerCase() === tidy(b).toLocaleLowerCase();
const tidy = (text: string) => text.trim().replace(/\s+/g, ' ');

/** The searches kept for this side, newest first. Empty when storage is missing or garbled. */
export function recentSearches(side: SearchSide): string[] {
  try {
    const raw = localStorage.getItem(key(side));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((q): q is string => typeof q === 'string' && tidy(q) !== '').slice(0, KEEP);
  } catch {
    return [];
  }
}

function write(side: SearchSide, searches: string[]): void {
  try {
    localStorage.setItem(key(side), JSON.stringify(searches));
  } catch {
    // Storage refused: the search is simply not offered next time.
  }
}

/** Keep a search at the front, moving it there if it was already kept. */
export function rememberSearch(side: SearchSide, query: string): string[] {
  const text = tidy(query);
  if (!text) return recentSearches(side);
  const kept = [text, ...recentSearches(side).filter((q) => !same(q, text))].slice(0, KEEP);
  write(side, kept);
  return kept;
}

/** Stop offering a search. */
export function forgetSearch(side: SearchSide, query: string): string[] {
  const kept = recentSearches(side).filter((q) => !same(q, query));
  write(side, kept);
  return kept;
}
