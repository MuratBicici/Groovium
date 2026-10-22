import { create } from 'zustand';
import { say } from '@/core/i18n';
import type { Restriction, TrackMetadata } from '@/core/types';

/**
 * Which Spotify songs play here, and as which release.
 *
 * A song is often on Spotify more than once — a single and the album, a
 * release for one country and another for the rest — and a track's URI names
 * one of them. Asked with the account's country, Spotify answers with the
 * release that plays there and names the one asked for as `linked_from`, or
 * says the song does not play here at all, and why (`toTrackMetadata`).
 * Search and playlists can be asked that way. The two shelves cannot — neither
 * top tracks nor recently played takes a country — so what they hold is only
 * found out by playing it: the provider asks again then (`playableVersion`),
 * and what it learns is kept here.
 *
 * Two things, then. Which release to play for a URI, for this session; and the
 * songs found not to play here at all, kept in the webview's storage for a
 * while — what is sold where changes — so a shelf shows them as such from then
 * on, rather than each one being found out again by pressing it.
 */

/** URI asked for → URI of the release that plays here. */
const relinks = new Map<string, string>();

/** Remember that `asked` plays here as `played`. */
export function noteRelinked(asked: string, played: string): void {
  if (asked !== played) relinks.set(asked, played);
}

/** The URI to ask Spotify to play for a track. */
export function releaseToPlay(uri: string): string {
  return relinks.get(uri) ?? uri;
}

/** The track a URI Spotify is playing stands for: what was asked for, where another release was played. */
export function askedFor(uri: string | null): string | null {
  for (const [asked, played] of relinks) if (played === uri) return asked;
  return uri;
}

/** How long a song found not to play here is taken not to: what is sold where changes. */
const KEPT_FOR_MS = 30 * 24 * 60 * 60_000;
/** Enough for anyone's shelves; the oldest go first. */
const KEEP = 500;
const STORAGE_KEY = 'groovium.unplayable';

interface Refused {
  reason: Restriction;
  at: number;
}

function read(): Record<string, Refused> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const now = Date.now();
    return Object.fromEntries(
      Object.entries(parsed as Record<string, Refused>).filter(
        ([, r]) => typeof r?.at === 'number' && now - r.at < KEPT_FOR_MS,
      ),
    );
  } catch {
    return {};
  }
}

function write(known: Record<string, Refused>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(known));
  } catch {
    // Only the next launch loses it, and pressing the song finds it out again.
  }
}

const useRefused = create<{ known: Record<string, Refused> }>(() => ({ known: read() }));

/** Remember that a song does not play here, and why. */
export function noteUnplayable(uri: string, reason: Restriction): void {
  const known = { ...useRefused.getState().known, [uri]: { reason, at: Date.now() } };
  const ids = Object.keys(known);
  if (ids.length > KEEP) {
    ids
      .sort((a, b) => (known[a]?.at ?? 0) - (known[b]?.at ?? 0))
      .slice(0, ids.length - KEEP)
      .forEach((id) => delete known[id]);
  }
  useRefused.setState({ known });
  write(known);
}

/** Why a song does not play here, or null when nothing says it does not. */
export function unplayable(track: Pick<TrackMetadata, 'id' | 'source' | 'unplayable'>): Restriction | null {
  if (track.source !== 'spotify') return null;
  return track.unplayable ?? useRefused.getState().known[track.id]?.reason ?? null;
}

/** The same, kept up to date for a component: a song found out while it is on screen changes there. */
export function useUnplayable(track: Pick<TrackMetadata, 'id' | 'source' | 'unplayable'>): Restriction | null {
  const learned = useRefused((s) => (track.source === 'spotify' ? s.known[track.id]?.reason : undefined));
  if (track.source !== 'spotify') return null;
  return track.unplayable ?? learned ?? null;
}

/** Why, in words. */
export function whyUnplayable(reason: Restriction): string {
  return say(`spotify.refused.${reason}`);
}
