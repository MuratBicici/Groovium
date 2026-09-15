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

  it('asks for each row separately', () => {
    // Both rows are on screen at once now, so this is no longer somebody
    // choosing not to pay for the other one — it is two calls, each capped and
    // each kept for its own length. What it still holds is that neither row
    // pages and neither asks on behalf of the other.
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

  it('is one request when both halves of a shelf ask at once', async () => {
    // React runs every effect twice in development, and a drawer shut and
    // reopened mid-flight does the same in any build. A cache written after
    // the response is no cache at all to the second of those: both miss, and
    // both ask.
    let answer = (_row: { items: unknown[] }) => {};
    asked.mockReturnValue(
      new Promise((settle) => {
        answer = settle as (row: { items: unknown[] }) => void;
      }),
    );

    const first = spotlight('recent');
    const second = spotlight('recent');
    expect(asked).toHaveBeenCalledTimes(1);

    answer({ items: [apiTrack('spotify:track:1')] });
    expect(await first).toEqual(await second);
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('lets the next try ask again after two callers shared a failure', async () => {
    // The other half of sharing one request: the sharing has to end when it
    // lands, or a moment's trouble is an empty shelf for the session.
    asked.mockRejectedValue(new Error('offline'));
    await expect(Promise.all([spotlight('top'), spotlight('top')])).rejects.toThrow('offline');
    expect(asked).toHaveBeenCalledTimes(1);

    asked.mockResolvedValue({ items: [apiTrack('spotify:track:1')] });
    expect(await spotlight('top')).toHaveLength(1);
    expect(asked).toHaveBeenCalledTimes(2);
  });

  it('does not keep an answer that arrives after somebody has signed out', async () => {
    // It is the previous person's listening history. There is no moment at
    // which showing it to whoever signed in next is right.
    let answer = (_row: { items: unknown[] }) => {};
    asked.mockReturnValueOnce(
      new Promise((settle) => {
        answer = settle as (row: { items: unknown[] }) => void;
      }),
    );

    const inTheAir = spotlight('recent');
    forgetSpotlight();
    answer({ items: [apiTrack('spotify:track:1')] });
    await inTheAir;

    asked.mockResolvedValue({ items: [] });
    expect(await spotlight('recent')).toEqual([]);
    expect(asked).toHaveBeenCalledTimes(2);
  });

  it('does not hand the next account the request the last one started', async () => {
    // Sharing a request in flight is only safe while it is the same person's.
    // Someone signs out with a row still loading and someone else signs in and
    // opens the drawer: without clearing what is in the air, the second person
    // is handed the first person's history and never asks for their own.
    let answer = (_row: { items: unknown[] }) => {};
    asked.mockReturnValueOnce(
      new Promise((settle) => {
        answer = settle as (row: { items: unknown[] }) => void;
      }),
    );

    const theirs = spotlight('recent');
    forgetSpotlight();

    asked.mockResolvedValue({ items: [apiTrack('spotify:track:mine')] });
    const mine = spotlight('recent');
    expect(asked).toHaveBeenCalledTimes(2);

    answer({ items: [apiTrack('spotify:track:theirs')] });
    await theirs;
    expect((await mine).map((one) => one.id)).toEqual(['spotify:track:mine']);
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
