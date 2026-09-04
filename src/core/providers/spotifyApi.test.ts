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
    const first = request('/a').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    await first;
    expect(secondsIn(await request('/b').catch((e: unknown) => e))).toBe(2);

    // Let that pass, ask again, and the pair after it asks for longer still.
    vi.setSystemTime(Date.now() + 2_000);
    const third = request('/c').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(4_000);
    await third;
    expect(secondsIn(await request('/d').catch((e: unknown) => e))).toBe(8);
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
