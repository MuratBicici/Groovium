import { describe, expect, it } from 'vitest';
import type { CrateEntry } from '@/core/providers/spotifyPlaylists';
import { copiesOf, moveRequest, withMove, withoutSong, withSongAdded } from './crateEdits';

/**
 * Where records end up after an edit.
 *
 * Every expectation below is checked against a model of the playlist itself —
 * the full list, including the entries Spotify cannot play and the crate does
 * not show — edited the way Spotify documents, then read back as the crate
 * would read it. If the arithmetic and the model disagree, the next edit would
 * be aimed at the wrong song.
 */

/** A playlist as Spotify holds it: ids, with null for an entry that cannot play. */
type Playlist = (string | null)[];

/** What the crate shows of it. */
function crateOf(playlist: Playlist): CrateEntry[] {
  return playlist.flatMap((id, position) =>
    id === null
      ? []
      : [
          {
            track: { id, title: id, artist: 'A', album: '', duration: 1, source: 'spotify' as const },
            position,
          },
        ],
  );
}

/** Spotify's reorder: take one out at `rangeStart`, put it before `insertBefore` as it was. */
function spotifyMove(playlist: Playlist, rangeStart: number, insertBefore: number): Playlist {
  const moving = playlist[rangeStart] as string | null;
  const marked: (string | null | typeof HOLE)[] = [...playlist];
  marked.splice(insertBefore, 0, moving);
  marked[rangeStart < insertBefore ? rangeStart : rangeStart + 1] = HOLE;
  return marked.filter((entry) => entry !== HOLE) as Playlist;
}
const HOLE = Symbol('hole');

/** Spotify's removal by URI: every copy. */
function spotifyRemove(playlist: Playlist, uri: string): Playlist {
  return playlist.filter((id) => id !== uri);
}

const view = (entries: CrateEntry[]) => entries.map((entry) => [entry.track.id, entry.position]);

describe('taking a song out', () => {
  it('moves everything after it up, across entries that cannot play', () => {
    const playlist: Playlist = ['a', null, 'b', 'c', null, 'd'];
    const edited = withoutSong(crateOf(playlist), 'b');
    expect(view(edited)).toEqual(view(crateOf(spotifyRemove(playlist, 'b'))));
  });

  it('takes every copy, the way Spotify does', () => {
    const playlist: Playlist = ['x', 'a', null, 'x', 'b', 'x'];
    expect(copiesOf(crateOf(playlist), 'x')).toBe(3);
    const edited = withoutSong(crateOf(playlist), 'x');
    expect(view(edited)).toEqual(view(crateOf(spotifyRemove(playlist, 'x'))));
  });

  it('leaves a crate alone that does not hold the song', () => {
    const crate = crateOf(['a', 'b']);
    expect(withoutSong(crate, 'z')).toBe(crate);
  });
});

describe('moving a song', () => {
  const playlist: Playlist = ['a', null, 'b', 'c', null, 'd', 'e'];
  const crate = crateOf(playlist);

  // Every move there is, on screen, checked against the model.
  for (let from = 0; from < crate.length; from++) {
    for (let to = 0; to < crate.length; to++) {
      if (from === to) continue;
      it(`from screen ${from} to screen ${to} lands where Spotify puts it`, () => {
        const request = moveRequest(crate, from, to);
        expect(request).not.toBeNull();
        const spotify = spotifyMove(playlist, request!.rangeStart, request!.insertBefore);

        // The request is the move the screen shows…
        const shownAfter = crate.map((entry) => entry.track.id);
        const [moved] = shownAfter.splice(from, 1);
        shownAfter.splice(to, 0, moved!);
        expect(crateOf(spotify).map((entry) => entry.track.id)).toEqual(shownAfter);

        // …and the positions afterwards are Spotify's.
        expect(view(withMove(crate, from, to))).toEqual(view(crateOf(spotify)));
      });
    }
  }

  it('asks for nothing when the song would not move', () => {
    expect(moveRequest(crate, 2, 2)).toBeNull();
    expect(moveRequest(crate, 9, 0)).toBeNull();
    expect(moveRequest(crate, 0, 99)).toBeNull();
    expect(withMove(crate, 2, 2)).toBe(crate);
  });

  it('can be moved again from where the last move left it', () => {
    // The edit screen sends one move after another, each from the positions
    // the last one produced. Two in a row must still agree with the model.
    const first = moveRequest(crate, 0, 4)!;
    const once = spotifyMove(playlist, first.rangeStart, first.insertBefore);
    const afterFirst = withMove(crate, 0, 4);

    const second = moveRequest(afterFirst, 3, 1)!;
    const twice = spotifyMove(once, second.rangeStart, second.insertBefore);
    expect(view(withMove(afterFirst, 3, 1))).toEqual(view(crateOf(twice)));
  });
});

describe('adding a song', () => {
  it('puts it at the position after everything in the playlist, playable or not', () => {
    const playlist: Playlist = ['a', null, 'b', null];
    const song = crateOf(['n'])[0]!;
    const added = withSongAdded(crateOf(playlist), { track: song.track }, playlist.length);
    expect(view(added)).toEqual(view(crateOf([...playlist, 'n'])));
  });
});
