import { describe, expect, it } from 'vitest';
import { artistKey, matchKey, normalize, trackKey } from './index';

/**
 * Name matching is what decides whether a Last.fm suggestion is a song you
 * already own. Get it wrong in one direction and unrelated songs match; wrong
 * in the other and nothing in the library ever does, so every candidate burns a
 * Spotify search and the station feels empty.
 *
 * Each case below is a real tag shape, not an invented one.
 */
describe('normalize', () => {
  it('drops qualifiers that do not change which song it is', () => {
    expect(normalize('Around the World (Radio Edit)')).toBe(normalize('Around the World'));
    expect(normalize('Money - 2011 Remastered Version')).toBe(normalize('Money'));
    expect(normalize('Creep [Acoustic]')).toBe(normalize('Creep'));
    expect(normalize('Stan feat. Dido')).toBe(normalize('Stan'));
  });

  it('ignores accents, case and punctuation', () => {
    expect(normalize('Déjà Vu')).toBe(normalize('deja vu'));
    expect(normalize('Sigur Rós')).toBe(normalize('Sigur Ros'));
    expect(normalize('T.N.T.')).toBe(normalize('TNT'));
    expect(normalize('Simon & Garfunkel')).toBe(normalize('Simon and Garfunkel'));
  });

  it('treats punctuation and spacing as the same thing', () => {
    // The judgement call documented in the source: dropping punctuation without
    // also dropping spaces made "T.N.T." match "TNT" but split "Rock'n'Roll"
    // from "Rock n Roll". Removing both is what settles it, so both must hold.
    expect(normalize("Rock'n'Roll")).toBe(normalize('Rock n Roll'));
    expect(normalize("La Femme d'Argent")).toBe(normalize('La Femme d Argent'));
  });

  it('still tells different songs apart', () => {
    expect(normalize('Help!')).not.toBe(normalize('Yesterday'));
    expect(normalize('Come as You Are')).not.toBe(normalize('Something in the Way'));
  });
});

describe('matchKey', () => {
  it('needs the artist to agree as well as the title', () => {
    expect(matchKey('Oasis', 'Wonderwall')).not.toBe(matchKey('Blur', 'Wonderwall'));
  });

  it('separates the two halves so they cannot run together', () => {
    // Without a separator "ab" + "c" and "a" + "bc" would be one key.
    expect(matchKey('ab', 'c')).not.toBe(matchKey('a', 'bc'));
  });

  it('reads the same song the same way from either source', () => {
    const local = { id: 'library:1', title: 'Autobahn', artist: 'Kraftwerk', album: '', duration: 1, source: 'local' } as const;
    const remote = { id: 'spotify:x', title: 'Autobahn', artist: 'Kraftwerk', album: '', duration: 1, source: 'spotify' } as const;
    // Two different ids, one song — which is why history is keyed on names.
    expect(trackKey(local)).toBe(trackKey(remote));
  });
});

describe('artistKey', () => {
  it('matches an artist however the tag spells them', () => {
    expect(artistKey('Sigur Rós')).toBe(artistKey('sigur ros'));
    expect(artistKey('AC/DC')).toBe(artistKey('ACDC'));
  });
});
