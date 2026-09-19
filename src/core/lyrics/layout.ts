/**
 * Where lyrics show, and what each button does to that.
 *
 * Two places: compact, in the player under the deck, and full, in the drawer
 * beside it. The drawer holds one thing at a time — lyrics or Spotify — so
 * which it shows falls out of three facts together: whether the drawer is out,
 * whether lyrics are on, and where lyrics were last put.
 *
 * Every combination somebody might want is reachable, and each by one press:
 * the drawer shut with lyrics in the player; the drawer out on Spotify with
 * lyrics still in the player; the drawer out on lyrics. Turning lyrics on with
 * the drawer out goes to the drawer — the bigger view when there is room for
 * it — and nothing opens the drawer by itself except asking for the big view
 * outright.
 */

export type LyricsPlace = 'compact' | 'full';

export interface LyricsLayout {
  drawerOpen: boolean;
  lyricsOn: boolean;
  lyricsPlace: LyricsPlace;
}

/** The drawer is showing lyrics rather than Spotify. */
export function fullShown(s: LyricsLayout): boolean {
  return s.drawerOpen && s.lyricsOn && s.lyricsPlace === 'full';
}

/** Lyrics are in the player. Whether the player has room is the caller's to say. */
export function compactShown(s: LyricsLayout): boolean {
  return s.lyricsOn && !fullShown(s);
}

/**
 * The lyrics button. Off, it turns lyrics on — in the drawer if the drawer is
 * out, in the player if not. On, it turns them off, and a drawer that was
 * showing them goes back to Spotify rather than shutting.
 */
export function pressLyrics(s: LyricsLayout): LyricsLayout {
  if (s.lyricsOn) return { ...s, lyricsOn: false };
  return { ...s, lyricsOn: true, lyricsPlace: s.drawerOpen ? 'full' : 'compact' };
}

/** The full view's "to the player" control: lyrics move out, Spotify comes back. */
export function toCompact(s: LyricsLayout): LyricsLayout {
  return { ...s, lyricsPlace: 'compact' };
}

/** The compact view's "expand" control: into the drawer, opening it if need be. */
export function expand(s: LyricsLayout): LyricsLayout {
  return { ...s, drawerOpen: true, lyricsOn: true, lyricsPlace: 'full' };
}

/**
 * The Spotify button. On a drawer showing lyrics it switches to Spotify, and
 * the lyrics carry on in the player; otherwise it opens or shuts the drawer as
 * it always has, and opening it this way always opens it on Spotify.
 */
export function pressSpotify(s: LyricsLayout): LyricsLayout {
  if (fullShown(s)) return { ...s, lyricsPlace: 'compact' };
  if (s.drawerOpen) return { ...s, drawerOpen: false };
  return { ...s, drawerOpen: true, lyricsPlace: 'compact' };
}

/** Anything that asks for Spotify outright — Settings' "set up Spotify". */
export function showSpotify(s: LyricsLayout): LyricsLayout {
  return { ...s, drawerOpen: true, lyricsPlace: 'compact' };
}

/**
 * The drawer's own close. Lyrics that were in it carry on in the player —
 * with the drawer shut that is where they are shown, whatever place they were
 * last put in, and every way of opening it again says which it opens on.
 */
export function closeDrawer(s: LyricsLayout): LyricsLayout {
  return { ...s, drawerOpen: false };
}
