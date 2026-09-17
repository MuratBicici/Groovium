import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Signing out and clearing the Client ID are Tauri commands. Standing in for
// them is a Rust side that records when each one has finished.
const rust = vi.hoisted(() => ({ done: [] as string[], fail: null as string | null }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (command: string) => {
    await Promise.resolve();
    if (rust.fail === command) throw { code: 'keyring_failed', detail: 'no' };
    rust.done.push(command);
  },
}));

import { clearClientId, forgetAccount, onAccountChange, signOut } from './spotifyAuth';

/**
 * Being told the account has gone.
 *
 * The playlist store had a `forget` that nothing called, so signing out left
 * the previous account's shelf, crates and spotlight in memory. And the drawer
 * kept its own idea of whether it was connected, so forgetting Spotify from
 * Settings left it showing an account that was no longer there. Both listen
 * here now.
 */

beforeEach(() => {
  rust.done = [];
  rust.fail = null;
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('announcing that the account has changed', () => {
  it('tells every listener when the account is forgotten', () => {
    const one = vi.fn();
    const two = vi.fn();
    const stopOne = onAccountChange(one);
    const stopTwo = onAccountChange(two);

    forgetAccount();

    expect(one).toHaveBeenCalledWith(null);
    expect(two).toHaveBeenCalledWith(null);
    stopOne();
    stopTwo();
  });

  it('stops telling a listener that has stopped listening', () => {
    const listener = vi.fn();
    const stop = onAccountChange(listener);
    stop();

    forgetAccount();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('when the announcement is made', () => {
  it('announces a sign-out once the token has been deleted, not before', async () => {
    // A listener asks what the state is now. The drawer asks whether there is
    // still a token, and asked first, the answer was yes.
    const heard: string[][] = [];
    const stop = onAccountChange(() => heard.push([...rust.done]));

    await signOut();
    stop();

    expect(heard).toEqual([['spotify_sign_out']]);
  });

  it('announces a cleared Client ID once it has been cleared', async () => {
    const heard: string[][] = [];
    const stop = onAccountChange(() => heard.push([...rust.done]));

    await clearClientId();
    stop();

    expect(heard).toEqual([['spotify_clear_client_id']]);
  });

  it('still announces when signing out fails', async () => {
    // Whoever was listening must not go on holding the account on the strength
    // of a failure; what the state really is, they can ask.
    rust.fail = 'spotify_sign_out';
    const listener = vi.fn();
    const stop = onAccountChange(listener);

    await expect(signOut()).rejects.toBeDefined();
    stop();

    expect(listener).toHaveBeenCalledWith(null);
  });
});
