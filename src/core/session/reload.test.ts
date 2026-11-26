import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackMetadata } from '@/core/types';
import { describePlayer, resumeAfterReload, snapshotOf, takeSnapshot, type ReloadSnapshot } from './reload';

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const track = (id: string, source: 'local' | 'spotify' = 'spotify'): TrackMetadata => ({
  id,
  title: `Title ${id}`,
  artist: `Artist ${id}`,
  album: '',
  duration: 200_000,
  source,
});

const list = [track('a'), track('b'), track('c')];

function player(over: Partial<Parameters<typeof snapshotOf>[0]> = {}): Parameters<typeof snapshotOf>[0] {
  return {
    activeProviderId: 'spotify',
    currentTrack: list[1] as TrackMetadata,
    playbackState: 'PLAYING',
    positionMs: 61_400,
    durationMs: 200_000,
    starting: null,
    error: null,
    playback: { id: 'spotify:playlist:x', tracks: list, index: 1 },
    shuffle: false,
    upNext: [],
    station: false,
    ...over,
  };
}

describe('what a reload by hand keeps', () => {
  it('keeps the list, the place in it and how far in the song was', () => {
    const kept = snapshotOf(player({ upNext: [{ key: 'q1', track: track('q') }] }), 1000);
    expect(kept).toEqual({
      at: 1000,
      playback: { id: 'spotify:playlist:x', tracks: list, index: 1 },
      positionMs: 61_400,
      shuffle: false,
      upNext: [track('q')],
    });
  });

  it('keeps nothing when nothing is playing', () => {
    expect(snapshotOf(player({ playbackState: 'PAUSED' }), 0)).toBeNull();
    expect(snapshotOf(player({ currentTrack: null }), 0)).toBeNull();
  });

  it('keeps a song off the queue on its own, not as the list it interrupted', () => {
    const kept = snapshotOf(player({ currentTrack: track('q') }), 0);
    expect(kept?.playback).toEqual({ id: 'single', tracks: [track('q')], index: 0 });
  });
});

describe('the line written for it', () => {
  it('says what the player was doing without naming the song', () => {
    const line = describePlayer(player({ station: true, error: 'Spotify stopped' }));
    expect(line).toContain('state PLAYING');
    expect(line).toContain('a spotify song at 61 s of 200 s');
    expect(line).toContain('from spotify (2 of 3)');
    expect(line).toContain('infinite play on');
    expect(line).toContain('showing an error: Spotify stopped');
    expect(line).not.toContain('Title');
  });
});

describe('carrying on after it', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', memoryStorage());
  });

  const leave = (snapshot: ReloadSnapshot) => sessionStorage.setItem('groovium.reloadedWith', JSON.stringify(snapshot));

  function resumer() {
    const calls: string[] = [];
    return {
      calls,
      queueLast: (t: TrackMetadata) => void calls.push(`queue ${t.id}`),
      playList: async (id: string, tracks: TrackMetadata[], shuffle?: boolean, from?: number, fromMs?: number) =>
        void calls.push(`play ${id} ${tracks.length} ${String(shuffle)} ${String(from)} ${String(fromMs)}`),
    };
  }

  it('starts the same song in the same list where it was, with what was queued', async () => {
    leave({ at: 5000, playback: { id: 'spotify:playlist:x', tracks: list, index: 1 }, positionMs: 61_400, shuffle: true, upNext: [track('q')] });
    const r = resumer();
    await resumeAfterReload(r, 6000);
    // One start at the place, never a start and a seek after it.
    expect(r.calls).toEqual(['queue q', 'play spotify:playlist:x 3 true 1 61400']);
  });

  it('is used once', async () => {
    leave({ at: 5000, playback: { id: 'single', tracks: [list[0] as TrackMetadata], index: 0 }, positionMs: 0, shuffle: false, upNext: [] });
    await resumeAfterReload(resumer(), 6000);
    expect(takeSnapshot(6000)).toBeNull();
  });

  it('ignores one left by a reload long ago', async () => {
    leave({ at: 0, playback: { id: 'single', tracks: [list[0] as TrackMetadata], index: 0 }, positionMs: 0, shuffle: false, upNext: [] });
    const r = resumer();
    await resumeAfterReload(r, 120_000);
    expect(r.calls).toEqual([]);
  });

  it('starts from the top a song that had barely begun', async () => {
    leave({ at: 0, playback: { id: 'single', tracks: [list[0] as TrackMetadata], index: 0 }, positionMs: 800, shuffle: false, upNext: [] });
    const r = resumer();
    await resumeAfterReload(r, 1);
    expect(r.calls).toEqual(['play single 1 false 0 undefined']);
  });

  it('survives what is not a snapshot', async () => {
    sessionStorage.setItem('groovium.reloadedWith', '{not json');
    const r = resumer();
    await resumeAfterReload(r, 1);
    expect(r.calls).toEqual([]);
  });
});
