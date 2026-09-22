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

/**
 * Whether the Spotify button is lit.
 *
 * It says the drawer is out, not what is in it. Lyrics taking the drawer over
 * do not put the drawer away, and a light that went out for them would be
 * saying they had — with the drawer still there, wider than the player, in
 * plain sight.
 */
export function drawerOut(s: LyricsLayout): boolean {
  return s.drawerOpen;
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
 * The Spotify button: the drawer, out or away.
 *
 * Out — showing Spotify or showing lyrics — it puts the drawer away, and
 * lyrics that were in it carry on in the player. The same press for both,
 * because the light is on for both: a button that is lit and does nothing
 * recognisable to what is lighting it is the one thing a toggle must not be.
 *
 * Away, it brings the drawer out on Spotify, never on lyrics.
 *
 * Swapping the drawer's lyrics for Spotify without shutting it is still one
 * press — the lyrics view's own control for going back to the player, which is
 * where somebody looking at the lyrics is already looking.
 */
export function pressSpotify(s: LyricsLayout): LyricsLayout {
  if (s.drawerOpen) return { ...s, drawerOpen: false, lyricsPlace: 'compact' };
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
  return { ...s, drawerOpen: false, lyricsPlace: 'compact' };
}
