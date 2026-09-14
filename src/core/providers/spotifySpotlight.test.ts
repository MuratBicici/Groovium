import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./spotifyApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./spotifyApi')>()),
  request: vi.fn(),
}));

import { request } from './spotifyApi';
import { forgetSpotlight, oneEach, spotlight } from './spotifySpotlight';
import type { TrackMetadata } from '@/core/types';

/**
 * The two rows of the spotlight, and the two things that could go wrong with
 * them: asking too often, and showing the same song six times.
 *
 * This app has spent a release learning what an endpoint called on a hunch
 * costs, so how often these are asked for is not an implementation detail —
 * it is the feature's whole budget, and it is held here.
 */

const asked = vi.mocked(request);

const apiTrack = (uri: string, name = uri) => ({
  uri,
  name,
  duration_ms: 200_000,
  artists: [{ id: 'a1', name: 'Someone' }],
  album: { name: 'An Album', images: [] },
});

const track = (id: string): TrackMetadata => ({
  id,
  title: id,
  artist: 'Someone',
  album: '',
  duration: 1,
  source: 'spotify',
});

describe('folding a listening log into a shelf', () => {
  it('keeps one of each and the order they arrived in', () => {
    // Recently-played answers with one entry per listen, newest first. An
    // evening on one album comes back as that album several times over.
    const log = [track('a'), track('b'), track('a'), track('c'), track('b')];
    expect(oneEach(log).map((one) => one.id)).toEqual(['a', 'b', 'c']);
  });

  it('leaves a row with nothing repeated alone', () => {
    const row = [track('a'), track('b')];
    expect(oneEach(row).map((one) => one.id)).toEqual(['a', 'b']);
  });

  it('has nothing to say about nothing', () => {
    expect(oneEach([])).toEqual([]);
  });
});

describe('what the spotlight costs', () => {
  beforeEach(() => {
    asked.mockReset();
    forgetSpotlight();
  });

  it('asks once and then answers from what it already has', () => {
    // The drawer is opened and shut all evening. That must not be a request
    // each time.
    asked.mockResolvedValue({ items: [apiTrack('spotify:track:1')] });
    return spotlight('recent')
      .then(() => spotlight('recent'))
      .then(() => spotlight('recent'))
      .then(() => {
        expect(asked).toHaveBeenCalledTimes(1);
      });
  });

  it('asks for each row separately, and only for the one being looked at', () => {
    // The whole reason the two are not fetched together: somebody who never
    // presses the other one never pays for it.
    asked.mockResolvedValue({ items: [] });
    return spotlight('recent').then(() => {
      expect(asked).toHaveBeenCalledTimes(1);
      expect(String(asked.mock.calls[0]?.[0])).toContain('recently-played');
      return spotlight('top').then(() => {
        expect(asked).toHaveBeenCalledTimes(2);
        expect(String(asked.mock.calls[1]?.[0])).toContain('/me/top/tracks');
      });
    });
  });

  it('remembers an account with nothing to show rather than asking again', () => {
    // Empty is an answer. Treating it as a miss would turn the quietest
    // account into the one that asks the most.
    asked.mockResolvedValue({ items: [] });
    return spotlight('top')
      .then((row) => {
        expect(row).toEqual([]);
        return spotlight('top');
      })
      .then(() => {
        expect(asked).toHaveBeenCalledTimes(1);
      });
  });

  it('does not remember a failure', async () => {
    // The other half of that. A row that could not be fetched has to be worth
    // another try, or a moment's trouble is an empty strip for the session.
    asked.mockRejectedValueOnce(new Error('offline'));
    await expect(spotlight('recent')).rejects.toThrow('offline');

    asked.mockResolvedValue({ items: [apiTrack('spotify:track:1')] });
    expect(await spotlight('recent')).toHaveLength(1);
    expect(asked).toHaveBeenCalledTimes(2);
  });

  it('reads both shapes Spotify answers in', () => {
    // Recently-played wraps each track in an entry and top tracks do not.
    asked.mockResolvedValue({
      items: [{ track: apiTrack('spotify:track:1') }, null, { track: null }],
    });
    return spotlight('recent').then((row) => {
      expect(row.map((one) => one.id)).toEqual(['spotify:track:1']);
    });
  });

  it('forgets everything when somebody signs out', () => {
    asked.mockResolvedValue({ items: [] });
    return spotlight('recent')
      .then(() => {
        forgetSpotlight();
        return spotlight('recent');
      })
      .then(() => {
        expect(asked).toHaveBeenCalledTimes(2);
      });
  });
});
