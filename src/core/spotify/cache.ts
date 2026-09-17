import type { TrackMetadata } from '@/core/types';
import type { SpotifyPlaylist } from '@/core/providers/spotifyPlaylists';

/**
 * What the drawer last read from Spotify, as it is kept between launches.
 *
 * Two things. The shelf — the playlists somebody made, in Spotify's order —
 * so the drawer opens on it instead of on a spinner. And the records inside
 * the crates that were opened or played, so doing either again tomorrow does
 * not read the whole crate again first.
 *
 * Neither is trusted just for being there, and that is what most of this file
 * is. The shelf on disk is shown and then checked against Spotify straight
 * away; it is never the answer to "has this playlist changed". A crate on disk
 * is only used against a snapshot Spotify has confirmed recently — the
 * snapshot is Spotify's own answer to "has this changed", and it changes
 * whenever anything in the playlist moves — so an edit made on a phone is
 * never hidden behind yesterday's copy.
 *
 * Pure: nothing here reads a file or asks Spotify. `cacheFile.ts` does that,
 * and hands this whatever came back, which is why every read has to survive
 * a file somebody else wrote, an older version of this app wrote, or nobody
 * finished writing.
 */

/**
 * Bumped whenever the shape changes. A different version is an empty cache.
 *
 * 2: playlists carry their description and whether they are public.
 */
export const CACHE_VERSION = 2;

/**
 * How long something Spotify said is believed without asking again.
 *
 * Half an hour, for both the shelf and the snapshots it carries. The shelf used
 * to be read once per launch and never again, which for an app that lives in
 * the tray for weeks meant a playlist made on a phone did not appear until the
 * next restart. Now opening the drawer checks the first page if the last check
 * is older than this — one request, at most twice an hour, and only when the
 * drawer is actually opened.
 */
export const SHELF_FRESH_MS = 30 * 60_000;

/** How many crates are kept, most recently used first. */
export const CRATES_KEPT = 12;

/**
 * How long a crate is kept at all, however it matches.
 *
 * A matching snapshot says the list of songs is the same. It does not say
 * every song on it can still be played — a track can be withdrawn from a
 * region without the playlist changing — so a crate nobody has touched in a
 * month is read again rather than trusted.
 */
export const CRATE_KEPT_FOR_MS = 30 * 24 * 60 * 60_000;

/**
 * The records in one crate, as far as they were read.
 *
 * `cursor` is where reading stopped, or null when it reached the end. A crate
 * longer than the play cap is kept as far as the cap with the place to carry
 * on from, so opening it can show the kept part without asking and then page
 * on from Spotify.
 */
export interface CachedCrate {
  id: string;
  snapshotId: string;
  tracks: TrackMetadata[];
  cursor: string | null;
  /** When it was read. */
  at: number;
}

export interface SpotifyCache {
  version: typeof CACHE_VERSION;
  /**
   * Whose this is, when that was known at the time of writing.
   *
   * Signing out deletes the file, so this is not the main guard. It is for
   * the case that does not go through signing out: a token revoked from
   * Spotify's own settings, and a different person signing in afterwards.
   */
  account: string | null;
  shelf: SpotifyPlaylist[];
  /** Most recently used first. */
  crates: CachedCrate[];
}

export function emptyCache(account: string | null = null): SpotifyCache {
  return { version: CACHE_VERSION, account, shelf: [], crates: [] };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isString = (value: unknown): value is string => typeof value === 'string';

function isPlaylist(value: unknown): value is SpotifyPlaylist {
  return (
    isObject(value) &&
    isString(value.id) &&
    value.id.length > 0 &&
    isString(value.name) &&
    isString(value.description) &&
    typeof value.isPublic === 'boolean' &&
    isString(value.snapshotId) &&
    typeof value.trackCount === 'number' &&
    isString(value.ownerId) &&
    isString(value.ownerName) &&
    (value.coverArtUrl === undefined || isString(value.coverArtUrl))
  );
}

function isSpotifyTrack(value: unknown): value is TrackMetadata {
  return (
    isObject(value) &&
    isString(value.id) &&
    value.id.length > 0 &&
    isString(value.title) &&
    isString(value.artist) &&
    isString(value.album) &&
    typeof value.duration === 'number' &&
    value.source === 'spotify' &&
    (value.coverArtUrl === undefined || isString(value.coverArtUrl))
  );
}

/**
 * A crate read back, or nothing.
 *
 * All or nothing, unlike the shelf. A crate with one record that no longer
 * reads is not a crate with one record fewer — it is not the list the snapshot
 * describes any more, and handing it to the deck would play something that is
 * not the playlist.
 */
function readCrate(value: unknown, now: number): CachedCrate | null {
  if (!isObject(value)) return null;
  const { id, snapshotId, tracks, cursor, at } = value;
  if (!isString(id) || !isString(snapshotId) || !Array.isArray(tracks)) return null;
  if (!(cursor === null || isString(cursor))) return null;
  if (typeof at !== 'number' || now - at > CRATE_KEPT_FOR_MS) return null;
  if (!tracks.every(isSpotifyTrack)) return null;
  return { id, snapshotId, tracks, cursor, at };
}

/**
 * The file's contents, as far as they can be believed.
 *
 * Nothing that comes back is thrown. A file that will not parse, from a
 * different version, or of the wrong shape is simply no cache, and the drawer
 * asks Spotify as it always did. Playlists that do not read are dropped one
 * at a time — the rest of the shelf is still the shelf — and crates are
 * dropped whole.
 */
export function readCache(raw: string | null, now = Date.now()): SpotifyCache | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed.version !== CACHE_VERSION) return null;

  const account = isString(parsed.account) ? parsed.account : null;
  const shelf = Array.isArray(parsed.shelf) ? parsed.shelf.filter(isPlaylist) : [];
  const crates = Array.isArray(parsed.crates)
    ? parsed.crates
        .map((entry) => readCrate(entry, now))
        .filter((entry): entry is CachedCrate => entry !== null)
        .slice(0, CRATES_KEPT)
    : [];

  return { version: CACHE_VERSION, account, shelf, crates };
}

/**
 * Whether a cache belongs to somebody other than who just signed in.
 *
 * Only when both are known. A cache written while offline has no account on
 * it, and an account that could not be asked for says nothing either way —
 * neither is a reason to throw away somebody's shelf.
 */
export function belongsToSomeoneElse(cache: SpotifyCache, who: string | null): boolean {
  return cache.account !== null && who !== null && cache.account !== who;
}

export function withShelf(cache: SpotifyCache, shelf: SpotifyPlaylist[]): SpotifyCache {
  return { ...cache, shelf };
}

export function withAccount(cache: SpotifyCache, who: string | null): SpotifyCache {
  return who === null || cache.account === who ? cache : { ...cache, account: who };
}

/**
 * Keep a crate, as the most recently used.
 *
 * Replaces any older copy of the same crate rather than keeping both, and lets
 * the oldest go once there are more than `CRATES_KEPT`.
 */
export function withCrate(cache: SpotifyCache, crate: CachedCrate): SpotifyCache {
  const others = cache.crates.filter((entry) => entry.id !== crate.id);
  return { ...cache, crates: [crate, ...others].slice(0, CRATES_KEPT) };
}

/**
 * The kept records for a crate, if they are still the crate Spotify describes.
 *
 * Asked with the snapshot Spotify gave for it recently — never with one read
 * back from the file, which is the thing that would let yesterday's copy vouch
 * for itself.
 */
export function crateFor(
  cache: SpotifyCache,
  id: string,
  snapshotId: string,
  now = Date.now(),
): CachedCrate | null {
  const found = cache.crates.find((entry) => entry.id === id);
  if (!found || found.snapshotId !== snapshotId) return null;
  if (now - found.at > CRATE_KEPT_FOR_MS) return null;
  return found;
}

/**
 * The shelf to show while Spotify is being asked again.
 *
 * What has come back so far, in Spotify's order, and after it whatever was
 * kept that has not come back yet. Once the last page is in, only what came
 * back: a playlist deleted somewhere else is gone from the shelf the moment
 * the list has been read to the end, and not before, because until then its
 * absence from the pages read so far says nothing.
 */
export function shelfWhileChecking(
  fresh: SpotifyPlaylist[],
  kept: SpotifyPlaylist[],
  finished: boolean,
): SpotifyPlaylist[] {
  if (finished) return fresh;
  const seen = new Set(fresh.map((playlist) => playlist.id));
  return [...fresh, ...kept.filter((playlist) => !seen.has(playlist.id))];
}
