import type { AuthResult, SourceType } from '@/core/types';
import { beginAuth, accessToken, isAuthenticated } from '@/core/security/spotifyAuth';
import { clamp } from '@/core/utils/time';
import { BaseProvider } from './BaseProvider';
import { playOnDevice } from './spotifyApi';

/**
 * Spotify playback through the Web Playback SDK.
 *
 * The SDK turns this app into a Spotify device: audio comes out of Groovium
 * rather than out of a separate Spotify client. That needs Premium and Widevine
 * (verified present in WebView2; WKWebView on macOS has none, so this provider
 * will not work there).
 *
 * The interesting part of this file is what it did NOT require: `AudioProvider`
 * in `src/core/types/provider.ts` is unchanged. A streaming source with an
 * entirely different transport, auth model and event shape fits the same
 * contract as an `HTMLAudioElement`, which is the thing Phase 1 was betting on.
 */

const SDK_SCRIPT = 'https://sdk.scdn.co/spotify-player.js';
const PLAYER_NAME = 'Groovium';

/**
 * How often to advance the position clock while playing.
 *
 * The SDK reports state on change, not continuously — unlike the local
 * provider's `timeupdate`. Without a local ticker the progress bar would sit
 * still between tracks. 250ms matches the roughly 4Hz the local provider emits,
 * so the UI behaves the same either way.
 */
const PROGRESS_TICK_MS = 250;

/** How long to wait for Spotify to register this app as a playback device. */
const DEVICE_READY_TIMEOUT_MS = 10_000;

/**
 * A script tag that never loads also never errors, so without a deadline a
 * blocked CDN would leave `initialize()` pending forever — and with it every
 * caller awaiting it.
 */
const SDK_LOAD_TIMEOUT_MS = 15_000;

// Minimal shape of the globals the SDK installs.
interface SpotifyPlayerState {
  paused: boolean;
  position: number;
  duration: number;
  track_window: { current_track: { uri: string; name: string } | null };
}

interface SpotifyPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  addListener(event: string, cb: (payload: never) => void): boolean;
}

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: {
      Player: new (options: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume?: number;
      }) => SpotifyPlayer;
    };
  }
}

export class SpotifyProvider extends BaseProvider {
  readonly id: SourceType = 'spotify';
  readonly displayName = 'Spotify';

  private player: SpotifyPlayer | null = null;
  private deviceId: string | null = null;
  private volume = 1;

  /** Local position clock, since the SDK does not stream progress. */
  private ticker: ReturnType<typeof setInterval> | null = null;
  private positionMs = 0;
  private durationMs = 0;
  private lastTickAt = 0;

  async initialize(): Promise<boolean> {
    if (this.player) return true;
    if (!(await isAuthenticated())) {
      // Say why. Otherwise the store falls back to "Spotify is unavailable",
      // which tells the user nothing about what to do next.
      this.emit({
        type: 'error',
        error: 'Connect your Spotify account first — open the Spotify panel.',
      });
      return false;
    }

    try {
      await loadSdk();
      const player = new window.Spotify!.Player({
        name: PLAYER_NAME,
        // Called on connect and again whenever the token expires. Rust refreshes
        // transparently, so this always hands back a live token.
        getOAuthToken: (cb) => {
          void accessToken().then(cb, (err) => this.fail(describe(err)));
        },
        volume: this.volume,
      });

      this.attachListeners(player);

      if (!(await player.connect())) {
        this.fail('Spotify refused the connection.');
        return false;
      }

      this.player = player;
      this.setState('IDLE');
      return true;
    } catch (err) {
      this.fail(describe(err));
      return false;
    }
  }

  async authenticate(): Promise<AuthResult> {
    try {
      await beginAuth();
      return { success: true };
    } catch (err) {
      return { success: false, error: describe(err) };
    }
  }

  /** `trackId` is a Spotify track URI, as carried in `TrackMetadata.id`. */
  async play(trackId: string): Promise<void> {
    if (!this.player) throw new Error('Spotify player is not connected.');

    this.setState('LOADING');
    try {
      // `connect()` resolving does not mean Spotify has registered the device;
      // that arrives later on the `ready` event. Picking a track inside that
      // window is entirely normal, so wait for it rather than failing.
      const deviceId = await this.waitForDevice();
      await playOnDevice(deviceId, trackId);
      // Starting playback through the Web API can hand the device back its own
      // default volume, so the setting is applied again once playback is on.
      await this.player.setVolume(this.volume);
      // State arrives via player_state_changed; PLAYING is not set here.
    } catch (err) {
      this.fail(describe(err));
      throw err;
    }
  }

  async pause(): Promise<void> {
    await this.player?.pause();
  }

  async resume(): Promise<void> {
    await this.player?.resume();
  }

  async seek(positionMs: number): Promise<void> {
    if (!this.player) return;
    const target = clamp(positionMs, 0, this.durationMs || positionMs);
    await this.player.seek(target);
    this.positionMs = target;
    this.emitProgress();
  }

  /** Linear amplitude, matching the contract; the SDK uses the same scale. */
  async setVolume(volume: number): Promise<void> {
    this.volume = clamp(volume, 0, 1);
    await this.player?.setVolume(this.volume);
  }

  override dispose(): void {
    this.stopTicker();
    this.player?.disconnect();
    this.player = null;
    this.deviceId = null;
    this.currentTrack = null;
    this.state = 'IDLE';
    super.dispose();
  }


  /**
   * Block until Spotify has registered this app as a device.
   *
   * Failing outright would turn an ordinary few-hundred-millisecond startup
   * delay into an error the user has to work around by clicking again.
   */
  private async waitForDevice(): Promise<string> {
    const deadline = Date.now() + DEVICE_READY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      if (this.deviceId) return this.deviceId;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(
      'Spotify never finished connecting. Check your connection, and that the account is Premium.',
    );
  }

  private attachListeners(player: SpotifyPlayer): void {
    player.addListener('ready', ((payload: { device_id: string }) => {
      this.deviceId = payload.device_id;
      // The volume the store pushed during `initialize` was set before Spotify
      // had registered the device, so it went nowhere. Re-assert it now that
      // there is something to apply it to — otherwise the first track plays at
      // the SDK's default however low the control says.
      void player.setVolume(this.volume);
    }) as never);

    player.addListener('not_ready', (() => {
      this.deviceId = null;
      // The null-state branch below stops the ticker and this one did not, so
      // handing playback to another device left a 250ms interval reporting
      // progress for a device we no longer drive.
      this.stopTicker();
      this.setState('IDLE');
    }) as never);

    for (const event of ['initialization_error', 'authentication_error', 'account_error', 'playback_error']) {
      player.addListener(event, ((payload: { message: string }) => {
        // `account_error` is how a non-Premium account surfaces, well after
        // sign-in succeeded.
        this.fail(
          event === 'account_error'
            ? 'Spotify playback requires a Premium subscription.'
            : payload.message,
        );
      }) as never);
    }

    player.addListener('player_state_changed', ((state: SpotifyPlayerState | null) => {
      if (!state) {
        // Null state means playback moved to another device.
        this.stopTicker();
        this.setState('IDLE');
        return;
      }
      this.onStateChanged(state);
    }) as never);
  }

  private onStateChanged(state: SpotifyPlayerState): void {
    const wasPlaying = this.state === 'PLAYING';
    this.durationMs = state.duration;
    this.positionMs = state.position;
    this.lastTickAt = Date.now();

    // What the player says it is on. The store owns the metadata — it came from
    // the Web API when the track was queued, with artwork this state does not
    // carry as well — so nothing is republished here. Only the identity is
    // taken, and only because `ended` has to name what finished.
    const track = state.track_window.current_track;

    if (state.paused) {
      this.stopTicker();
      // Spotify has no "ended" event. A track that stops on its own lands at
      // paused with the position back at zero, which a user-initiated pause
      // never does — that difference is the only signal available.
      if (wasPlaying && state.position === 0) {
        this.setState('IDLE');
        // From the player's own state, not from `this.currentTrack` — which
        // this provider never assigns, so the payload was always null and the
        // store's stale-`ended` guard (`trackId !== null && …`) could not fire
        // for Spotify at all.
        this.emit({ type: 'ended', trackId: track?.uri ?? null });
        return;
      }
      this.setState('PAUSED');
    } else {
      this.setState('PLAYING');
      this.startTicker();
    }

    this.emitProgress();
  }

  private startTicker(): void {
    if (this.ticker) return;
    this.lastTickAt = Date.now();
    this.ticker = setInterval(() => {
      const now = Date.now();
      this.positionMs = Math.min(this.positionMs + (now - this.lastTickAt), this.durationMs);
      this.lastTickAt = now;
      this.emitProgress();
    }, PROGRESS_TICK_MS);
  }

  private stopTicker(): void {
    if (!this.ticker) return;
    clearInterval(this.ticker);
    this.ticker = null;
  }

  private emitProgress(): void {
    this.emit({
      type: 'progress',
      positionMs: this.positionMs,
      durationMs: this.durationMs,
    });
  }
}

/** Load the SDK once, resolving when it has announced itself. */
let sdkPromise: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sdkPromise = null;
      reject(new Error('Timed out loading the Spotify player. Check your connection.'));
    }, SDK_LOAD_TIMEOUT_MS);

    // The SDK calls this global rather than resolving anything itself.
    window.onSpotifyWebPlaybackSDKReady = () => {
      clearTimeout(timer);
      resolve();
    };

    const script = document.createElement('script');
    script.src = SDK_SCRIPT;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      sdkPromise = null;
      reject(new Error('Could not load the Spotify player. Check your connection.'));
    };
    document.head.appendChild(script);
  });

  return sdkPromise;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
