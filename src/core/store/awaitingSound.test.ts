import { describe, expect, it } from 'vitest';
import { awaitingSound } from './selectors';
import type { TrackMetadata } from '@/core/types';

/**
 * "Loading" from the moment a song is chosen.
 *
 * The first Spotify song of a launch brings the player up before it is asked to
 * play anything — seconds of the SDK, a token and a device — and the store says
 * IDLE through all of it. The window said "Ready" over a record it had just
 * been handed, with no light on the bar, until the provider got round to it.
 */

const song: TrackMetadata = {
  id: 'spotify:track:1',
  title: 'A song',
  artist: 'Someone',
  album: '',
  duration: 200_000,
  source: 'spotify',
};

describe('waiting for a song to be heard', () => {
  it('is a wait while the provider says it is loading', () => {
    expect(awaitingSound({ playbackState: 'LOADING', starting: null })).toBe(true);
  });

  it('is a wait while a song is on its way through a provider still coming up', () => {
    expect(awaitingSound({ playbackState: 'IDLE', starting: song })).toBe(true);
    expect(awaitingSound({ playbackState: 'PAUSED', starting: song })).toBe(true);
  });

  it('is not a wait while the last song plays on as the next is fetched', () => {
    expect(awaitingSound({ playbackState: 'PLAYING', starting: song })).toBe(false);
  });

  it('is nothing at all with nothing asked for', () => {
    expect(awaitingSound({ playbackState: 'IDLE', starting: null })).toBe(false);
    expect(awaitingSound({ playbackState: 'PAUSED', starting: null })).toBe(false);
    expect(awaitingSound({ playbackState: 'ERROR', starting: null })).toBe(false);
  });
});
