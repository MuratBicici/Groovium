import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Whether the app is online: the webview's word, Windows's, and a knock on
 * Spotify's door whenever Windows says there is no internet.
 */

let tellWindows: (internet: boolean) => void = () => {};
let windowsNow: boolean | null = null;

vi.mock('@/core/utils/env', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => windowsNow),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_event: string, handler: (event: { payload: boolean }) => void) => {
    tellWindows = (internet) => handler({ payload: internet });
    return () => {};
  }),
}));

const knocks = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>();

/** Let what is in flight settle. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** A fresh copy of the module, with the network as given, already listening. */
async function start(onLine = true) {
  vi.stubGlobal('navigator', { onLine });
  vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal('fetch', knocks);
  vi.resetModules();
  const online = await import('./online');
  const changed = vi.fn();
  online.subscribe(changed);
  await settle();
  return { isOnline: online.isOnline, changed };
}

beforeEach(() => {
  windowsNow = null;
  tellWindows = () => {};
  knocks.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('being online', () => {
  it('is gone when the webview says there is no network at all', async () => {
    const { isOnline } = await start(false);
    tellWindows(true);
    expect(isOnline()).toBe(false);
  });

  it('is believed when Windows says there is internet, without knocking', async () => {
    const { isOnline } = await start();
    tellWindows(true);
    expect(isOnline()).toBe(true);
    expect(knocks).not.toHaveBeenCalled();
  });

  it('is gone when Windows says no internet and Spotify does not answer', async () => {
    // The Wi-Fi off on a machine with virtual adapters: the webview still says
    // online, which is the case this was for.
    knocks.mockRejectedValue(new TypeError('Failed to fetch'));
    const { isOnline, changed } = await start();
    tellWindows(false);
    await settle();
    expect(knocks).toHaveBeenCalledTimes(1);
    expect(isOnline()).toBe(false);
    expect(changed).toHaveBeenCalled();
  });

  it('stays when Windows says no internet but Spotify answers anyway', async () => {
    // Only Windows's own test is blocked; nobody loses Spotify over it.
    knocks.mockResolvedValue({ type: 'opaque' });
    const { isOnline } = await start();
    tellWindows(false);
    await settle();
    expect(isOnline()).toBe(true);
  });

  it('comes back the moment Windows says there is internet again', async () => {
    knocks.mockRejectedValue(new TypeError('Failed to fetch'));
    const { isOnline } = await start();
    tellWindows(false);
    await settle();
    expect(isOnline()).toBe(false);
    tellWindows(true);
    expect(isOnline()).toBe(true);
  });

  it('starts from what Windows last said, before anything changes', async () => {
    windowsNow = false;
    knocks.mockRejectedValue(new TypeError('Failed to fetch'));
    const { isOnline } = await start();
    await settle();
    expect(isOnline()).toBe(false);
  });

  it('knocks with no account in it', async () => {
    knocks.mockResolvedValue({ type: 'opaque' });
    await start();
    tellWindows(false);
    await settle();
    const init = knocks.mock.calls[0]?.[1];
    expect(init?.mode).toBe('no-cors');
    expect(init?.headers).toBeUndefined();
  });
});
