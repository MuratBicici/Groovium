import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/security/spotifyAuth', () => ({
  accessToken: vi.fn(async () => 'token'),
}));

/**
 * Being throttled used to make it worse.
 *
 * Every keystroke ran a search, every search was refused, and every refusal
 * was politely retried once — so the app answered "you are sending too many
 * requests" by sending twice as many, and stayed refused for as long as
 * anybody kept typing. These are about the gate that stops that.
 *
 * The module is imported fresh in each test: the gate is module-level, because
 * Spotify's limit is per registration rather than per caller, and a gate one
 * test shut would otherwise still be shut in the next.
 */
async function freshApi() {
  vi.resetModules();
  return import('./spotifyApi');
}

const calls: string[] = [];

function answer(status: number, headers: Record<string, string> = {}, body = '{}') {
  return () =>
    Promise.resolve(
      new Response(body, { status, headers: { 'Content-Type': 'application/json', ...headers } }),
    );
}

beforeEach(() => {
  calls.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** `fetch`, recording what was asked for and answering however the test says. */
function stubFetch(sequence: Array<() => Promise<Response>>) {
  let at = 0;
  vi.stubGlobal('fetch', (url: string) => {
    calls.push(String(url));
    const next = sequence[Math.min(at, sequence.length - 1)];
    at += 1;
    return next?.() ?? Promise.reject(new Error('no answer configured'));
  });
}

describe('when Spotify says slow down', () => {
  it('waits the time it asked for and tries once more', async () => {
    const { request } = await freshApi();
    stubFetch([answer(429, { 'Retry-After': '1' }), answer(200, {}, '{"ok":true}')]);

    const pending = request<{ ok: boolean }>('/search?q=a');
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await pending).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it('stops asking until the wait is over', async () => {
    // The whole point. A second search a moment later must not reach the
    // network at all: the answer is already known, and asking again is what
    // keeps the window full.
    const { request, SpotifyError } = await freshApi();
    stubFetch([answer(429, { 'Retry-After': '2' })]);

    // The catch goes on now rather than after the clock moves: the rejection
    // happens during the advance, and a promise nobody is listening to yet is
    // an unhandled rejection.
    const first = request('/search?q=a').catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await first).toBeInstanceOf(SpotifyError);
    const asked = calls.length;

    await expect(request('/search?q=ab')).rejects.toThrow(/429|slow down|yavaş/i);
    expect(calls).toHaveLength(asked);
  });

  it('says how long is left rather than "wait a moment"', async () => {
    const { request } = await freshApi();
    stubFetch([answer(429, { 'Retry-After': '5' })]);

    const first = request('/search?q=a').catch(() => undefined);
    await vi.advanceTimersByTimeAsync(5_000);
    await first;

    await expect(request('/search?q=b')).rejects.toThrow(/\d+\s*s/);
  });

  it('opens again once the wait has passed', async () => {
    const { request } = await freshApi();
    stubFetch([answer(429, { 'Retry-After': '1' }), answer(429, { 'Retry-After': '1' })]);

    const first = request('/search?q=a').catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1_000);
    await first;
    const asked = calls.length;

    // Refused while it is shut...
    await request('/search?q=b').catch(() => undefined);
    expect(calls).toHaveLength(asked);

    // ...and asking again is allowed once the window it named has passed.
    vi.setSystemTime(Date.now() + 2_000);
    stubFetch([answer(200, {}, '{"ok":true}')]);
    await expect(request('/search?q=c')).resolves.toEqual({ ok: true });
  });

  it('does not shut the gate on a request that succeeded', async () => {
    const { request } = await freshApi();
    stubFetch([answer(200, {}, '{"ok":true}')]);
    await request('/search?q=a');
    await request('/search?q=b');
    expect(calls).toHaveLength(2);
  });

  it('backs off further each time it is refused with no Retry-After', async () => {
    // What "always one second, never opens" looked like. Without a number from
    // Spotify a fixed guess is barely a back-off: the wait passes, the next
    // request is refused exactly as before, and the wait resets — so the app
    // keeps knocking at the same rate on a door that is not opening. Read off
    // the message, which carries the seconds left.
    const { request } = await freshApi();
    stubFetch([answer(429)]);
    const secondsIn = (err: unknown) => Number(/(\d+)\s*s/.exec(String(err))?.[1]);

    // One request is two refusals: the first, and the retry it makes.
    // All on `/search`, because the gate is per quota: four different paths
    // would be four different gates and none of them would grow.
    const first = request('/search?q=a').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    await first;
    expect(secondsIn(await request('/search?q=b').catch((e: unknown) => e))).toBe(2);

    // Let that pass, ask again, and the pair after it asks for longer still.
    vi.setSystemTime(Date.now() + 2_000);
    const third = request('/search?q=c').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(4_000);
    await third;
    expect(secondsIn(await request('/search?q=d').catch((e: unknown) => e))).toBe(8);
  });

  it('shuts only the quota that was refused', async () => {
    // Measured on a real registration: `/search` answered 429 with
    // QUOTA_EXCEEDED while `/me` and `/me/playlists` answered 200 in the same
    // second. One gate for the whole app would have taken the shelf and the
    // transport down with the search box.
    const { request } = await freshApi();
    let answers: Record<string, number> = { search: 429, me: 200 };
    vi.stubGlobal('fetch', (url: string) => {
      calls.push(String(url));
      const which = String(url).includes('/search') ? 'search' : 'me';
      return Promise.resolve(
        new Response('{"ok":true}', {
          status: answers[which] ?? 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    const search = request('/search?q=a').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    await search;

    // Shut for searching...
    const asked = calls.length;
    await request('/search?q=b').catch(() => undefined);
    expect(calls).toHaveLength(asked);

    // ...and open for everything else.
    await expect(request('/me/playlists?limit=1')).resolves.toEqual({ ok: true });
    answers = { search: 429, me: 200 };
  });

  it('treats a refusal with no Retry-After as a second, not as permission', async () => {
    // A missing header is not "carry straight on"; without a floor the gate
    // would open immediately and the hammering would carry on as before.
    const { request } = await freshApi();
    stubFetch([answer(429), answer(429)]);

    const first = request('/search?q=a').catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1_000);
    await first;
    const asked = calls.length;

    await request('/search?q=b').catch(() => undefined);
    expect(calls).toHaveLength(asked);
  });
});

describe('not asking the same thing twice', () => {
  it('answers a repeated search from memory', async () => {
    // Searching is the quota this app runs out of, and typing a word and
    // backspacing asks for every prefix on the way down as well as up.
    const { searchTracks } = await freshApi();
    stubFetch([answer(200, {}, '{"tracks":{"items":[]}}')]);

    await searchTracks('redreaming');
    await searchTracks('redreaming');
    await searchTracks('  REDREAMING  ');

    expect(calls).toHaveLength(1);
  });

  it('makes one request when two callers ask at once', async () => {
    // The search box and the station's background lookups overlap easily.
    const { searchTracks } = await freshApi();
    stubFetch([answer(200, {}, '{"tracks":{"items":[]}}')]);

    await Promise.all([searchTracks('kong'), searchTracks('kong')]);
    expect(calls).toHaveLength(1);
  });

  it('still asks for a different search', async () => {
    const { searchTracks } = await freshApi();
    stubFetch([answer(200, {}, '{"tracks":{"items":[]}}')]);

    await searchTracks('one');
    await searchTracks('two');
    expect(calls).toHaveLength(2);
  });

  it('does not remember a refusal', async () => {
    // A 429 is about this moment rather than about the question; remembering
    // one would keep answering with it after the quota came back.
    const { searchTracks } = await freshApi();
    stubFetch([answer(429), answer(429), answer(200, {}, '{"tracks":{"items":[]}}')]);

    const first = searchTracks('kong').catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1_000);
    await first;

    // Past the gate, and the question is asked again rather than answered
    // from a cached failure.
    vi.setSystemTime(Date.now() + 5_000);
    await expect(searchTracks('kong')).resolves.toEqual([]);
  });

  it('asks again once the answer is old', async () => {
    const { searchTracks } = await freshApi();
    stubFetch([answer(200, {}, '{"tracks":{"items":[]}}')]);

    await searchTracks('kong');
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await searchTracks('kong');
    expect(calls).toHaveLength(2);
  });
  it('remembers a station lookup as well as a typed search', async () => {
    // The reason the cache sits on the request rather than on `searchTracks`.
    // `tracksLikeArtist` spends four searches — the artist, its genre, and a
    // track list for each of two peers — through two other functions that both
    // walked straight past a cache built around the first one. The station
    // comes back to the same artist constantly.
    const { tracksLikeArtist } = await freshApi();
    const artist = '{"id":"a1","name":"Kraftwerk","genres":["krautrock"]}';
    const peer = '{"id":"a2","name":"Neu","genres":[]}';
    stubFetch([
      answer(200, {}, `{"artists":{"items":[${artist}]}}`),
      answer(200, {}, `{"artists":{"items":[${artist},${peer}]}}`),
      answer(200, {}, '{"tracks":{"items":[]}}'),
    ]);

    await tracksLikeArtist('Kraftwerk');
    const spent = calls.length;
    expect(spent).toBe(3);

    await tracksLikeArtist('Kraftwerk');
    expect(calls).toHaveLength(spent);
  });

  it('does not remember anything but a search', async () => {
    // The transport and the shelf change under the app's feet — what is playing
    // now, which playlists exist — and an answer from ten minutes ago is not an
    // answer to those.
    const { request } = await freshApi();
    stubFetch([answer(200, {}, '{"ok":true}')]);

    await request('/me/player');
    await request('/me/player');
    expect(calls).toHaveLength(2);
  });
});
