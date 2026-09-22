import { describe, expect, it } from 'vitest';
import {
  closeDrawer,
  drawerOut,
  compactShown,
  expand,
  fullShown,
  pressLyrics,
  pressSpotify,
  showSpotify,
  toCompact,
  type LyricsLayout,
} from './layout';

const shut: LyricsLayout = { drawerOpen: false, lyricsOn: false, lyricsPlace: 'compact' };
const drawer: LyricsLayout = { drawerOpen: true, lyricsOn: false, lyricsPlace: 'compact' };

/** What is on screen, in words. */
const seen = (s: LyricsLayout) =>
  [
    s.drawerOpen ? (fullShown(s) ? 'drawer:lyrics' : 'drawer:spotify') : 'drawer:shut',
    compactShown(s) ? 'player:lyrics' : 'player:deck',
  ].join(' ');

describe('the lyrics button', () => {
  it('puts lyrics in the player when the drawer is shut', () => {
    expect(seen(pressLyrics(shut))).toBe('drawer:shut player:lyrics');
  });

  it('puts them in the drawer when the drawer is out', () => {
    expect(seen(pressLyrics(drawer))).toBe('drawer:lyrics player:deck');
  });

  it('turns them off, leaving a drawer that showed them on Spotify', () => {
    const full = pressLyrics(drawer);
    expect(seen(pressLyrics(full))).toBe('drawer:spotify player:deck');
    expect(seen(pressLyrics(pressLyrics(shut)))).toBe('drawer:shut player:deck');
  });
});

describe('moving lyrics between the two places', () => {
  it('sends them from the drawer to the player, and Spotify back into the drawer', () => {
    expect(seen(toCompact(pressLyrics(drawer)))).toBe('drawer:spotify player:lyrics');
  });

  it('sends them from the player to the drawer, opening it if it was shut', () => {
    expect(seen(expand(pressLyrics(shut)))).toBe('drawer:lyrics player:deck');
    expect(seen(expand(toCompact(pressLyrics(drawer))))).toBe('drawer:lyrics player:deck');
  });
});

describe('the Spotify button', () => {
  it('is lit while the drawer is out, whatever the drawer is showing', () => {
    // The light says the drawer is out. Lyrics taking it over do not put it
    // away, and a light that went out for them would be saying they had.
    expect(drawerOut(shut)).toBe(false);
    expect(drawerOut(drawer)).toBe(true);
    expect(drawerOut(pressLyrics(drawer))).toBe(true);
  });

  it('puts away a drawer showing lyrics, and the lyrics carry on in the player', () => {
    expect(seen(pressSpotify(pressLyrics(drawer)))).toBe('drawer:shut player:lyrics');
  });

  it('still swaps lyrics for Spotify in one press, from the lyrics view itself', () => {
    // What the button used to do. It is where somebody looking at the lyrics is
    // already looking, and it leaves the drawer out.
    expect(seen(toCompact(pressLyrics(drawer)))).toBe('drawer:spotify player:lyrics');
  });

  it('shuts a drawer showing Spotify, as it always has', () => {
    expect(seen(pressSpotify(drawer))).toBe('drawer:shut player:deck');
    const both = toCompact(pressLyrics(drawer));
    expect(seen(pressSpotify(both))).toBe('drawer:shut player:lyrics');
  });

  it('opens the drawer on Spotify, never on lyrics', () => {
    // Lyrics were last put in the drawer, then the drawer was shut some other way.
    const wasFull: LyricsLayout = { drawerOpen: false, lyricsOn: true, lyricsPlace: 'full' };
    expect(seen(pressSpotify(wasFull))).toBe('drawer:spotify player:lyrics');
    expect(seen(showSpotify(wasFull))).toBe('drawer:spotify player:lyrics');
  });
});

describe('closing the drawer itself', () => {
  it('leaves the lyrics in the player', () => {
    expect(seen(closeDrawer(pressLyrics(drawer)))).toBe('drawer:shut player:lyrics');
  });

  it('records where the lyrics now are, so the drawer opens on Spotify next time', () => {
    const away = closeDrawer(pressLyrics(drawer));
    expect(seen(pressSpotify(away))).toBe('drawer:spotify player:lyrics');
  });
});

it('reaches every combination asked for', () => {
  const reached = new Set<string>();
  const moves = [pressLyrics, pressSpotify, toCompact, expand, closeDrawer];
  let frontier = [shut, drawer];
  for (let depth = 0; depth < 4; depth++) {
    frontier = frontier.flatMap((s) => moves.map((m) => m(s)));
    for (const s of frontier) reached.add(seen(s));
  }
  for (const want of [
    'drawer:shut player:lyrics',
    'drawer:spotify player:lyrics',
    'drawer:lyrics player:deck',
  ]) {
    expect(reached).toContain(want);
  }
});
