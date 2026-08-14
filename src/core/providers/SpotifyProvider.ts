import type { SourceType } from '@/core/types';
import { StubProvider } from './StubProvider';

/**
 * Spotify — not implemented yet.
 *
 * Planned shape, recorded here so the eventual implementation does not have to
 * rediscover the constraints:
 *
 * - Auth: Authorization Code + PKCE, opened in the system browser and caught by
 *   a loopback redirect on 127.0.0.1. No client secret ships in the app, and no
 *   intermediary server is involved. The refresh token goes straight into the OS
 *   credential store from Rust — see `src/core/security/tokenVault.ts` for why
 *   it must never round-trip through JS.
 * - Playback: the Web Playback SDK needs a Premium account and a browser context
 *   with EME/Widevine. WebView2 has it; WKWebView on macOS does not, so macOS
 *   likely needs the Connect API driving an external device instead. Decide this
 *   before committing to a playback path.
 * - `play(trackId)` takes a Spotify URI; `TrackMetadata.id` carries it verbatim.
 * - Scopes: streaming, user-read-playback-state, user-modify-playback-state,
 *   user-read-currently-playing.
 */
export class SpotifyProvider extends StubProvider {
  readonly id: SourceType = 'spotify';
  readonly displayName = 'Spotify';
}
