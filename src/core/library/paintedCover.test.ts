import { describe, expect, it } from 'vitest';
import { attachCoverArtUrls, type LibraryTrack } from './index';
import { coverKey, FAMILIES, paintedCover } from './paintedCover';

const svgOf = (address: string) => decodeURIComponent(address.slice('data:image/svg+xml,'.length));

describe('the colours covers come in', () => {
  it('has six motifs with ten sets each', () => {
    expect(FAMILIES).toHaveLength(6);
    for (const family of FAMILIES) expect(family.palettes).toHaveLength(10);
  });

  it('does not repeat a set within a motif', () => {
    for (const family of FAMILIES) {
      expect(new Set(family.palettes.map((palette) => palette.join())).size).toBe(10);
    }
  });
});

describe('a painted cover', () => {
  it('is the same picture every time for the same key', () => {
    expect(paintedCover('album:one')).toBe(paintedCover('album:one'));
  });

  it('is a different picture for a different key', () => {
    const covers = new Set(Array.from({ length: 200 }, (_, i) => paintedCover(`song:${i}`)));
    expect(covers.size).toBe(200);
  });

  it('is an address that needs nothing further escaped', () => {
    const address = paintedCover('song:escape');
    expect(address.startsWith('data:image/svg+xml,')).toBe(true);
    expect(address.slice('data:image/svg+xml,'.length)).not.toMatch(/[#<>"]/);
    expect(svgOf(address)).toMatch(/^<svg .*<\/svg>$/);
  });

  it('says its size, as a canvas reading its colours needs one', () => {
    expect(svgOf(paintedCover('song:size'))).toContain("width='600' height='600'");
  });

  it('never writes a number a path cannot read', () => {
    for (let i = 0; i < 300; i += 1) expect(svgOf(paintedCover(`song:nan:${i}`))).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('stays small enough to hand to every song in a library', () => {
    for (let i = 0; i < 300; i += 1) expect(paintedCover(`song:weight:${i}`).length).toBeLessThan(40_000);
  });

  it('reaches every motif in every colour', () => {
    const everyColour = new Set(FAMILIES.flatMap((family) => family.palettes.map((palette) => palette.join())));
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i += 1) {
      const svg = svgOf(paintedCover(`song:reach:${i}`));
      for (const colours of everyColour) {
        if (colours.split(',').every((colour) => svg.includes(colour))) seen.add(colours);
      }
    }
    expect(seen.size).toBe(everyColour.size);
  });
});

describe('which songs share a cover', () => {
  const song = (over: Partial<{ id: string; artist: string; album: string }> = {}) => ({
    id: 'a',
    artist: 'Harbor Lights',
    album: 'Salt',
    ...over,
  });

  it('is the songs of one album', () => {
    expect(coverKey(song({ id: 'a' }))).toBe(coverKey(song({ id: 'b' })));
  });

  it('counts a guest on one track as the same album', () => {
    expect(coverKey(song({ artist: 'Harbor Lights feat. June' }))).toBe(coverKey(song()));
    expect(coverKey(song({ artist: 'Harbor Lights, June' }))).toBe(coverKey(song()));
  });

  it('keeps albums of one name by different artists apart', () => {
    expect(coverKey(song({ album: 'Greatest Hits', artist: 'A' }))).not.toBe(
      coverKey(song({ album: 'Greatest Hits', artist: 'B' })),
    );
  });

  it('gives a song with no album a cover of its own', () => {
    expect(coverKey(song({ id: 'a', album: ' ' }))).not.toBe(coverKey(song({ id: 'b', album: ' ' })));
  });

  it('does not count what untagged songs are filed under as an album', () => {
    expect(coverKey(song({ id: 'a', album: 'Local Files' }))).not.toBe(
      coverKey(song({ id: 'b', album: 'Local Files' })),
    );
  });
});

describe('giving songs their covers', () => {
  const entry = (over: Partial<LibraryTrack> = {}): LibraryTrack => ({
    id: 'abc',
    storedFile: 'abc.mp3',
    sourcePath: 'C:/Music/song.mp3',
    title: 'Autobahn',
    artist: 'Kraftwerk',
    album: 'Autobahn',
    durationMs: 1234,
    hasCoverArt: false,
    addedAt: 0,
    ...over,
  });

  it('paints one for a song that has none', async () => {
    const [track] = await attachCoverArtUrls([entry()], '');
    expect(track?.coverArtUrl).toBe(paintedCover(coverKey(entry())));
  });

  it('leaves a song its own', async () => {
    const [track] = await attachCoverArtUrls([entry({ coverArtUrl: 'asset://real.jpg' })], '');
    expect(track?.coverArtUrl).toBe('asset://real.jpg');
  });

  it('does not paint over a cover still to be given an address', async () => {
    const [track] = await attachCoverArtUrls([entry({ coverFile: 'abc.jpg', hasCoverArt: true })], '');
    expect(track?.coverArtUrl).toBeUndefined();
  });
});
