/**
 * The unified contract every music source must satisfy.
 *
 * Nothing above this layer (store, components) is allowed to know which service
 * is actually playing. Adding Spotify or Apple Music should mean writing one new
 * class in `src/core/providers/` and registering it — no store or UI changes.
 */

/** Which backend a track came from. */
export type SourceType = 'local' | 'spotify' | 'ytmusic' | 'applemusic';

/** Normalized track shape. Every provider maps its own API onto this. */
export interface TrackMetadata {
  id: string;
  title: string;
  artist: string;
  album: string;
  /** Milliseconds. Chosen over seconds so it lines up with `seek(positionMs)`. */
  duration: number;
  coverArtUrl?: string;
  source: SourceType;
}

export type PlaybackState = 'IDLE' | 'LOADING' | 'PLAYING' | 'PAUSED' | 'ERROR';

/** Result of an `authenticate()` call. Local files always succeed trivially. */
export interface AuthResult {
  success: boolean;
  /**
   * Never a refresh token. Long-lived secrets stay in the OS credential store,
   * reachable only from Rust — see `src/core/security/spotifyAuth.ts`.
   */
  accessToken?: string;
  expiresAt?: number;
  error?: string;
}

/**
 * Push notifications from a provider to the store.
 *
 * The spec's method list is pull-only, which would force the store to poll for
 * playback position and never learn about a track ending at all. This event
 * channel is the additive piece that lets the store stay passive and keeps the
 * UI fully decoupled from provider internals.
 */
export type ProviderEvent =
  | { type: 'state'; state: PlaybackState }
  | { type: 'progress'; positionMs: number; durationMs: number }
  | { type: 'track'; track: TrackMetadata | null }
  /**
   * `trackId` names what finished. Without it the store cannot tell a genuine
   * end from the previous track's event arriving just after the user started a
   * new one — a race that skipped the freshly clicked song.
   */
  | { type: 'ended'; trackId: string | null }
  | { type: 'error'; error: string };

export type ProviderEventListener = (event: ProviderEvent) => void;

export interface AudioProvider {
  /** Stable identity, also used as the registry key. */
  readonly id: SourceType;
  /** Human-readable name for source pickers. */
  readonly displayName: string;

  /** Prepare the provider (SDK load, element setup). Resolves false if unusable. */
  initialize(): Promise<boolean>;

  /** Run the provider's auth flow. Local playback needs none and returns success. */
  authenticate(): Promise<AuthResult>;

  /** Load and start the given track. Resolves once playback has begun. */
  play(trackId: string): Promise<void>;

  pause(): Promise<void>;
  resume(): Promise<void>;

  /** Absolute position in milliseconds from the start of the track. */
  seek(positionMs: number): Promise<void>;

  /**
   * Linear amplitude, 0..1. Providers clamp out-of-range values.
   *
   * Not what the volume control shows: the store holds a perceptual position and
   * applies the loudness curve (`src/core/utils/volume.ts`) before calling this.
   * A provider whose backend wants something else — decibels, 0..100 — converts
   * from linear amplitude here.
   */
  setVolume(volume: number): Promise<void>;

  getState(): PlaybackState;
  getCurrentTrack(): TrackMetadata | null;

  /** Subscribe to playback events. Returns the unsubscribe function. */
  subscribe(listener: ProviderEventListener): () => void;

  /** Release audio elements, timers, SDK handles and object URLs. */
  dispose(): void;
}
