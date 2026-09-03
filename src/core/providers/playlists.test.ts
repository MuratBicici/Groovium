import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/security/spotifyAuth', () => ({
  accessToken: vi.fn(async () => 'token'),
}));

import { isSpotifyOwned, offsetFromNext, playlistPage, playlistTrackPage } from './spotifyPlaylists';

/**
 * The playlist reader, against a fabricated Spotify.
 *
 * `fetch` is the seam rather than the request helper: the point of most of
 * these is what happens between the wire and a `TrackMetadata`, and stubbing
 * one layer higher would skip the part that has actually gone wrong before —
 * a response shape that changed under a rename.
 */

const calls: string[] = [];
let answer: (url: string) => { status?: number; body?: unknown };

beforeEach(() => {
  calls.length = 0;
  answer = () => ({ body: { items: [] } });
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url);
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

  it("drops the ones Spotify made", async () => {
    // Discover Weekly and the Daily Mixes are closed to Development Mode apps,
    // so a row for one is a row that cannot be opened. The owner says which
    // without a request being spent to find out.
    answer = () => ({
      body: { items: [playlist('mine'), playlist('discover', 'spotify')], next: null },
    });
    const page = await playlistPage();
    expect(page.items.map((p) => p.id)).toEqual(['mine']);
  });

  it('does not treat a short page as the end', async () => {
    // Spotify counts before this filter runs, so a page of fifty can arrive
    // here as two. Only a missing `next` means there is no more.
    answer = () => ({
      body: {
        items: [playlist('a'), playlist('x', 'spotify'), playlist('y', 'spotify')],
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

describe('telling Spotify’s playlists apart', () => {
  it('knows who made it', () => {
    expect(isSpotifyOwned('spotify')).toBe(true);
    expect(isSpotifyOwned('me')).toBe(false);
    // Not a substring match: a person may well be called this.
    expect(isSpotifyOwned('spotifyfan')).toBe(false);
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
