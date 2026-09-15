import type { TrackMetadata } from '@/core/types';
import { request, toTrackMetadata, type ApiTrack } from './spotifyApi';

/**
 * The two rows the spotlight can show, and what they cost.
 *
 * Everything else in the drawer is somebody's playlists — things they made.
 * This is the other half: what they have actually been listening to, and what
 * they listen to most. One request per row, and never more than one: neither
 * row pages, so fifty entries and thirty are one call each and that is the
 * whole of it.
 *
 * Both rows are on screen at once now. They were one strip with a switch on it
 * and this said "only ever for the row that is on screen", which was the other
 * half of the budget and is gone — so all of it rests on how long an answer is
 * kept, below, and on the fact that neither of these spends the quota that
 * actually runs out. `/me` is not `/search`; the measurement behind
 * `spotifyApi`'s per-family gates found `/search` refusing while `/me`
 * answered in the same second.
 *
 * Which is the whole design constraint here. This app has spent a release
 * learning that an endpoint called on a hunch is an endpoint called a thousand
 * times a day.
 */

/** Which of the two rows. */
export type Lit = 'recent' | 'top';

/**
 * How many to ask for.
 *
 * Fifty for the recent row because it is a log rather than a list — the same
 * song three times in an evening is three entries — and what survives being
 * folded down to one each is a good deal shorter than what arrives. Thirty for
 * the top row, which has no repeats in it and is a strip rather than a library.
 */
const ASK_FOR: Record<Lit, number> = { recent: 50, top: 30 };

/**
 * How long an answer stands.
 *
 * The recent row is out of date the moment the next song starts, and chasing
 * that would mean asking again every few minutes for a row nobody is looking
 * at. Five minutes is short enough that a drawer opened after a couple of
 * songs shows them, and long enough that opening it four times in a row is one
 * request. What somebody listens to *most* moves over weeks, so that one is
 * kept for the length of a sitting.
 */
const KEEPS_FOR: Record<Lit, number> = { recent: 5 * 60_000, top: 60 * 60_000 };

const PATHS: Record<Lit, (limit: number) => string> = {
  recent: (limit) => `/me/player/recently-played?limit=${limit}`,
  top: (limit) => `/me/top/tracks?limit=${limit}&time_range=short_term`,
};

/** Recently-played wraps each track in an entry; top tracks do not. */
interface ApiEntry {
  track?: ApiTrack | null;
}

interface ApiRow {
  items?: (ApiTrack | ApiEntry | null)[] | null;
}

/**
 * The same song, heard three times this evening, is one record on the shelf.
 *
 * Recently-played is a log: it answers with one entry per listen, newest first,
 * so an evening spent on one album comes back as that album several times over.
 * The strip wants what was played rather than how often, and the order it
 * arrives in is already the order to keep — so the first sighting of each is
 * the one that stays.
 */
export function oneEach(tracks: readonly TrackMetadata[]): TrackMetadata[] {
  const seen = new Set<string>();
  const kept: TrackMetadata[] = [];
  for (const track of tracks) {
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    kept.push(track);
  }
  return kept;
}

/**
 * Whether this is a track worth having.
 *
 * Asked of the URI rather than of the shape, because the URI is the one thing
 * this needs: it is the id, and it is what `play` is given. A local file in
 * somebody's history has a name and no URI, and there is nothing to play.
 */
function isTrack(value: unknown): value is ApiTrack {
  if (typeof value !== 'object' || value === null) return false;
  const uri = (value as ApiTrack).uri;
  return typeof uri === 'string' && uri.length > 0;
}

/** Pull the track out of an entry, whichever of the two shapes arrived. */
function trackIn(item: ApiTrack | ApiEntry | null): ApiTrack | null {
  if (!item) return null;
  const inner: unknown = 'track' in item ? item.track : item;
  return isTrack(inner) ? inner : null;
}

/** Answers that have arrived, with when they did. */
const lit = new Map<Lit, { at: number; tracks: TrackMetadata[] }>();

/**
 * Answers still in the air.
 *
 * A cache written after the response is no cache at all to a second caller who
 * arrives before it — both miss, and both ask. Which is not hypothetical: React
 * runs every effect twice in development, so each shelf asked twice on every
 * open and the release build asked once, and a drawer shut and reopened while
 * a row is still loading does the same thing in either build.
 *
 * So a request in flight is the answer to anyone who asks for that row while it
 * is flying.
 */
const asking = new Map<Lit, Promise<TrackMetadata[]>>();

/**
 * Which account these belong to, counted rather than named.
 *
 * Bumped by signing out. A request already in the air when that happens comes
 * back holding the previous person's listening history, and there is no point
 * at which that is a thing to keep.
 */
let era = 0;

/**
 * What to put in the spotlight, asking Spotify only when the answer has aged.
 *
 * An empty row and a failure are not the same thing and this does not pretend
 * otherwise: a failure throws, so the strip can say so and try again, and an
 * account with nothing to show comes back empty and is remembered as empty.
 */
export function spotlight(which: Lit): Promise<TrackMetadata[]> {
  const known = lit.get(which);
  if (known && Date.now() - known.at < KEEPS_FOR[which]) return Promise.resolve(known.tracks);

  const already = asking.get(which);
  if (already) return already;

  const going = ask(which, era).finally(() => {
    // Only if it is still this one. A sign-out clears the whole map, and a
    // blind delete here would throw away whatever the next open had started.
    if (asking.get(which) === going) asking.delete(which);
  });
  asking.set(which, going);
  return going;
}

async function ask(which: Lit, when: number): Promise<TrackMetadata[]> {
  const data = await request<ApiRow>(PATHS[which](ASK_FOR[which]));
  const tracks = oneEach(
    (data?.items ?? [])
      .map(trackIn)
      .filter((track): track is ApiTrack => track !== null)
      .map(toTrackMetadata),
  );

  // Kept only if it is still the same person's. Handed back either way — the
  // caller that asked has its own way of having gone.
  if (when === era) lit.set(which, { at: Date.now(), tracks });
  return tracks;
}

/**
 * Forget both rows.
 *
 * For signing out, which is the one moment these stop being about the person
 * sitting there.
 */
export function forgetSpotlight(): void {
  lit.clear();
  asking.clear();
  era += 1;
}
