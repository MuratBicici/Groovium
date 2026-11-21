import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetOpened, noteOpened, onOpened, opened, openedNow, OPENED_KEPT, withOpened, type Opened } from './opened';
import type { TrackMetadata } from '@/core/types';

const song = (id: string): TrackMetadata => ({ id, title: id, artist: 'Someone', album: 'A', duration: 1, source: 'spotify' });
const album = (id: string, at = 0): Opened => ({ kind: 'album', id, name: id, artist: 'Someone', at });

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

describe('what was opened', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    forgetOpened();
  });

  it('keeps the newest first, and each thing once', () => {
    let list = withOpened([], album('album:a', 1));
    list = withOpened(list, album('album:b', 2));
    list = withOpened(list, album('album:a', 3));
    expect(list.map((entry) => entry.id)).toEqual(['album:a', 'album:b']);
    expect(list[0]?.at).toBe(3);
  });

  it('tells an album from a song with the same id apart', () => {
    const list = withOpened([album('x')], { kind: 'song', id: 'x', track: song('x'), at: 1 });
    expect(list.map((entry) => entry.kind)).toEqual(['song', 'album']);
  });

  it('keeps no more than it says', () => {
    let list: Opened[] = [];
    for (let i = 0; i < OPENED_KEPT + 5; i += 1) list = withOpened(list, album(`album:${i}`, i));
    expect(list).toHaveLength(OPENED_KEPT);
    expect(list[0]?.id).toBe(`album:${OPENED_KEPT + 4}`);
  });

  it('writes it down, tells whoever is watching, and hands the same list until it changes', () => {
    let told = 0;
    const stop = onOpened(() => {
      told += 1;
    });
    const before = openedNow();
    expect(openedNow()).toBe(before);
    noteOpened(album('album:a'));
    expect(told).toBe(1);
    expect(opened().map((entry) => entry.id)).toEqual(['album:a']);
    expect(openedNow()).not.toBe(before);
    stop();
  });

  it('reads nothing from storage that is not one of its own', () => {
    localStorage.setItem('groovium.opened', JSON.stringify([{ kind: 'album', id: 1 }, { nonsense: true }, album('album:ok')]));
    expect(opened().map((entry) => entry.id)).toEqual(['album:ok']);
  });
});
