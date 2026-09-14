import { describe, expect, it } from 'vitest';
import conf from '../../src-tauri/tauri.conf.json?raw';

/**
 * What the window is allowed to load, and the one place it is easy to get wrong.
 *
 * The content security policy is enforced in a production build and effectively
 * is not in development, where the page is served by a dev server rather than
 * from the bundle. That makes it the widest dev-and-prod trap this app has: a
 * blocked resource works on every machine it is developed on and silently fails
 * on every machine it ships to. Nothing is thrown, nothing is logged where
 * anyone can see it — a release build has no console at all — and the only
 * symptom is a picture that is not there.
 *
 * Which is what happened. `img-src` named `https://i.scdn.co` and nothing else,
 * so most covers arrived and the rest did not: Spotify serves a playlist cover
 * somebody uploaded themselves from `image-cdn-*.spotifycdn.com`, and the
 * generated four-square cover for a playlist without one from `mosaic.scdn.co`.
 * Neither is `i.scdn.co`. The hosts below were taken from this app's own
 * WebView2 cache rather than from documentation, which is how the two that were
 * missing were found.
 *
 * The audio the Web Playback SDK fetches — `audio-*.spotifycdn.com`,
 * `seektables.scdn.co` — does not appear here and does not need to. It is
 * fetched from inside the SDK's own cross-origin iframe, which this policy does
 * not reach. That is why playback worked while the pictures did not.
 */

const csp = (JSON.parse(conf) as { app: { security: { csp: Record<string, string> } } }).app
  .security.csp;

/**
 * Whether a policy would let a host through.
 *
 * Only the two forms this policy uses: an exact origin, and one wildcard in the
 * leftmost label. Anything else is not understood and is reported as a miss
 * rather than guessed at.
 */
function allows(policy: string, host: string): boolean {
  return policy.split(/\s+/).some((source) => {
    if (source === `https://${host}`) return true;
    if (!source.startsWith('https://*.')) return false;
    const suffix = source.slice('https://*.'.length);
    return host.endsWith(`.${suffix}`);
  });
}

/** Where Spotify has actually served this app a picture from. */
const COVER_HOSTS = [
  // Album art, and a playlist cover Spotify made.
  'i.scdn.co',
  // The four-square cover a playlist gets when nobody has given it one.
  'mosaic.scdn.co',
  // A cover somebody uploaded to their own playlist. Two shards, and the
  // naming says there can be more of them — which is why the policy names the
  // domain rather than these two.
  'image-cdn-ak.spotifycdn.com',
  'image-cdn-fa.spotifycdn.com',
];

describe('what the window may load', () => {
  it('may show a cover from anywhere Spotify serves one', () => {
    for (const host of COVER_HOSTS) {
      expect(allows(csp['img-src'] ?? '', host), `img-src blocks ${host}`).toBe(true);
    }
  });

  it('names Spotify image domains rather than single hosts', () => {
    // The shard in `image-cdn-ak` and `image-cdn-fa` is a content network's
    // name, and there is no reason to think those are the only two. A policy
    // listing hosts one at a time comes back as this same bug the next time
    // Spotify adds one.
    expect(csp['img-src']).toContain('https://*.spotifycdn.com');
    expect(csp['img-src']).toContain('https://*.scdn.co');
  });

  it('still reaches Spotify for everything else it needs', () => {
    // Untouched by the fix above, and worth holding: these are what make
    // search, playback and the SDK work at all.
    expect(allows(csp['connect-src'] ?? '', 'api.spotify.com')).toBe(true);
    expect(csp['script-src']).toContain('https://sdk.scdn.co');
    expect(csp['frame-src']).toContain('https://sdk.scdn.co');
  });

  it('lets nothing else in by default', () => {
    // The reason any of this is worth writing down: the policy is a list of
    // exceptions to `'self'`, so anything not named is refused in production
    // and nowhere else.
    expect(csp['default-src']).toBe("'self'");
    expect(csp['object-src']).toBe("'none'");
    expect(csp['frame-ancestors']).toBe("'none'");
  });
});
