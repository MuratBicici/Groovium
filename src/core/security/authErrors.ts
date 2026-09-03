import { isSpotifyAuthError } from './spotifyAuth';

/**
 * Turns Rust's error codes into something a user can act on.
 *
 * Spotify's own messages are close to useless here — a mistyped Client ID and a
 * redirect URI missing from the dashboard both come back as `INVALID_CLIENT`,
 * and an account that simply is not on the app's user list arrives as a bare
 * `access_denied`. Each of those needs a different fix, so each gets its own
 * sentence naming the fix.
 *
 * Keys must stay in step with `ALL_CODES` in `src-tauri/src/spotify/error.rs`.
 * A code with no entry here falls back to the generic message, which is exactly
 * the unhelpful outcome this file exists to avoid.
 */
const MESSAGES: Record<string, string> = {
  no_client_id: 'No Client ID yet. Finish the setup steps to continue.',
  invalid_client_id:
    "That does not look like a Client ID. It is 32 characters of hex — check you did not paste the Client Secret or a URL.",
  invalid_client:
    "Spotify did not recognise that Client ID. Check it against your app in the Spotify dashboard.",
  redirect_uri_mismatch:
    'Your Spotify app is missing the redirect URI. Add it exactly as shown in the setup steps, with no trailing slash.',
  access_denied:
    'Spotify refused the request. Either you declined it, or this account is not on your app’s user list — add it under User Management in the dashboard.',
  state_mismatch:
    'The response did not match the request that started it, so it was rejected. Try connecting again.',
  port_busy:
    'Port 14536 is in use, so the sign-in response cannot arrive. Close whatever is using it and try again.',
  timeout: 'Timed out waiting for Spotify. Try connecting again.',
  token_exchange_failed: 'Spotify returned something unexpected while signing in.',
  keyring_failed: 'Could not reach the system credential store to save your session.',
  not_authenticated: 'Not signed in to Spotify.',
  network: 'Could not reach Spotify. Check your internet connection.',
  unsupported: 'Spotify is only available in the desktop app.',
};

const FALLBACK = 'Could not connect to Spotify.';

/** Every code this module knows how to explain. Used to check coverage. */
export const HANDLED_CODES = Object.keys(MESSAGES);

/**
 * Message to show the user, with the raw detail logged for debugging.
 *
 * Accepts `unknown` because anything can be thrown across the Tauri boundary.
 */
export function describeAuthError(error: unknown): string {
  if (!isSpotifyAuthError(error)) {
    console.warn('[spotifyAuth] unrecognised failure', error);
    return FALLBACK;
  }

  const message = MESSAGES[error.code];
  if (!message) {
    console.warn(`[spotifyAuth] no message for code "${error.code}"`, error.detail);
    return FALLBACK;
  }

  // The detail is never shown, but it is what makes a bug report useful.
  console.info(`[spotifyAuth] ${error.code}: ${error.detail}`);
  return message;
}
