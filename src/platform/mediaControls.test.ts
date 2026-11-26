import { describe, expect, it } from 'vitest';
import type { TrackMetadata } from '@/core/types';
import { smtcState } from './mediaControls';

const track: TrackMetadata = {
  id: 'spotify:track:x',
  title: 'Night Ferry',
  artist: 'Sable Harbour',
  album: 'Blue Hour',
  duration: 214_000,
  source: 'spotify',
};

describe("what Windows' media controls are told", () => {
  it('says nothing is on when nothing is', () => {
    expect(smtcState(null, 'IDLE', 0, 0).status).toBe('none');
  });

  it('gives the song, its album and where it is', () => {
    expect(smtcState(track, 'PLAYING', 61_400.6, 214_000)).toEqual({
      status: 'playing',
      title: 'Night Ferry',
      artist: 'Sable Harbour',
      album: 'Blue Hour',
      durationMs: 214_000,
      positionMs: 61_401,
    });
  });

  it('counts a song on its way as loading and anything else stopped as paused', () => {
    expect(smtcState(track, 'LOADING', 0, 0).status).toBe('loading');
    expect(smtcState(track, 'PAUSED', 0, 0).status).toBe('paused');
    expect(smtcState(track, 'ERROR', 0, 0).status).toBe('paused');
  });

  it("falls back on the song's own length before the player knows it", () => {
    expect(smtcState(track, 'LOADING', 0, 0).durationMs).toBe(214_000);
  });
});
