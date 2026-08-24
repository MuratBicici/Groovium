import { describe, expect, it } from 'vitest';
import { rememberedCollection } from './playerStore';

/**
 * Reopening puts back the collection you were on. A single track — a Spotify
 * search result — has nowhere to be resolved back from, so it is never itself
 * remembered.
 *
 * The bug was in what happened *instead*. The session payload omitted the
 * field while a single was playing, Rust writes the whole document, and a
 * `None` is skipped — so omitting it erased whatever had been saved before.
 * Play an album, then play one song out of search, and the album was gone by
 * the next launch.
 */
describe('the collection a restart puts back', () => {
  const album = { context: 'playlist:1', contextIndex: 3 };

  it('is left alone while a single track plays', () => {
    expect(rememberedCollection(album, { id: 'single', index: 0 })).toEqual(album);
  });

  it('survives a run of singles rather than being worn away', () => {
    // Search, play, search again, play again — this is the shape of the real
    // session that lost its library.
    let remembered = rememberedCollection(album, { id: 'single', index: 0 });
    remembered = rememberedCollection(remembered, { id: 'single', index: 0 });
    remembered = rememberedCollection(remembered, { id: 'single', index: 0 });
    expect(remembered).toEqual(album);
  });

  it('follows the collection while one is playing', () => {
    expect(rememberedCollection(album, { id: 'library', index: 7 })).toEqual({
      context: 'library',
      contextIndex: 7,
    });
  });

  it('keeps up as the position within a collection moves', () => {
    const first = rememberedCollection(null, { id: 'library', index: 0 });
    expect(rememberedCollection(first, { id: 'library', index: 4 })).toEqual({
      context: 'library',
      contextIndex: 4,
    });
  });

  it('stays empty when nothing resolvable has ever played', () => {
    // A first run that opens straight into a search result has nothing to
    // remember, and must not invent `single` as a collection.
    expect(rememberedCollection(null, { id: 'single', index: 0 })).toBeNull();
  });

  it('never records a negative index', () => {
    // `playback.index` is -1 before anything has started.
    expect(rememberedCollection(null, { id: 'library', index: -1 })).toEqual({
      context: 'library',
      contextIndex: 0,
    });
  });
});
