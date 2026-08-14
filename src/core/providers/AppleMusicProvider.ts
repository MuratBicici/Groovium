import type { SourceType } from '@/core/types';
import { StubProvider } from './StubProvider';

/**
 * Apple Music — not implemented yet.
 *
 * Planned shape:
 *
 * - Playback goes through MusicKit JS, which requires a developer token signed
 *   with an ES256 key issued from a paid Apple Developer account. The signing
 *   key must never ship inside the app; the token is generated out of band and
 *   stored in the OS credential store like any other secret.
 * - Auth: MusicKit's own `authorize()` returns a Music User Token. That token is
 *   the credential to persist, not a standard OAuth refresh token.
 * - MusicKit JS expects a browser environment and loads from Apple's CDN, which
 *   means the CSP in `src-tauri/tauri.conf.json` has to allow it explicitly.
 *   Keep that allowance as narrow as possible.
 * - `play(trackId)` takes an Apple Music catalog id.
 */
export class AppleMusicProvider extends StubProvider {
  readonly id: SourceType = 'applemusic';
  readonly displayName = 'Apple Music';
}
