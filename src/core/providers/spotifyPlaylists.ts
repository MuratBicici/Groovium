import type { TrackMetadata } from '@/core/types';
import { account } from '@/core/security/spotifyAuth';
import { crateFor, withCrate } from '@/core/spotify/cache';
import { loadCache, updateCache } from '@/core/spotify/cacheFile';
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
 * Reading, and since the playlists became editable, writing: adding and
 * removing songs, moving them, creating, renaming, the cover, and removing a
 * playlist from the library. Every write that changes the list of songs answers
 * with a new `snapshot_id`, and each one here hands it back, because the caller
 * has to know which version of the playlist it is now looking at.
 *
 * The shapes are the ones after Spotify's February 2026 change: `/items`
 * rather than `/tracks`, `POST /me/playlists` rather than
 * `/users/{id}/playlists`, and `/me/library` rather than `/followers`.
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
export const ITEMS_PER_PAGE = 24;

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
export const PLAY_CAP = 300;

export interface SpotifyPlaylist {
  id: string;
  name: string;
  /** As plain text. Spotify sends it with HTML entities escaped. */
  description: string;
  /** Whether it shows on the account's profile. */
  isPublic: boolean;
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
  description?: string | null;
  public?: boolean | null;
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

/**
 * A description as it should be shown and edited.
 *
 * Spotify escapes what it stores — an apostrophe comes back as `&#x27;` — and
 * sending that back unchanged through the details sheet would escape it again
 * on every save. Only the entities Spotify is seen to produce.
 */
export function plainText(escaped: string | null | undefined): string {
  if (!escaped) return '';
  return escaped
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;|&#47;/g, '/')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // Last, or `&amp;lt;` would come out as `<` rather than `&lt;`.
    .replace(/&amp;/g, '&');
}

function toPlaylist(raw: ApiPlaylist): SpotifyPlaylist {
  const cover = pickCover(raw.images);
  const playlist: SpotifyPlaylist = {
    id: raw.id,
    name: raw.name,
    description: plainText(raw.description),
    // A playlist Spotify does not say is public is treated as not: showing
    // "private" for one that is not is a smaller surprise than the other way.
    isPublic: raw.public === true,
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

/**
 * A record in a crate, and where it actually sits in the playlist.
 *
 * The two are not the same number. Entries Spotify cannot play — a removed
 * track, a local file it only knows the name of — are left out of what the
 * crate shows, so the fifth record on screen can be the seventh in the
 * playlist. Moving a song is asked for by position in the playlist, and asked
 * for by position on screen it moves the wrong one.
 */
export interface CrateEntry {
  track: TrackMetadata;
  position: number;
}

/** One page of a playlist's tracks, already playable. */
export async function playlistTrackPage(
  id: string,
  cursor?: string | null,
  perPage = ITEMS_PER_PAGE,
): Promise<Page<TrackMetadata>> {
  const page = await playlistEntryPage(id, cursor, perPage);
  return { items: page.items.map((entry) => entry.track), cursor: page.cursor };
}

/** One page of a playlist's playable entries, with their positions. */
export async function playlistEntryPage(
  id: string,
  cursor?: string | null,
  perPage = ITEMS_PER_PAGE,
): Promise<Page<CrateEntry>> {
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

  // Numbered before anything is left out, so each entry keeps its place in the
  // playlist rather than its place in what is shown.
  const offset = Number(cursor ?? 0) || 0;
  const items = (data?.items ?? [])
    .map((entry, at) => ({ raw: entry?.item ?? entry?.track ?? null, position: offset + at }))
    // A playlist can hold a track that is gone, or a local file Spotify only
    // knows the name of. Neither has a URI to play.
    .filter((entry): entry is { raw: ApiTrack; position: number } => entry.raw !== null && !!entry.raw.uri)
    .map(({ raw, position }) => ({ track: toTrackMetadata(raw), position }));

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
 *
 * And from disk, across launches — but only with a snapshot. The caller hands
 * one over only when Spotify confirmed it recently (see the shelf's
 * `confirmedSnapshot`), so a crate kept yesterday is played today only if it is
 * still the list Spotify describes today. Without one, this reads from Spotify
 * and keeps nothing on disk, because there is nothing to check the copy
 * against later.
 */
export async function wholeCrate(id: string, snapshotId?: string): Promise<TrackMetadata[]> {
  const known = crates.get(id);
  const fresh =
    known &&
    Date.now() - known.at < CRATE_CACHE_MS &&
    (snapshotId === undefined || known.snapshotId === snapshotId);
  if (fresh) return known.tracks;

  if (snapshotId !== undefined) {
    const kept = crateFor(await loadCache(), id, snapshotId);
    // Only a crate that was read to its end, or as far as the cap, can stand
    // in for reading it now. One opened and scrolled halfway is not the
    // playlist.
    if (kept && (kept.cursor === null || kept.tracks.length >= PLAY_CAP)) {
      const tracks = kept.tracks.slice(0, PLAY_CAP);
      keepCrate(id, snapshotId, tracks);
      // To the front of the queue of kept crates, as the one used last.
      updateCache((cache) => withCrate(cache, kept));
      return tracks;
    }
  }

  const all: TrackMetadata[] = [];
  const positions: number[] = [];
  let cursor: string | null = null;
  do {
    const page: Page<CrateEntry> = await playlistEntryPage(id, cursor, PLAY_PER_PAGE);
    for (const entry of page.items) {
      all.push(entry.track);
      positions.push(entry.position);
    }
    cursor = page.cursor;
  } while (cursor && all.length < PLAY_CAP);

  keepCrate(id, snapshotId, all);
  if (snapshotId !== undefined) {
    updateCache((cache) =>
      withCrate(cache, { id, snapshotId, tracks: all, positions, cursor, at: Date.now() }),
    );
  }
  return all;
}

/**
 * Hold a crate's records in memory under a snapshot.
 *
 * Exported for the edits: a change the store has just made is a crate it
 * already knows the whole of, under the snapshot Spotify handed back, and
 * reading it again to learn what was just written would be a request for
 * nothing.
 */
export function keepCrate(
  id: string,
  snapshotId: string | undefined,
  tracks: TrackMetadata[],
): void {
  crates.delete(id);
  crates.set(id, { at: Date.now(), snapshotId, tracks });
  if (crates.size > CRATE_CACHE_MAX) {
    // Insertion order, so the first key is the oldest.
    const oldest = crates.keys().next().value;
    if (oldest !== undefined) crates.delete(oldest);
  }
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

// --- Writing ---------------------------------------------------------------

interface ApiSnapshot {
  snapshot_id?: string | null;
}

/**
 * The version a write left the playlist at.
 *
 * Null when Spotify did not say, which it always does in practice. The caller
 * treats that as a playlist it no longer knows the version of, and asks again
 * rather than guessing.
 */
function snapshotOf(data: ApiSnapshot | null): string | null {
  return data?.snapshot_id ?? null;
}

const playlistPath = (id: string) => `/playlists/${encodeURIComponent(id)}`;

/** Spotify's cap on songs added or removed in one request. */
export const ITEMS_PER_WRITE = 100;

/**
 * The most a cover may be, as the base64 text that is sent.
 *
 * Spotify's limit, measured on the payload rather than the image: 256 KB.
 * Checked here as well as where the image is made, so a picture that slipped
 * past the encoder is refused with a reason instead of a 413.
 */
export const COVER_MAX_BYTES = 256 * 1024;

/**
 * Make a playlist.
 *
 * Private. Spotify's default is public — on the profile the moment it exists —
 * and a list somebody has just named is not yet a list they have decided to
 * show anyone. Making it public is one switch in its details.
 */
export async function createPlaylist(name: string): Promise<SpotifyPlaylist> {
  const created = await request<ApiPlaylist>('/me/playlists', {
    method: 'POST',
    body: JSON.stringify({ name, public: false }),
  });
  if (!created?.id) throw new SpotifyError('Spotify did not return the new playlist.', 502);
  return toPlaylist(created);
}

/**
 * Put songs into a playlist, at the end or at `position`.
 *
 * No snapshot is sent: adding is the one change Spotify applies to whatever
 * the playlist is by then, since appending cannot be aimed at the wrong song.
 */
export async function addItems(
  id: string,
  uris: string[],
  position?: number,
): Promise<string | null> {
  const body: Record<string, unknown> = { uris: uris.slice(0, ITEMS_PER_WRITE) };
  if (position !== undefined) body.position = position;
  const data = await request<ApiSnapshot>(`${playlistPath(id)}/items`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return snapshotOf(data);
}

/**
 * Take songs out of a playlist.
 *
 * By URI, which is all the endpoint accepts — so a song that is in the
 * playlist twice comes out twice. Aimed at `snapshotId`, so Spotify refuses a
 * removal meant for a version of the list that has since changed rather than
 * applying it to whatever is there now.
 */
export async function removeItems(
  id: string,
  uris: string[],
  snapshotId: string,
): Promise<string | null> {
  const data = await request<ApiSnapshot>(`${playlistPath(id)}/items`, {
    method: 'DELETE',
    body: JSON.stringify({
      items: uris.slice(0, ITEMS_PER_WRITE).map((uri) => ({ uri })),
      snapshot_id: snapshotId,
    }),
  });
  return snapshotOf(data);
}

/**
 * Move one song.
 *
 * `from` and `to` are positions in the playlist, not on screen — see
 * `CrateEntry`. `to` is where it goes *before*, which is Spotify's meaning:
 * moving the first song to the end is `from: 0, to: length`.
 */
export async function moveItems(
  id: string,
  from: number,
  to: number,
  snapshotId: string,
): Promise<string | null> {
  const data = await request<ApiSnapshot>(`${playlistPath(id)}/items`, {
    method: 'PUT',
    body: JSON.stringify({
      range_start: from,
      insert_before: to,
      range_length: 1,
      snapshot_id: snapshotId,
    }),
  });
  return snapshotOf(data);
}

export interface PlaylistDetails {
  name?: string;
  description?: string;
  isPublic?: boolean;
}

/** Rename a playlist, or change its description or who can see it. */
export async function changeDetails(id: string, details: PlaylistDetails): Promise<void> {
  const body: Record<string, unknown> = {};
  if (details.name !== undefined) body.name = details.name;
  if (details.description !== undefined) body.description = details.description;
  if (details.isPublic !== undefined) body.public = details.isPublic;
  await request(playlistPath(id), { method: 'PUT', body: JSON.stringify(body) });
}

/**
 * Give a playlist a new cover.
 *
 * The body is the JPEG as base64 text, not JSON. Spotify answers 202 and puts
 * the image in place a little later, which is why `coverOf` exists.
 */
export async function uploadCover(id: string, base64Jpeg: string): Promise<void> {
  if (base64Jpeg.length > COVER_MAX_BYTES) {
    throw new SpotifyError('That cover is larger than Spotify accepts.', 413);
  }
  await request(`${playlistPath(id)}/images`, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: base64Jpeg,
  });
}

/**
 * The version a playlist is at now.
 *
 * For after a change that does not answer with one. Renaming a playlist or
 * giving it a cover may move its snapshot, and the next removal or move is
 * aimed at a snapshot — so rather than find out by being refused, this asks for
 * the one field and nothing else.
 */
export async function currentSnapshot(id: string): Promise<string | null> {
  const data = await request<ApiSnapshot>(`${playlistPath(id)}?fields=snapshot_id`);
  return snapshotOf(data);
}

/** The cover Spotify has for a playlist now, for after an upload has settled. */
export async function coverOf(id: string): Promise<string | undefined> {
  const images = await request<ApiImage[]>(`${playlistPath(id)}/images`);
  return pickCover(images);
}

/**
 * Remove a playlist from the library.
 *
 * Spotify has no delete. This is what its own apps do when somebody deletes a
 * playlist they made, and it is restorable for ninety days from the account
 * page — which is what the confirmation says.
 */
export async function removeFromLibrary(id: string): Promise<void> {
  const uris = encodeURIComponent(`spotify:playlist:${id}`);
  await request(`/me/library?uris=${uris}`, { method: 'DELETE' });
}

