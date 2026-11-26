import type { TrackMetadata } from '@/core/types';
import type { PlaybackContext, PlayerState } from '@/core/store/playerStore';
import { trackKey } from '@/core/station';
import { log, logAndWait } from '@/platform/log';

/**
 * Reloading the page by hand, and carrying on after it.
 *
 * Reload is what someone reaches for when something has got stuck, so it is a
 * way out rather than a reset: the song that was playing comes back where it
 * was, in the list it was playing from, with what was queued after it. And the
 * moment is written to the log with what the player was doing, because a
 * reload by hand is a report of a fault nobody wrote down.
 */

const KEY = 'groovium.reloadedWith';
/** Older than this, it was not left by the reload that is starting now. */
const FRESH_MS = 60_000;
/** How long the page waits for its line in the log before it goes anyway. */
const LOG_WAIT_MS = 400;

export interface ReloadSnapshot {
  at: number;
  playback: PlaybackContext;
  positionMs: number;
  shuffle: boolean;
  upNext: TrackMetadata[];
}

type Player = Pick<
  PlayerState,
  | 'activeProviderId'
  | 'currentTrack'
  | 'playbackState'
  | 'positionMs'
  | 'durationMs'
  | 'starting'
  | 'error'
  | 'playback'
  | 'shuffle'
  | 'upNext'
  | 'station'
>;

/** What the player was doing, as one line for the log. No titles: the log may be attached to a public report. */
export function describePlayer(player: Player): string {
  const parts = [
    `provider ${player.activeProviderId}`,
    `state ${player.playbackState}`,
    player.currentTrack
      ? `a ${player.currentTrack.source} song at ${Math.round(player.positionMs / 1000)} s of ${Math.round(player.durationMs / 1000)} s`
      : 'no song',
    player.starting ? `starting a ${player.starting.source} song` : null,
    `from ${player.playback.id.split(':')[0]} (${player.playback.index + 1} of ${player.playback.tracks.length})`,
    player.upNext.length > 0 ? `${player.upNext.length} queued` : null,
    player.station ? 'infinite play on' : null,
    player.error ? `showing an error: ${player.error}` : null,
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : null,
  ];
  return parts.filter(Boolean).join(', ');
}

/** What to carry over, or null when nothing was playing. */
export function snapshotOf(player: Player, now: number): ReloadSnapshot | null {
  if (player.playbackState !== 'PLAYING' || !player.currentTrack) return null;
  const { playback } = player;
  const here = playback.tracks[playback.index];
  // The song playing is not always the collection's own: one off the queue
  // plays without moving the collection's place. Then it is carried on alone,
  // and the collection is left where it was, after it.
  const playingOwn = here !== undefined && trackKey(here) === trackKey(player.currentTrack);
  return {
    at: now,
    playback: playingOwn ? playback : { id: 'single', tracks: [player.currentTrack], index: 0 },
    positionMs: player.positionMs,
    shuffle: player.shuffle,
    upNext: player.upNext.map((queued) => queued.track),
  };
}

/** Reload the page, keeping the song playing and writing the moment down. */
export async function reloadByHand(player: Player, how: 'menu' | 'key'): Promise<void> {
  const snapshot = snapshotOf(player, Date.now());
  if (snapshot) {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(snapshot));
    } catch {
      // A collection too large to keep: the song alone, then.
      try {
        sessionStorage.setItem(
          KEY,
          JSON.stringify({ ...snapshot, playback: { id: 'single', tracks: [player.currentTrack], index: 0 } }),
        );
      } catch {
        /* the reload still helps without it */
      }
    }
  }
  await Promise.race([
    logAndWait('info', 'app', `reloaded by hand (${how})`, describePlayer(player)),
    new Promise((resolve) => setTimeout(resolve, LOG_WAIT_MS)),
  ]);
  location.reload();
}

/** The snapshot a reload by hand left, taken so it is used once. */
export function takeSnapshot(now: number): ReloadSnapshot | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const snapshot = JSON.parse(raw) as ReloadSnapshot;
    if (now - snapshot.at > FRESH_MS || snapshot.playback.tracks.length === 0) return null;
    return snapshot;
  } catch {
    return null;
  }
}

interface Resumer {
  queueLast: (track: TrackMetadata) => void;
  playList: (id: PlaybackContext['id'], tracks: TrackMetadata[], shuffle?: boolean, from?: number) => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  current: () => TrackMetadata | null;
}

/** Carry on after a reload by hand, if one left something to carry on with. */
export async function resumeAfterReload(player: Resumer, now = Date.now()): Promise<void> {
  const snapshot = takeSnapshot(now);
  if (!snapshot) return;
  const { playback } = snapshot;
  const song = playback.tracks[playback.index];
  if (!song) return;
  log('info', 'app', `carrying on after the reload, ${Math.round(snapshot.positionMs / 1000)} s into a ${song.source} song`);
  for (const track of snapshot.upNext) player.queueLast(track);
  await player.playList(playback.id, playback.tracks, snapshot.shuffle, playback.index);
  const playing = player.current();
  // A second in is nowhere worth going back to.
  if (snapshot.positionMs > 1000 && playing && trackKey(playing) === trackKey(song)) await player.seek(snapshot.positionMs);
}
