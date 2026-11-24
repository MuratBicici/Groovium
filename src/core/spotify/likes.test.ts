import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  inLibrary: vi.fn(async (uris: readonly string[]) => uris.map(() => false)),
  addToLibrary: vi.fn(async () => undefined),
  takeFromLibrary: vi.fn(async () => undefined),
}));
vi.mock('@/core/providers/spotifyApi', () => ({ ...api, LIKE_SCOPE: 'user-library-modify' }));
const auth = vi.hoisted(() => ({ missing: [] as string[], beginAuth: vi.fn(async () => ({})) }));
vi.mock('@/core/security/spotifyAuth', () => ({
  missingScopes: async () => auth.missing,
  beginAuth: auth.beginAuth,
}));
vi.mock('@/core/providers/spotifyHome', () => ({ forgetSaved: vi.fn() }));
vi.mock('@/platform/log', () => ({ log: vi.fn() }));

import { explainHeartOnce, learnLiked, setLiked, useHeartHint, useLikes } from './likes';
import { useNotice } from '@/core/notice';

const SONG = 'spotify:track:abc';
const ALBUM = 'spotify:album:xyz';

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

describe('liking from Groovium', () => {
  beforeEach(() => {
    useLikes.setState({ saved: {} });
    useNotice.setState({ message: null, action: null });
    auth.missing = [];
    api.addToLibrary.mockReset().mockResolvedValue(undefined);
    api.takeFromLibrary.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('localStorage', memoryStorage());
  });

  it('learns what is already liked, and asks only about Spotify songs and albums', async () => {
    api.inLibrary.mockResolvedValueOnce([true, false]);
    await learnLiked([SONG, 'C:/music/local.flac', ALBUM]);
    expect(api.inLibrary).toHaveBeenLastCalledWith([SONG, ALBUM]);
    expect(useLikes.getState().saved).toEqual({ [SONG]: true, [ALBUM]: false });
  });

  it('likes at once, tells Spotify, and says so', async () => {
    const done = setLiked(SONG, true, 'song');
    await done;
    expect(useLikes.getState().saved[SONG]).toBe(true);
    expect(api.addToLibrary).toHaveBeenCalledWith([SONG]);
    expect(useNotice.getState().kind).toBe('done');
  });

  it('takes the like back when Spotify refuses it', async () => {
    useLikes.setState({ saved: { [SONG]: false } });
    api.addToLibrary.mockRejectedValueOnce(new Error('nope'));
    await setLiked(SONG, true, 'song');
    expect(useLikes.getState().saved[SONG]).toBe(false);
    expect(useNotice.getState().kind).toBe('problem');
  });

  it('saves an album, and takes it back out', async () => {
    await setLiked(ALBUM, true, 'album');
    expect(api.addToLibrary).toHaveBeenCalledWith([ALBUM]);
    await setLiked(ALBUM, false, 'album');
    expect(api.takeFromLibrary).toHaveBeenCalledWith([ALBUM]);
    expect(useLikes.getState().saved[ALBUM]).toBe(false);
  });

  it('changes nothing without the permission, and offers to ask for it', async () => {
    auth.missing = ['user-library-modify'];
    await setLiked(SONG, true, 'song');
    expect(api.addToLibrary).not.toHaveBeenCalled();
    expect(useLikes.getState().saved[SONG]).toBeUndefined();
    const { action } = useNotice.getState();
    expect(action).not.toBeNull();

    // Given, what was pressed goes ahead.
    auth.missing = [];
    action?.onPress();
    await vi.waitFor(() => expect(api.addToLibrary).toHaveBeenCalledWith([SONG]));
    expect(auth.beginAuth).toHaveBeenCalled();
  });

  it('stays quiet when told to, for the press the heart explains itself on', async () => {
    await setLiked(SONG, true, 'song', true);
    expect(useNotice.getState().message).toBeNull();
  });

  it('explains the heart the first time only, in a balloon out of it', () => {
    useHeartHint.setState({ open: false });
    expect(explainHeartOnce()).toBe(true);
    expect(useHeartHint.getState().open).toBe(true);
    useHeartHint.setState({ open: false });
    expect(explainHeartOnce()).toBe(false);
    expect(useHeartHint.getState().open).toBe(false);
  });
});
