import type { SourceType } from '@/core/types';
import { StubProvider } from './StubProvider';

/**
 * YouTube Music — not implemented yet.
 *
 * Planned shape:
 *
 * - There is no official YouTube Music API. The realistic options are the
 *   YouTube Data API v3 for search/metadata plus the IFrame Player API for
 *   playback, or an unofficial internal-API client. Only the first is durable;
 *   the second breaks whenever Google changes the internals.
 * - Auth: Google OAuth 2.0 with PKCE via the system browser and a loopback
 *   redirect. Refresh token lives in the OS credential store.
 * - Playback through the IFrame player means an embedded iframe rather than an
 *   `HTMLAudioElement`, so `seek`/`setVolume` proxy to `postMessage` calls and
 *   progress comes from polling `getCurrentTime()` rather than `timeupdate`.
 * - Terms of Service: the IFrame player must stay visible and unobstructed at a
 *   minimum size. That conflicts with a 340x480 audio-only widget and needs a
 *   deliberate design answer before this ships.
 */
export class YTMusicProvider extends StubProvider {
  readonly id: SourceType = 'ytmusic';
  readonly displayName = 'YouTube Music';
}
