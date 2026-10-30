/**
 * What can be shared of something carried, as a link anybody can open.
 *
 * Only Spotify's own things have one: a song by its URI, a playlist by its id.
 * A song on this computer is a file, and a playlist made in Groovium lives on
 * this computer too — there is nothing at the other end of a link to either,
 * so they have none, and the place to drop for one does not appear for them.
 */

const OPEN = 'https://open.spotify.com';

/**
 * The link for a carried item's id, or null when it has none.
 *
 * `isSpotifyPlaylist` says whether a crate's id is one of the account's Spotify
 * playlists: a crate is carried as `crate:<id>` whichever side of the drawer
 * it came from, and only Spotify's have a page to send anybody to.
 */
export function shareLink(id: string, isSpotifyPlaylist: (playlistId: string) => boolean): string | null {
  // Spotify's own ids are base62; a dash is let through for the demo's made-up
  // ones, and changes nothing for a real id, which never has one.
  const uri = /^spotify:(track|album|playlist|episode):([A-Za-z0-9-]+)$/.exec(id);
  if (uri) return `${OPEN}/${uri[1]}/${uri[2]}`;
  const crate = /^crate:(.+)$/.exec(id);
  if (crate?.[1] && isSpotifyPlaylist(crate[1])) return `${OPEN}/playlist/${crate[1]}`;
  return null;
}
