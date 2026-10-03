/**
 * Finding things in what is already here: the songs on this computer, and the
 * playlists — Groovium's and Spotify's — by name.
 *
 * Nothing is asked of anybody. It is a filter over lists the app already holds,
 * so it answers on every keystroke rather than waiting for typing to settle the
 * way a search that costs a request has to.
 */

/**
 * Text as it is compared: lower case, without accents.
 *
 * Folded so that what is typed does not have to match what is printed. Nobody
 * types the accent on "Beyoncé", and on a keyboard set to another language
 * nobody types "ş" either. Every I is i first: lower-casing "I" is "ı" in
 * Turkish and "i" everywhere else, and "İ" decomposes into an i with a dot that
 * stays behind as a mark — so a title in capitals would otherwise only be found
 * by somebody who guessed which keyboard it was written on.
 */
export function fold(text: string): string {
  return text
    .replace(/[İIı]/g, 'i')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

/** The words of a query, folded. None for a query of only spaces. */
export function queryWords(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

/**
 * How well a thing matches, lower being better, or null for not at all.
 *
 * Every word has to be somewhere among the fields, in any order: "kenan
 * dogulu" finds a song whose artist is Kenan Doğulu, and so does "doğulu
 * kenan". The first field is the name. A name that starts with what was typed
 * comes first, then a name that has all of it, then anything that matched only
 * with help from the others — the artist, the album.
 */
export function matchRank(words: readonly string[], fields: readonly string[]): number | null {
  if (words.length === 0) return null;
  const folded = fields.map(fold);
  const all = folded.join(' ');
  if (!words.every((word) => all.includes(word))) return null;

  const name = folded[0] ?? '';
  if (name.startsWith(words.join(' '))) return 0;
  if (words.every((word) => name.includes(word))) return 1;
  return 2;
}

/**
 * The items that match, best first, and in their own order within a rank.
 *
 * Their own order rather than alphabetical: it is the order they are shown in
 * on the shelf, which is the order somebody already knows them in.
 */
export function findIn<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => readonly string[],
): T[] {
  const words = queryWords(query);
  if (words.length === 0) return [];
  return items
    .map((item, at) => ({ item, at, rank: matchRank(words, fields(item)) }))
    .filter((found): found is { item: T; at: number; rank: number } => found.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .map((found) => found.item);
}
