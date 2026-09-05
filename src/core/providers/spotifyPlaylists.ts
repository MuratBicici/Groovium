import type { TrackMetadata } from '@/core/types';
import { account } from '@/core/security/spotifyAuth';
import {
  pickCover,
  request,
  SpotifyError,
  toTrackMetadata,
  type ApiImage,
  type ApiTrack,
} from './spotifyApi';

/**
 * Someone's own Spotify playlists, and what is in them.
 *
 * Split from `spotifyApi.ts` rather than added to it: that file is search and
 * playback and the request machinery, and this is a different subject that
 * happens to speak the same protocol.
 *
 * Everything here reads. Writing — adding, removing, reordering — comes later
 * and will need the `snapshotId` this already carries.
 */

/** Spotify's own page size cap for playlists. */
const PLAYLISTS_PER_PAGE = 50;

/**
 * How many records to take out of a crate at a time.
 *
 * Spotify allows a hundred and that is what this asked for, which was a
 * mistake: a record is drawn at full size, and above 96px `VinylDisc` draws its
 * grooves, its label and half a dozen gradients. A hundred of those mounting in
 * one frame does not open a playlist slowly, it stops opening it.
 *
 * Two dozen is more than a drawer's height of them, so there is always
 * something below to scroll to, and the rest come out of the crate as it is
 * scrolled — which is what the shelf does one level up, for the same reason.
 */
const ITEMS_PER_PAGE = 24;

/**
 * How many to ask for when the whole list is wanted rather than a screenful.
 *
 * The small page above is sized for drawing: two dozen records is what an
 * opened crate can show before anyone scrolls. Playing a crate needs the list
 * and not the pictures, so it asks for as much as Spotify will give at once —
 * four requests for two hundred songs instead of nine.
 */
const PLAY_PER_PAGE = 50;

/**
 * The most a crate will hand over to be played at once.
 *
 * Somewhere between "enough that nobody meets it" and "not an unbounded number
 * of requests because a button was pressed". Six of the larger pages. A list
 * longer than this plays its first three hundred, which is several hours.
 */
const PLAY_CAP = 300;

export interface SpotifyPlaylist {
  id: string;
  name: string;
  /**
   * Spotify's cheap answer to "has this changed".
   *
   * Kept from the first read because it is what makes refreshing a cached
   * playlist a comparison rather than a download, and because every write to a
   * playlist has to quote it — that is how Spotify refuses an edit aimed at a
   * version of the list that no longer exists.
   */
  snapshotId: string;
  trackCount: number;
  ownerId: string;
  ownerName: string;
  coverArtUrl?: string;
}

/**
 * One page, and where the next one starts.
 *
 * `cursor` is null at the end. Passing it back is the whole of paging here —
 * the caller never computes an offset, so it cannot get one wrong.
 */
export interface Page<T> {
  items: T[];
  cursor: string | null;
}

interface ApiOwner {
  id: string;
  display_name?: string | null;
}

interface ApiPlaylist {
  id: string;
  name: string;
  snapshot_id: string;
  owner: ApiOwner;
  images?: ApiImage[] | null;
  /** Named `tracks` before February 2026 and `items` after it. */
  tracks?: { total: number } | null;
  items?: { total: number } | null;
}

interface ApiPage<T> {
  items: (T | null)[];
  /** A whole URL, or null at the end. Only its query is used. */
  next?: string | null;
}

/**
 * Whether this app can actually read what is inside a playlist.
 *
 * Only the ones this account made. Measured against the real API rather than
 * assumed: a playlist a friend made answers 200 for its name and cover and 403
 * for a single one of its tracks, on both route names, with every playlist
 * scope granted. A Development Mode registration may read the content of its
 * own authorised users and nobody else's, and there is no scope that changes
 * that.
 *
 * Spotify's own — Discover Weekly, the Daily Mixes, the editorial lists — fall
 * out of the same rule for a different reason: they were withdrawn from
 * Development Mode applications in November 2024. Both would be crates that
 * open onto a refusal, so neither reaches the shelf.
 *
 * The cost is real and worth naming: a playlist somebody can see on Spotify is
 * not here. Better than a shelf of sleeves that do not open.
 */
export function readableBy(ownerId: string, meId: string | null): boolean {
  return meId !== null && ownerId === meId;
}

/**
 * This account's Spotify id.
 *
 * `account` holds on to its own answer for the session, so this asks Spotify
 * once however many pages the shelf fills. It used to keep a second copy here,
 * including the null it fell back to — which meant one moment offline while
 * the shelf was loading left it empty until the app was restarted.
 */
async function currentUserId(): Promise<string | null> {
  try {
    return (await account())?.id ?? null;
  } catch {
    // Not a reason to show nothing. Without an id nothing is known to be
    // readable, which is the honest answer, and the shelf says it is empty
    // rather than filling with crates that will refuse to open.
    return null;
  }
}

function toPlaylist(raw: ApiPlaylist): SpotifyPlaylist {
  const cover = pickCover(raw.images);
  const playlist: SpotifyPlaylist = {
    id: raw.id,
    name: raw.name,
    snapshotId: raw.snapshot_id,
    // `tracks.total` until February 2026, `items.total` after. Whichever this
    // registration is answered by, the count means the same thing.
    trackCount: raw.items?.total ?? raw.tracks?.total ?? 0,
    ownerId: raw.owner.id,
    ownerName: raw.owner.display_name ?? raw.owner.id,
  };
  if (cover) playlist.coverArtUrl = cover;
  return playlist;
}

/**
 * The offset the next page starts at, taken from Spotify's own `next` link.
 *
 * Reading it back out of the URL rather than counting pages here: the server
 * knows how far it got, and a count kept on this side drifts the moment a
 * response comes back shorter than it was asked for.
 */
export function offsetFromNext(next: string | null | undefined): string | null {
  if (!next) return null;
  const found = /[?&]offset=(\d+)/.exec(next);
  return found?.[1] ?? null;
}

/**
 * One page of the playlists this account made.
 *
 * A page can come back much shorter than it was asked for — the filtering
 * happens after Spotify has counted, and somebody who follows a hundred lists
 * and made four will see most of a page disappear — and that is not the end of
 * the list. Only a null cursor is.
 */
export async function playlistPage(cursor?: string | null): Promise<Page<SpotifyPlaylist>> {
  const params = new URLSearchParams({ limit: String(PLAYLISTS_PER_PAGE) });
  if (cursor) params.set('offset', cursor);

  const [data, me] = await Promise.all([
    request<ApiPage<ApiPlaylist>>(`/me/playlists?${params}`),
    currentUserId(),
  ]);
  const items = (data?.items ?? [])
    .filter((raw): raw is ApiPlaylist => raw !== null && !!raw.id)
    .map(toPlaylist)
    .filter((playlist) => readableBy(playlist.ownerId, me));

  return { items, cursor: offsetFromNext(data?.next) };
}

/**
 * Which route this registration answers on, once it has told us.
 *
 * February 2026 renamed `/playlists/{id}/tracks` to `/items`, and postponed the
 * removal for registrations that already existed — so an app registered last
 * year and one registered last week are not guaranteed to have the same route.
 * Rather than decide from the outside which is which, this asks once and
 * remembers, and every playlist after the first costs nothing extra.
 */
let itemsRoute: 'items' | 'tracks' | null = null;

interface ApiItemEntry {
  /** `track` before February 2026, `item` after it. */
  item?: ApiTrack | null;
  track?: ApiTrack | null;
}

async function itemsPageOn(
  route: 'items' | 'tracks',
  id: string,
  params: URLSearchParams,
): Promise<ApiPage<ApiItemEntry> | null> {
  return request<ApiPage<ApiItemEntry>>(`/playlists/${encodeURIComponent(id)}/${route}?${params}`);
}

/** One page of a playlist's tracks, already playable. */
export async function playlistTrackPage(
  id: string,
  cursor?: string | null,
  perPage = ITEMS_PER_PAGE,
): Promise<Page<TrackMetadata>> {
  const params = new URLSearchParams({ limit: String(perPage) });
  if (cursor) params.set('offset', cursor);

  let data: ApiPage<ApiItemEntry> | null;
  if (itemsRoute) {
    data = await itemsPageOn(itemsRoute, id, params);
  } else {
    try {
      data = await itemsPageOn('items', id, params);
      itemsRoute = 'items';
    } catch (err) {
      // Only when the route is not there. This used to retry on any failure,
      // which meant a playlist somebody was not allowed to read — a 403 —
      // bought a second doomed request, and the error that reached the screen
      // came from the fallback rather than from the refusal that mattered.
      if (!(err instanceof SpotifyError) || err.status !== 404) throw err;
      data = await itemsPageOn('tracks', id, params);
      itemsRoute = 'tracks';
    }
  }

  const items = (data?.items ?? [])
    .map((entry) => entry?.item ?? entry?.track ?? null)
    // A playlist can hold a track that is gone, or a local file Spotify only
    // knows the name of. Neither has a URI to play.
    .filter((track): track is ApiTrack => track !== null && !!track.uri)
    .map(toTrackMetadata);

  return { items, cursor: offsetFromNext(data?.next) };
}

/**
 * Everything in a crate, for playing rather than for showing.
 *
 * Paged through in one go, at the larger page size and up to the cap. The
 * caller waits: a play button that starts on the first two dozen songs and
 * quietly grows the queue afterwards would shuffle across whatever had
 * arrived by then rather than across the playlist, which is a different
 * playlist every time you press it.
 *
 * Records Spotify cannot play — a removed track, a local file it only knows
 * the name of — are already dropped by the page below, so a crate of two
 * hundred may well return fewer.
 *
 * Answered from memory when the crate has not changed since it was last read.
 * Dropping a crate on the deck is up to six requests, and dropping the same one
 * again — which is what listening to a playlist twice in an evening is — used
 * to be six more.
 *
 * `snapshotId` is what makes that safe. Spotify changes it whenever anything in
 * the playlist moves, so the shelf handing over the one it holds is the crate
 * saying whether this is still the same crate. The age check underneath it is
 * for the shelf itself being old: a playlist edited on the phone half an hour
 * ago has a new snapshot that nobody here has seen yet.
 */
export async function wholeCrate(id: string, snapshotId?: string): Promise<TrackMetadata[]> {
  const known = crates.get(id);
  const fresh =
    known &&
    Date.now() - known.at < CRATE_CACHE_MS &&
    (snapshotId === undefined || known.snapshotId === snapshotId);
  if (fresh) return known.tracks;

  const all: TrackMetadata[] = [];
  let cursor: string | null = null;
  do {
    const page: Page<TrackMetadata> = await playlistTrackPage(id, cursor, PLAY_PER_PAGE);
    all.push(...page.items);
    cursor = page.cursor;
  } while (cursor && all.length < PLAY_CAP);

  crates.set(id, { at: Date.now(), snapshotId, tracks: all });
  if (crates.size > CRATE_CACHE_MAX) {
    // Insertion order, so the first key is the oldest.
    const oldest = crates.keys().next().value;
    if (oldest !== undefined) crates.delete(oldest);
  }
  return all;
}

/** Crates read in full, by playlist id. */
const crates = new Map<
  string,
  { at: number; snapshotId: string | undefined; tracks: TrackMetadata[] }
>();

/**
 * How long a crate is believed without a matching snapshot behind it.
 *
 * Half an hour. Long enough that playing the same playlist through an evening
 * costs one read of it, short enough that an edit made somewhere else turns up
 * in the same sitting.
 */
const CRATE_CACHE_MS = 30 * 60_000;

/** Three hundred tracks each; a handful is a listening session, not a library. */
const CRATE_CACHE_MAX = 8;

/** Forget a crate — it has been written to, or the account has changed. */
export function forgetCrates(id?: string): void {
  if (id === undefined) crates.clear();
  else crates.delete(id);
}
