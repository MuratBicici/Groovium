import { usePlayerStore } from '@/core/store';
import type { PlaybackState, TrackMetadata } from '@/core/types';
import { isTauri } from '@/core/utils/env';
import { coverOf, forgetCover } from '@/platform/coverImage';
import { log } from '@/platform/log';

/**
 * Windows' media controls: what it shows as the music playing, over the volume
 * keys, on the lock screen and in quick settings (`src-tauri/src/smtc.rs`).
 *
 * Rust holds the session; this tells it what is playing — the song, whether it
 * plays, how long it is and where it is, and its cover — and hands a move on
 * Windows' timeline to the player. The buttons come back through the command
 * bridge like the tray's.
 */

/** Must match `SEEK_EVENT` in `src-tauri/src/smtc.rs`. */
const SEEK_EVENT = 'media:seek';

/** How often the position is brought up to date while playing; Windows counts on between. */
const POSITION_EVERY_MS = 5000;

/** The side of the cover Windows is given. */
const COVER_SIDE = 300;

export interface SmtcState {
  status: 'playing' | 'paused' | 'loading' | 'none';
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  positionMs: number;
}

/** What Windows should show for the player as it is. */
export function smtcState(
  track: TrackMetadata | null,
  playback: PlaybackState,
  positionMs: number,
  durationMs: number,
): SmtcState {
  if (!track) return { status: 'none', title: '', artist: '', album: '', durationMs: 0, positionMs: 0 };
  return {
    status: playback === 'PLAYING' ? 'playing' : playback === 'LOADING' ? 'loading' : 'paused',
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: Math.max(0, Math.round(durationMs || track.duration || 0)),
    positionMs: Math.max(0, Math.round(positionMs)),
  };
}

async function invoke(command: string, args?: unknown) {
  const core = await import('@tauri-apps/api/core');
  return core.invoke(command, args as never);
}

/** The cover as JPEG bytes, square; empty when there is none to give. */
async function coverBytes(track: TrackMetadata, image: HTMLImageElement | null): Promise<Uint8Array> {
  if (!image) return new Uint8Array();
  const canvas = document.createElement('canvas');
  canvas.width = COVER_SIDE;
  canvas.height = COVER_SIDE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new Uint8Array();
  const scale = Math.max(COVER_SIDE / image.naturalWidth, COVER_SIDE / image.naturalHeight);
  const w = image.naturalWidth * scale;
  const h = image.naturalHeight * scale;
  ctx.drawImage(image, (COVER_SIDE - w) / 2, (COVER_SIDE - h) / 2, w, h);
  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(resolve, 'image/jpeg', 0.9);
    } catch {
      // Drawn but not readable back: from somewhere that would not allow it.
      forgetCover(track.coverArtUrl);
      resolve(null);
    }
  });
  return blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array();
}

/** Begin telling Windows. Returns a function that stops. */
export function startMediaControls(): () => void {
  if (!isTauri()) return () => {};

  let sentState = '';
  const sendState = () => {
    const { currentTrack, playbackState, positionMs, durationMs } = usePlayerStore.getState();
    const state = smtcState(currentTrack, playbackState, positionMs, durationMs);
    const key = JSON.stringify(state);
    if (key === sentState) return;
    sentState = key;
    void invoke('smtc_state', { state }).catch((err: unknown) => {
      sentState = '';
      log('warn', 'media controls', 'could not tell Windows what is playing', err);
    });
  };

  /** The cover last handed over, by song, so each is sent once. */
  let coverFor: string | null = null;
  const sendCover = () => {
    const track = usePlayerStore.getState().currentTrack;
    const key = track ? `${track.id}|${track.coverArtUrl ?? ''}` : '';
    if (key === coverFor) return;
    const image = track ? coverOf(track.coverArtUrl, sendCover) : null;
    // Still loading: sent when it arrives.
    if (track?.coverArtUrl && !image) return;
    coverFor = key;
    void (track ? coverBytes(track, image) : Promise.resolve(new Uint8Array()))
      .then((bytes) => invoke('smtc_cover', bytes))
      .catch((err: unknown) => {
        coverFor = null;
        log('warn', 'media controls', 'could not give Windows the cover', err);
      });
  };

  const unsubscribe = usePlayerStore.subscribe((s, prev) => {
    const moved = Math.abs(s.positionMs - prev.positionMs) > 2000;
    if (
      s.currentTrack !== prev.currentTrack ||
      s.playbackState !== prev.playbackState ||
      s.durationMs !== prev.durationMs ||
      moved
    ) {
      sendState();
    }
    if (s.currentTrack !== prev.currentTrack) sendCover();
  });
  // Windows counts the position on by itself while playing; this keeps it honest.
  const ticking = setInterval(() => {
    if (usePlayerStore.getState().playbackState === 'PLAYING') sendState();
  }, POSITION_EVERY_MS);

  let unlisten: (() => void) | null = null;
  let stopped = false;
  void import('@tauri-apps/api/event')
    .then(({ listen }) =>
      listen<number>(SEEK_EVENT, (event) => {
        void usePlayerStore.getState().seek(event.payload);
      }),
    )
    .then((stop) => {
      if (stopped) stop();
      else unlisten = stop;
    })
    .catch((err: unknown) => log('warn', 'media controls', 'could not listen for moves on the timeline', err));

  sendState();
  sendCover();

  return () => {
    stopped = true;
    unlisten?.();
    unsubscribe();
    clearInterval(ticking);
  };
}
