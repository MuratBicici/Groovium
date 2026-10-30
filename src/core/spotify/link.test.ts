import { describe, expect, it } from 'vitest';
import { shareLink } from './link';

/** The links a carried record or sleeve can be shared by. */
describe('a share link', () => {
  const known = (id: string) => id === '37i9dQZF1DXcBWIGoYBM5M';

  it('is a Spotify song’s page', () => {
    expect(shareLink('spotify:track:4uLU6hMCjMI75M1A2tKUQC', known)).toBe(
      'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
    );
  });

  it('is a Spotify playlist’s page, for a crate that is one', () => {
    expect(shareLink('crate:37i9dQZF1DXcBWIGoYBM5M', known)).toBe(
      'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
    );
  });

  it('is nothing for what lives on this computer', () => {
    expect(shareLink('library:3f2a', known)).toBeNull();
    expect(shareLink('crate:local-playlist-1', known)).toBeNull();
    expect(shareLink('spotify:local:Artist:Album:Title:200', known)).toBeNull();
  });
});
