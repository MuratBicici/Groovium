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
function stubFetch(sequence: Array<(init?: RequestInit) => Promise<Response>>) {
  let at = 0;
  // `init` is handed on because a deadline is only a deadline if whatever is
  // standing in for the network honours the signal, the way `fetch` does.
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push(String(url));
    const next = sequence[Math.min(at, sequence.length - 1)];
    at += 1;
    return next?.(init) ?? Promise.reject(new Error('no answer configured'));
  });
}

/** A socket that is open and will never deliver. */
function neverAnswers() {
  return (init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
}

/** Headers arrive, and then the body never does. */
function neverFinishes() {
  return (init?: RequestInit) => {
    const response = new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    // Both ways a body can be read. The request reads it as text now, so a
    // body that hangs has to hang there.
    const hang = () =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    Object.defineProperty(response, 'json', { value: hang });
    Object.defineProperty(response, 'text', { value: hang });
    return Promise.resolve(response);
  };
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

describe('starting a track on a device', () => {
  /** `fetch`, keeping the body as well as the URL. */
  function stubPlay() {
    const sent: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      calls.push(String(url));
      sent.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    return sent;
  }

  it('starts at the beginning when nothing says otherwise', async () => {
    const { playOnDevice } = await freshApi();
    const sent = stubPlay();

    await playOnDevice('device-1', 'spotify:track:1');
    expect(sent[0]).toEqual({ uris: ['spotify:track:1'], position_ms: 0 });
  });

  it('carries the position rather than seeking to it afterwards', async () => {
    // Coming back from an outage plays the track again from where the clock
    // froze. Playing and then seeking is two operations racing: the seek
    // reaches the SDK while the track it names is still loading, goes nowhere,
    // and the listener gets the song from the top — which is what a recovery
    // that worked in every other respect actually did.
    const { playOnDevice } = await freshApi();
    const sent = stubPlay();

    await playOnDevice('device-1', 'spotify:track:1', 9_412.6);
    expect(sent[0]).toEqual({ uris: ['spotify:track:1'], position_ms: 9_413 });
  });

  it('never asks Spotify to start before the beginning', async () => {
    const { playOnDevice } = await freshApi();
    const sent = stubPlay();

    await playOnDevice('device-1', 'spotify:track:1', -50);
    expect(sent[0]).toMatchObject({ position_ms: 0 });
  });
});


/**
 * A request that never comes back.
 *
 * `fetch` has no deadline of its own, and the case that matters is not a
 * refused connection — that rejects — but a socket that is open and will never
 * deliver. The watchdog in `SpotifyProvider` books its next check from the
 * `finally` of the last one, so a request that never settles is a watchdog
 * that never runs again, and a progress bar that fills over silence until
 * somebody presses pause. It happened, in a release build, to somebody.
 */
describe('when Spotify goes quiet without saying so', () => {
  it('refuses a request that never comes back', async () => {
    const { request, REQUEST_DEADLINE_MS } = await freshApi();
    stubFetch([neverAnswers()]);

    const pending = request('/me/player');
    const landed = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(REQUEST_DEADLINE_MS + 1);
    await landed;
  });

  it('refuses one whose body never arrives', async () => {
    // The headers arriving says the socket is alive, not that the rest of the
    // answer is coming. Two legs, two ways to hang.
    const { request, REQUEST_DEADLINE_MS } = await freshApi();
    stubFetch([neverFinishes()]);

    const pending = request('/me/player');
    const landed = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(REQUEST_DEADLINE_MS + 1);
    await landed;
  });

  it('tells the watchdog that Spotify did not answer', async () => {
    // The whole point of the deadline. `currentPlayback` turning a hang into
    // `answered: false` is what puts the provider into a stall, stops the
    // clock, and stops the record — and none of that could happen while the
    // promise was still pending.
    const { currentPlayback, REQUEST_DEADLINE_MS } = await freshApi();
    stubFetch([neverAnswers()]);

    const pending = currentPlayback();
    await vi.advanceTimersByTimeAsync(REQUEST_DEADLINE_MS + 1);
    expect(await pending).toEqual({ answered: false });
  });

  it('leaves an answer that arrives in time alone', async () => {
    // The deadline has to stop being a deadline once the answer is in hand,
    // or every long-lived caller is holding a timer that fires into nothing.
    const { request } = await freshApi();
    stubFetch([answer(200, {}, '{"ok":true}')]);

    const body = await request<{ ok: boolean }>('/me/player');
    expect(body).toEqual({ ok: true });
    // Counted before anything is advanced. Advancing first runs the timer and
    // then reports none left, which is the same number for both a deadline
    // that was cleared and one that was not.
    expect(vi.getTimerCount()).toBe(0);
  });
});


/**
 * How long one refusal may cost.
 *
 * The gate shuts for as long as Spotify names, and what Spotify names is not
 * always a few seconds — a quota bucket answers with an hour, or a day. There
 * was no bound on it at all, so one answer could put searching out of reach
 * until tomorrow, and nothing in the app could clear it: restarting drops the
 * gate and the next request arms it again. From the outside that is a feature
 * that has simply stopped working.
 */
describe('when Spotify asks for longer than it is worth waiting', () => {
  it('holds the gate for what it asked, when that is reasonable', async () => {
    const { request } = await freshApi();
    stubFetch([answer(429, { 'Retry-After': '60' }), answer(200, {}, '{"ok":true}')]);

    await expect(request('/search?q=a')).rejects.toThrow();
    // A minute is a real wait and is honoured: the next call is refused here
    // rather than sent.
    await expect(request('/search?q=b')).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('does not hold it for an hour because it was asked to', async () => {
    const { request, GATE_CAP_MS } = await freshApi();
    stubFetch([answer(429, { 'Retry-After': '3600' }), answer(200, {}, '{"ok":true}')]);

    await expect(request('/search?q=a')).rejects.toThrow();
    // Past the cap, and well short of the hour Spotify named.
    await vi.advanceTimersByTimeAsync(GATE_CAP_MS + 1_000);
    expect(await request<{ ok: boolean }>('/search?q=b')).toEqual({ ok: true });
  });

  it('shuts one family without shutting another', async () => {
    // Measured on a real registration: `/search` answered 429 while `/me`
    // answered 200 in the same second. One gate for everything would take the
    // shelf and the transport down with the search box.
    const { request } = await freshApi();
    stubFetch([answer(429, { 'Retry-After': '3600' }), answer(200, {}, '{"ok":true}')]);

    await expect(request('/search?q=a')).rejects.toThrow();
    expect(await request('/me/player')).toEqual({ ok: true });
  });
});

/**
 * A write that succeeds with nothing to say.
 *
 * Changing a playlist's details answers 200 with an empty body and uploading
 * its cover answers 202 with one. Read as JSON, both threw — a change Spotify
 * had made came back to the caller as a failure.
 */
describe('when Spotify succeeds without a body', () => {
  it('answers null for a 200 with nothing in it', async () => {
    const { request } = await freshApi();
    stubFetch([answer(200, {}, '')]);
    await expect(request('/playlists/p1', { method: 'PUT', body: '{}' })).resolves.toBeNull();
  });

  it('answers null for a 202 with nothing in it', async () => {
    const { request } = await freshApi();
    stubFetch([answer(202, {}, '')]);
    await expect(request('/playlists/p1/images', { method: 'PUT', body: 'AAAA' })).resolves.toBeNull();
  });
});

