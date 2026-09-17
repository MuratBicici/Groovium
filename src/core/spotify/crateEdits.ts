import type { CrateEntry } from '@/core/providers/spotifyPlaylists';

/**
 * What an edit does to the records in an open crate, before Spotify has said so.
 *
 * Edits show at once and are sent afterwards, so the crate on screen has to be
 * exactly what the playlist will be once Spotify agrees — including where each
 * record sits in the playlist, which is not where it sits on screen (see
 * `CrateEntry`). Get a position wrong here and the next move is aimed at the
 * wrong song, silently, because Spotify does whatever it is asked.
 *
 * Pure, and kept apart from the store for that reason: every rule here is
 * arithmetic with an off-by-one waiting in it.
 */

/**
 * Take every copy of a song out.
 *
 * Every copy, because that is what Spotify does: removal is by URI. Each record
 * after a removed one moves up by the number of removed records in front of it.
 */
export function withoutSong(entries: CrateEntry[], uri: string): CrateEntry[] {
  const gone = entries.filter((entry) => entry.track.id === uri).map((entry) => entry.position);
  if (gone.length === 0) return entries;
  return entries
    .filter((entry) => entry.track.id !== uri)
    .map((entry) => {
      const before = gone.filter((position) => position < entry.position).length;
      return before === 0 ? entry : { ...entry, position: entry.position - before };
    });
}

/** How many copies of a song a crate holds — what removing it takes out. */
export function copiesOf(entries: CrateEntry[], uri: string): number {
  return entries.filter((entry) => entry.track.id === uri).length;
}

/**
 * The request that moves the record on screen at `from` to screen index `to`.
 *
 * In playlist positions, as Spotify wants them: `rangeStart` is where the
 * record is, `insertBefore` is the position of the record it is to end up in
 * front of, measured before the move. Moving to the very end is in front of
 * nothing, and that is one past the last record on screen.
 *
 * Null when nothing would move.
 */
export function moveRequest(
  entries: CrateEntry[],
  from: number,
  to: number,
): { rangeStart: number; insertBefore: number } | null {
  const moving = entries[from];
  if (!moving || to < 0 || to >= entries.length || from === to) return null;
  const rest = entries.filter((_, at) => at !== from);
  const after = rest[to];
  const last = entries[entries.length - 1];
  const insertBefore = after ? after.position : (last?.position ?? moving.position) + 1;
  return { rangeStart: moving.position, insertBefore };
}

/**
 * The crate after that move, with every position where Spotify will put it.
 *
 * Positions are recomputed from the move as Spotify applies it rather than
 * renumbered from the screen: records Spotify cannot play are not on screen,
 * still occupy positions, and do not move.
 */
export function withMove(entries: CrateEntry[], from: number, to: number): CrateEntry[] {
  const request = moveRequest(entries, from, to);
  const moving = entries[from];
  if (!request || !moving) return entries;
  const { rangeStart, insertBefore } = request;
  // Where the record lands, counted after it has been taken out.
  const landing = insertBefore > rangeStart ? insertBefore - 1 : insertBefore;

  const shifted = (position: number): number => {
    const without = position > rangeStart ? position - 1 : position;
    return without >= landing ? without + 1 : without;
  };

  const rest = entries
    .filter((_, at) => at !== from)
    .map((entry) => ({ ...entry, position: shifted(entry.position) }));
  rest.splice(to, 0, { ...moving, position: landing });
  return rest;
}

/**
 * A song added at the end.
 *
 * `trackCount` is Spotify's count of everything in the playlist, playable or
 * not, which is exactly the position the next song takes.
 */
export function withSongAdded(
  entries: CrateEntry[],
  entry: Omit<CrateEntry, 'position'>,
  trackCount: number,
): CrateEntry[] {
  return [...entries, { ...entry, position: trackCount }];
}
