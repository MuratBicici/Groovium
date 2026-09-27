import { isSpotifyAuthError } from '@/core/security/spotifyAuth';
import { describeAuthError } from '@/core/security/authErrors';

/**
 * Anything that was thrown, as a sentence somebody can be shown.
 *
 * Not everything thrown is an `Error`. A Tauri command that fails with a
 * structured error rejects with `{ code, detail }`, and `String()` of that is
 * the literal text "[object Object]" — which is what the player said, in its
 * error line, when a Spotify token could not be had. Those are turned into
 * the sentence that code has; anything else with a message says its message.
 */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isSpotifyAuthError(error)) return describeAuthError(error);
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return String(error);
}
