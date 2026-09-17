import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/security/spotifyAuth', () => ({
  accessToken: vi.fn(async () => 'token'),
  account: vi.fn(async () => ({ displayName: 'Me', id: 'me' })),
}));

import {
  addItems,
  changeDetails,
  COVER_MAX_BYTES,
  coverOf,
  createPlaylist,
  forgetCrates,
  moveItems,
  offsetFromNext,
  plainText,
  playlistEntryPage,
  playlistPage,
  playlistTrackPage,
  readableBy,
  removeFromLibrary,
  removeItems,
  uploadCover,
  wholeCrate,
} from './spotifyPlaylists';
import { withCrate } from '@/core/spotify/cache';
import { clearCache, settled, updateCache } from '@/core/spotify/cacheFile';

/**
 * The playlist reader, against a fabricated Spotify.
 *
 * `fetch` is the seam rather than the request helper: the point of most of
 * these is what happens between the wire and a `TrackMetadata`, and stubbing
 * one layer higher would skip the part that has actually gone wrong before —
 * a response shape that changed under a rename.
 */

const calls: string[] = [];
/** Everything about each request, for the writes, where the method and body are the point. */
const sent: { url: string; method: string; body: unknown; contentType: string | undefined }[] = [];
let answer: (url: string) => { status?: number; body?: unknown };

beforeEach(() => {
  calls.length = 0;
  sent.length = 0;
  answer = () => ({ body: { items: [] } });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    sent.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init?.body,
      contentType: headers['Content-Type'],
    });
    const { status = 200, body = {} } = answer(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
});

const owner = (id: string) => ({ id, display_name: id === 'spotify' ? 'Spotify' : 'Someone' });

const playlist = (id: string, ownerId = 'me', extra: Record<string, unknown> = {}) => ({
  id,
  name: `Playlist ${id}`,
  snapshot_id: `snap-${id}`,
  owner: owner(ownerId),
  tracks: { total: 3 },
  ...extra,
});

const track = (uri: string) => ({
  uri,
  name: `Song ${uri}`,
  duration_ms: 1000,
  artists: [{ id: 'a1', name: 'Artist' }],
  album: { name: 'Album', images: [] },
});

describe('reading someone’s playlists', () => {
  it('keeps what a person made', async () => {
    answer = () => ({ body: { items: [playlist('a'), playlist('b')], next: null } });
    const page = await playlistPage();
    expect(page.items.map((p) => p.id)).toEqual(['a', 'b']);
    expect(page.items[0]).toMatchObject({ name: 'Playlist a', snapshotId: 'snap-a', trackCount: 3 });
  });

  it('drops the ones this account cannot read', async () => {
    // Measured against the real API: a playlist a friend made answers 200 for
    // its name and 403 for a single track, on both route names, with every
    // playlist scope granted. Spotify's own were withdrawn from Development
    // Mode applications separately. Either way the crate would open onto a
    // refusal, so neither reaches the shelf.
    answer = () => ({
      body: {
        items: [
          playlist('mine'),
          playlist('a-friends', 'begum'),
          playlist('discover', 'spotify'),
        ],
        next: null,
      },
    });
    const page = await playlistPage();
    expect(page.items.map((p) => p.id)).toEqual(['mine']);
  });

  it('does not treat a short page as the end', async () => {
    // Spotify counts before this filter runs, so a page of fifty can arrive
    // here as two — somebody who follows a hundred lists and made four sees
    // most of a page disappear. Only a missing `next` means there is no more.
    answer = () => ({
      body: {
        items: [playlist('a'), playlist('x', 'spotify'), playlist('y', 'someone')],
        next: 'https://api.spotify.com/v1/me/playlists?offset=50&limit=50',
      },
    });
    const page = await playlistPage();
    expect(page.items).toHaveLength(1);
    expect(page.cursor).toBe('50');
  });

  it('asks for the next page where Spotify says it starts', async () => {
    answer = () => ({ body: { items: [], next: null } });
    await playlistPage('50');
    expect(calls[0]).toContain('offset=50');
  });

  it('survives a null among the items', async () => {
    answer = () => ({ body: { items: [null, playlist('a')], next: null } });
    const page = await playlistPage();
    expect(page.items.map((p) => p.id)).toEqual(['a']);
  });

  it('reads the count from either name the field has had', async () => {
    answer = () => ({
      body: {
        items: [playlist('new', 'me', { tracks: undefined, items: { total: 7 } })],
        next: null,
      },
    });
    const page = await playlistPage();
    expect(page.items[0]?.trackCount).toBe(7);
  });
});

describe('where the next page starts', () => {
  it('takes the offset out of the link Spotify sends', () => {
    expect(offsetFromNext('https://api.spotify.com/v1/me/playlists?offset=50&limit=50')).toBe('50');
  });

  it('is null at the end of the list', () => {
    expect(offsetFromNext(null)).toBeNull();
    expect(offsetFromNext(undefined)).toBeNull();
  });
});

describe('telling which playlists can be read', () => {
  it('keeps only the ones this account made', () => {
    expect(readableBy('me', 'me')).toBe(true);
    expect(readableBy('begum', 'me')).toBe(false);
    expect(readableBy('spotify', 'me')).toBe(false);
  });

  it('keeps nothing when it does not know who this is', () => {
    // An empty shelf is the honest answer to an unknown account. Keeping
    // everything would fill it with crates that refuse to open.
    expect(readableBy('me', null)).toBe(false);
  });
});

describe('reading what is in a playlist', () => {
  it('maps the entries to playable tracks', async () => {
    answer = () => ({ body: { items: [{ item: track('spotify:track:1') }], next: null } });
    const page = await playlistTrackPage('p1');
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: 'spotify:track:1', source: 'spotify' });
  });

  it('reads an entry under either name it has had', async () => {
    // `track` before February 2026, `item` after. A registration Spotify has
    // not moved yet answers with the old one.
    answer = () => ({ body: { items: [{ track: track('spotify:track:old') }], next: null } });
    const page = await playlistTrackPage('p2');
    expect(page.items[0]?.id).toBe('spotify:track:old');
  });

  it('leaves out an entry with nothing to play', async () => {
    // A track that has been removed, or a local file Spotify only knows the
    // name of. Neither has a URI.
    answer = () => ({
      body: { items: [{ item: null }, { item: { ...track('x'), uri: '' } }], next: null },
    });
    const page = await playlistTrackPage('p3');
    expect(page.items).toEqual([]);
  });

  it('does not retry a refusal on the other route', async () => {
    // A playlist somebody is not allowed to read answers 403 on both. Retrying
    // bought a second doomed request and put *its* error on screen instead of
    // the refusal that mattered — so only a missing route is worth a second
    // try, and 403 is not a missing route.
    vi.resetModules();
    const fresh = await import('./spotifyPlaylists');

    answer = () => ({ status: 403, body: { error: { status: 403, message: 'Forbidden' } } });
    await expect(fresh.playlistTrackPage('theirs')).rejects.toThrow(/refused/i);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/items');
  });

  it('falls back to the older route when the new one is not there', async () => {
    // Spotify renamed `/tracks` to `/items` and postponed the removal for
    // registrations that already existed, so which one answers depends on when
    // the Client ID was made. Asked once, then remembered — which is why this
    // needs a module that has not already made up its mind. The tests above
    // all succeeded on `/items`, and a decision taken once is taken for good.
    vi.resetModules();
    const fresh = await import('./spotifyPlaylists');

    answer = (url) =>
      url.includes('/items')
        ? { status: 404, body: { error: 'not found' } }
        : { body: { items: [{ track: track('spotify:track:2') }], next: null } };

    const page = await fresh.playlistTrackPage('p4');
    expect(page.items[0]?.id).toBe('spotify:track:2');
    expect(calls.some((u) => u.includes('/items'))).toBe(true);
    expect(calls.some((u) => u.includes('/tracks'))).toBe(true);

    // The second playlist does not pay for the discovery again.
    calls.length = 0;
    await fresh.playlistTrackPage('p5');
    expect(calls).not.toHaveLength(0);
    expect(calls.every((u) => u.includes('/tracks'))).toBe(true);
  });
});

describe('reading a whole crate to play it', () => {
  beforeEach(async () => {
    // Module-level, because the crate belongs to the account rather than to a
    // caller. One test's reading would otherwise answer the next one's. Both
    // layers: the one in memory and the one standing in for the file.
    forgetCrates();
    clearCache();
    await settled();
  });

  const page = (uris: string[], next: string | null = null) => ({
    body: { items: uris.map((u) => ({ track: track(u) })), next },
  });

  it('does not read the same crate twice when nothing has changed', async () => {
    // Dropping a crate on the deck is up to six requests. Playing the same
    // playlist again in the same evening used to be six more.
    answer = () => page(['spotify:track:1', 'spotify:track:2']);

    const first = await wholeCrate('p1', 'snap-1');
    calls.length = 0;
    const second = await wholeCrate('p1', 'snap-1');

    expect(second).toEqual(first);
    expect(calls).toHaveLength(0);
  });

  it('reads it again when Spotify says the crate has changed', async () => {
    // `snapshot_id` moves whenever anything in the playlist does, so a shelf
    // carrying a new one is the playlist saying it is not the same playlist.
    answer = () => page(['spotify:track:1']);
    await wholeCrate('p1', 'snap-1');

    answer = () => page(['spotify:track:9']);
    calls.length = 0;
    const again = await wholeCrate('p1', 'snap-2');

    expect(again.map((t) => t.id)).toEqual(['spotify:track:9']);
    expect(calls).not.toHaveLength(0);
  });

  it('reads it again once what it holds is old', async () => {
    // The snapshot the shelf carries can itself be stale — a playlist edited on
    // the phone half an hour ago has a new one nobody here has seen.
    vi.useFakeTimers();
    try {
      answer = () => page(['spotify:track:1']);
      await wholeCrate('p1', 'snap-1');

      vi.setSystemTime(Date.now() + 31 * 60_000);
      calls.length = 0;
      await wholeCrate('p1', 'snap-1');
      expect(calls).not.toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps reading until the pages run out', async () => {
    answer = (url) =>
      url.includes('offset=50')
        ? page(['spotify:track:3'])
        : page(['spotify:track:1', 'spotify:track:2'], 'https://api.spotify.com/x?offset=50');

    const all = await wholeCrate('p1', 'snap-1');
    expect(all.map((t) => t.id)).toEqual([
      'spotify:track:1',
      'spotify:track:2',
      'spotify:track:3',
    ]);
  });

  it('forgets everything when the account goes', async () => {
    // Both layers, which is what signing out does. The one in memory alone is
    // not enough any more: the copy on disk would answer instead.
    answer = () => page(['spotify:track:1']);
    await wholeCrate('p1', 'snap-1');
    await settled();

    forgetCrates();
    clearCache();
    calls.length = 0;
    await wholeCrate('p1', 'snap-1');
    expect(calls).not.toHaveLength(0);
  });
});

/**
 * Crates kept on disk, from one launch to the next.
 *
 * `forgetCrates()` stands in for the app being closed: memory goes, and the
 * copy standing in for the file stays.
 */
describe('a crate kept from an earlier launch', () => {
  beforeEach(async () => {
    forgetCrates();
    clearCache();
    await settled();
  });

  const page = (uris: string[], next: string | null = null) => ({
    body: { items: uris.map((u) => ({ track: track(u) })), next },
  });

  it('plays without asking when Spotify confirms it is the same crate', async () => {
    // A playlist played yesterday is up to six requests again today without
    // this, for a list that has not changed.
    answer = () => page(['spotify:track:1', 'spotify:track:2']);
    const yesterday = await wholeCrate('p1', 'snap-1');
    await settled();

    forgetCrates();
    calls.length = 0;
    const today = await wholeCrate('p1', 'snap-1');

    expect(today).toEqual(yesterday);
    expect(calls).toHaveLength(0);
  });

  it('is read again when the snapshot is not the one it was kept under', async () => {
    answer = () => page(['spotify:track:1']);
    await wholeCrate('p1', 'snap-1');
    await settled();

    forgetCrates();
    answer = () => page(['spotify:track:9']);
    calls.length = 0;
    const today = await wholeCrate('p1', 'snap-2');

    expect(today.map((t) => t.id)).toEqual(['spotify:track:9']);
    expect(calls).not.toHaveLength(0);
  });

  it('is not kept at all without a snapshot to check it against later', async () => {
    // No snapshot means nobody confirmed which version of the playlist this
    // was, so there is nothing a later launch could compare the copy with.
    answer = () => page(['spotify:track:1']);
    await wholeCrate('p1');
    await settled();

    forgetCrates();
    calls.length = 0;
    await wholeCrate('p1', 'snap-1');
    expect(calls).not.toHaveLength(0);
  });

  it('does not replace a good kept copy with one read against no snapshot', async () => {
    // Played while the shelf could not be checked: the crate is read from
    // Spotify, and the copy kept under a confirmed snapshot stays as it was.
    answer = () => page(['spotify:track:1']);
    await wholeCrate('p1', 'snap-1');
    await settled();

    forgetCrates();
    await wholeCrate('p1');
    await settled();

    forgetCrates();
    calls.length = 0;
    await wholeCrate('p1', 'snap-1');
    expect(calls).toHaveLength(0);
  });

  it('is not played from a copy that was only read part of the way', async () => {
    // Opening a crate and scrolling halfway keeps what was seen, with the place
    // to carry on from. That is enough to show, and it is not the playlist.
    updateCache((cache) =>
      withCrate(cache, {
        id: 'p1',
        snapshotId: 'snap-1',
        tracks: [{ id: 'spotify:track:1', title: 'Song', artist: 'Artist', album: 'Album', duration: 1000, source: 'spotify' }],
        cursor: '24',
        at: Date.now(),
      }),
    );
    await settled();

    answer = () => page(['spotify:track:1', 'spotify:track:2']);
    const played = await wholeCrate('p1', 'snap-1');

    expect(played).toHaveLength(2);
    expect(calls).not.toHaveLength(0);
  });
});

describe('what a playlist says about itself', () => {
  it('reads its description as plain text and whether it is public', async () => {
    answer = () => ({
      body: {
        items: [
          playlist('p1', 'me', { description: 'Rock &amp; roll &#x27;n&#x27; more', public: true }),
          playlist('p2', 'me', { description: null, public: null }),
        ],
        next: null,
      },
    });
    const page = await playlistPage();

    expect(page.items[0]?.description).toBe("Rock & roll 'n' more");
    expect(page.items[0]?.isPublic).toBe(true);
    // Not said is not public: showing private for a public list is the smaller surprise.
    expect(page.items[1]?.description).toBe('');
    expect(page.items[1]?.isPublic).toBe(false);
  });

  it('unescapes the ampersand last, so an escaped entity stays an entity', () => {
    expect(plainText('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
  });
});

describe('where each record sits in the playlist', () => {
  it('numbers entries before the ones that cannot play are left out', async () => {
    // Moving a song is asked for by its place in the playlist. The fifth record
    // on screen can be the seventh in the list, and moving by screen position
    // moves the wrong song.
    answer = () => ({
      body: {
        items: [{ item: track('spotify:track:a') }, { item: null }, { item: track('spotify:track:c') }],
        next: null,
      },
    });
    const page = await playlistEntryPage('p1', '24');

    expect(page.items.map((entry) => [entry.track.id, entry.position])).toEqual([
      ['spotify:track:a', 24],
      ['spotify:track:c', 26],
    ]);
  });
});

describe('writing to a playlist', () => {
  it('creates a private playlist through /me/playlists', async () => {
    // `/users/{id}/playlists` answers 403 since February 2026. And Spotify's
    // own default is public, which a list somebody has just named should not be.
    answer = () => ({ status: 201, body: playlist('new', 'me', { name: 'Late', public: false }) });
    const created = await createPlaylist('Late');

    expect(sent[0]).toMatchObject({ method: 'POST', body: { name: 'Late', public: false } });
    expect(sent[0]?.url).toMatch(/\/v1\/me\/playlists$/);
    expect(created.id).toBe('new');
    expect(created.isPublic).toBe(false);
  });

  it('adds songs and hands back the new snapshot', async () => {
    answer = () => ({ status: 201, body: { snapshot_id: 'snap-after' } });
    const snapshot = await addItems('p1', ['spotify:track:a'], 3);

    expect(sent[0]).toMatchObject({ method: 'POST', body: { uris: ['spotify:track:a'], position: 3 } });
    expect(sent[0]?.url).toMatch(/\/playlists\/p1\/items$/);
    expect(snapshot).toBe('snap-after');
  });

  it('removes songs by URI, aimed at the snapshot it was shown', async () => {
    answer = () => ({ body: { snapshot_id: 'snap-after' } });
    const snapshot = await removeItems('p1', ['spotify:track:a'], 'snap-before');

    expect(sent[0]).toMatchObject({
      method: 'DELETE',
      body: { items: [{ uri: 'spotify:track:a' }], snapshot_id: 'snap-before' },
    });
    expect(snapshot).toBe('snap-after');
  });

  it('moves one song by its place in the playlist', async () => {
    answer = () => ({ body: { snapshot_id: 'snap-after' } });
    await moveItems('p1', 0, 5, 'snap-before');

    expect(sent[0]).toMatchObject({
      method: 'PUT',
      body: { range_start: 0, insert_before: 5, range_length: 1, snapshot_id: 'snap-before' },
    });
  });

  it('changes only the details it was given, and survives an empty answer', async () => {
    // Spotify answers a details change with 200 and no body. Reading that as
    // JSON threw, which reported a rename that had worked as a failure.
    answer = () => ({ body: undefined });
    await changeDetails('p1', { name: 'Renamed', isPublic: true });

    expect(sent[0]).toMatchObject({ method: 'PUT', body: { name: 'Renamed', public: true } });
    expect(sent[0]?.body).not.toHaveProperty('description');
    expect(sent[0]?.url).toMatch(/\/playlists\/p1$/);
  });

  it('uploads a cover as JPEG text rather than JSON', async () => {
    answer = () => ({ status: 202, body: undefined });
    await uploadCover('p1', 'AAAA');

    expect(sent[0]).toMatchObject({ method: 'PUT', body: 'AAAA', contentType: 'image/jpeg' });
    expect(sent[0]?.url).toMatch(/\/playlists\/p1\/images$/);
  });

  it('refuses a cover larger than Spotify takes without asking', async () => {
    await expect(uploadCover('p1', 'A'.repeat(COVER_MAX_BYTES + 1))).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });

  it('reads back the cover Spotify settled on', async () => {
    answer = () => ({ body: [{ url: 'https://i.scdn.co/image/new', width: 640 }] });
    expect(await coverOf('p1')).toBe('https://i.scdn.co/image/new');
  });

  it('removes a playlist from the library by its URI', async () => {
    // The `/followers` route went in February 2026.
    answer = () => ({ body: undefined });
    await removeFromLibrary('p1');

    expect(sent[0]?.method).toBe('DELETE');
    expect(sent[0]?.url).toMatch(/\/me\/library\?uris=spotify%3Aplaylist%3Ap1$/);
  });

  it('lets a refusal through to the caller', async () => {
    answer = () => ({ status: 403, body: { error: { status: 403, message: 'Not allowed' } } });
    await expect(addItems('p1', ['spotify:track:a'])).rejects.toThrow(/Not allowed/);
  });
});

