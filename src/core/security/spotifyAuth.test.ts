import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

/**
 * Asking Spotify who is signed in, and not asking it again.
 *
 * `/me` is not the endpoint whose quota runs out, but it was being spent for
 * nothing: the drawer asked on every open, the shelf asked while filling, and
 * in development React mounts every effect twice — three requests to learn a
 * name that cannot change while the app is running.
 *
 * The module is imported fresh each time, because what is being tested is
 * module-level state.
 */
async function freshAuth() {
  vi.resetModules();
  return import('./spotifyAuth');
}

beforeEach(() => {
  invoke.mockReset();
  // The whole module is a no-op outside the desktop shell.
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const me = { displayName: 'Me', id: 'me' };

describe('who is signed in', () => {
  it('asks Spotify once, however often it is wanted', async () => {
    const { account } = await freshAuth();
    invoke.mockResolvedValue(me);

    expect(await account()).toEqual(me);
    expect(await account()).toEqual(me);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('makes one request when two callers ask in the same tick', async () => {
    // What development actually looked like: the drawer's effect ran twice
    // under StrictMode and the shelf was filling at the same time.
    const { account } = await freshAuth();
    invoke.mockResolvedValue(me);

    await Promise.all([account(), account(), account()]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('does not remember a failure', async () => {
    // Being unable to reach Spotify says nothing about who is signed in, and a
    // remembered null would empty the shelf for the rest of the session.
    const { account } = await freshAuth();
    invoke.mockRejectedValueOnce(new Error('offline'));

    await expect(account()).rejects.toThrow('offline');

    invoke.mockResolvedValue(me);
    expect(await account()).toEqual(me);
  });

  it('forgets who it was when the session ends', async () => {
    const { account, signOut } = await freshAuth();
    invoke.mockResolvedValue(me);
    await account();

    await signOut();
    invoke.mockResolvedValue({ displayName: 'Someone else', id: 'other' });
    expect(await account()).toEqual({ displayName: 'Someone else', id: 'other' });
  });

  it('takes the answer from signing in rather than asking again', async () => {
    const { account, beginAuth } = await freshAuth();
    invoke.mockResolvedValue(me);

    await beginAuth();
    invoke.mockClear();

    expect(await account()).toEqual(me);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('forgets it when the registration changes', async () => {
    // A different Client ID is a different set of authorised users.
    const { account, clearClientId } = await freshAuth();
    invoke.mockResolvedValue(me);
    await account();

    await clearClientId();
    invoke.mockClear();
    invoke.mockResolvedValue(me);
    await account();
    expect(invoke).toHaveBeenCalled();
  });
});
