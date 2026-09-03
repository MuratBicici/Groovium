import type { TrackMetadata } from '@/core/types';
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
 * Playlists Spotify makes rather than people: Discover Weekly, the Daily Mixes,
 * every editorial list.
 *
 * They are closed to Development Mode applications — Spotify withdrew them in
 * November 2024 — so fetching one answers 404 no matter how many scopes have
 * been granted. They are dropped rather than shown greyed out, and the owner
 * says which is which without a request being made to find out.
 */
export function isSpotifyOwned(ownerId: string): boolean {
  return ownerId === 'spotify';
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
 * One page of the signed-in person's playlists, Spotify's own left out.
 *
 * A page can come back shorter than it was asked for — the filtering happens
 * after Spotify has counted — and that is not the end of the list. Only a null
 * cursor is.
 */
export async function playlistPage(cursor?: string | null): Promise<Page<SpotifyPlaylist>> {
  const params = new URLSearchParams({ limit: String(PLAYLISTS_PER_PAGE) });
  if (cursor) params.set('offset', cursor);

  const data = await request<ApiPage<ApiPlaylist>>(`/me/playlists?${params}`);
  const items = (data?.items ?? [])
    .filter((raw): raw is ApiPlaylist => raw !== null && !!raw.id)
    .map(toPlaylist)
    .filter((playlist) => !isSpotifyOwned(playlist.ownerId));

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
): Promise<Page<TrackMetadata>> {
  const params = new URLSearchParams({ limit: String(ITEMS_PER_PAGE) });
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
