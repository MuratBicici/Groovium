import { isTauri } from '@/core/utils/env';
import { log } from '@/platform/log';

/**
 * The entire Spotify authentication surface available to the frontend.
 *
 * Note what is missing: there is no way to read a refresh token. It is written
 * to the OS credential store by Rust and read back only there, so a script
 * running in this webview has no path to it. The only credential that crosses
 * over is `accessToken()`, which expires in an hour and lives in memory.
 *
 * This replaced a generic `vault_get_token` command that could return any
 * stored secret by name.
 */

export interface SpotifyAccount {
  displayName: string;
  /** Spotify's own id, which is what tells your playlists from everybody else's. */
  id: string;
}

/** Structured failure from Rust. `code` is stable; `detail` is for the console. */
export interface SpotifyAuthError {
  code: string;
  detail: string;
}

export function isSpotifyAuthError(value: unknown): value is SpotifyAuthError {
  return typeof value === 'object' && value !== null && 'code' in value;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(command, args);
}

/**
 * Scopes this build needs that the stored token does not carry.
 *
 * Empty when there is nothing to ask for. A token issued before a scope existed
 * keeps its old grant through every refresh, so being signed in is not the same
 * as being allowed — and the difference has to be found before a request is
 * made, not after it comes back 403.
 */
export async function missingScopes(): Promise<string[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<string[]>('spotify_missing_scopes');
  } catch (err) {
    // Never a reason to block the drawer: an unanswerable question is not a
    // missing permission, and prompting on one would nag people whose grant is
    // fine. But it is not nothing either — if the command is not there, the
    // binary predates it, and the prompt that should be showing never will.
    // Silence here cost an afternoon once; it says so now.
    log('warn', 'spotifyAuth', 'could not read the granted scopes', err);
    return [];
  }
}

/** Whether a Client ID has been configured. The value itself is never returned. */
export async function hasClientId(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('spotify_has_client_id');
}

export async function setClientId(clientId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('spotify_set_client_id', { clientId });
}

export async function clearClientId(): Promise<void> {
  if (!isTauri()) return;
  // A different registration is a different set of authorised users, so who
  // was signed in under the old one is no longer the answer.
  //
  // Announced after the change rather than before it. Whoever hears about it
  // asks what the state is now — the drawer does, to decide what to show —
  // and asked first, the answer was still the old one: a Client ID on disk,
  // and a drawer that went on saying it was connected.
  try {
    await invoke('spotify_clear_client_id');
  } finally {
    forgetAccount();
  }
}

/**
 * The redirect URI the user must register, read from Rust rather than hardcoded
 * here — the copy button must never drift from the port actually being bound.
 */
export async function redirectUri(): Promise<string> {
  if (!isTauri()) return '';
  return invoke<string>('spotify_redirect_uri');
}

/**
 * Open the Spotify developer dashboard.
 *
 * Rust holds the URL and does the opening, so this webview never needs
 * permission to launch arbitrary addresses.
 */
export async function openDashboard(): Promise<void> {
  if (!isTauri()) return;
  await invoke('spotify_open_dashboard');
}

export async function isAuthenticated(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('spotify_is_authenticated');
}

/**
 * Who is signed in, asked once.
 *
 * The promise rather than the answer, so two callers in the same tick share
 * one request. That is not a rare case: the drawer asks on mount and the shelf
 * asks while filling, and in development React mounts every effect twice —
 * which was three `/me` requests for one drawer being opened.
 *
 * Held for the session because it cannot change during one. Which account this
 * is was fixed when the token was issued; signing out or signing in clears it
 * explicitly below.
 *
 * A failure is not remembered. Being unable to reach Spotify says nothing
 * about who is signed in, and a cached null would leave the shelf empty for
 * the rest of the session over one moment offline.
 */
let known: Promise<SpotifyAccount | null> | null = null;

/**
 * Who is signed in.
 *
 * Separate from `isAuthenticated`, which only asks whether a token is on disk:
 * this one reaches Spotify. The panel wants both — the cheap answer decides
 * what it shows, and this fills in the name.
 */
export async function account(): Promise<SpotifyAccount | null> {
  if (!isTauri()) return null;
  known ??= invoke<SpotifyAccount>('spotify_account').catch((err: unknown) => {
    known = null;
    throw err;
  });
  return known;
}

/**
 * Whoever keeps something about the account, told when the account changes.
 *
 * Called with `null` when somebody signs out or the Client ID is cleared, and
 * with the account when somebody signs in. Signing in is on the list because
 * it is not always preceded by signing out: a token revoked from Spotify's own
 * settings leaves the drawer disconnected without anything here having run,
 * and the next sign-in may be a different person.
 *
 * A listener rather than a call into the stores, because this module sits
 * underneath them — they import it — and the stores are what hold things.
 */
type AccountListener = (who: SpotifyAccount | null) => void;
const listeners = new Set<AccountListener>();

/** Be told when the account changes. Returns a function that stops it. */
export function onAccountChange(listener: AccountListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(who: SpotifyAccount | null): void {
  for (const listener of listeners) listener(who);
}

/** Forget who is signed in — the account has changed, or is going away. */
export function forgetAccount(): void {
  known = null;
  announce(null);
}

/**
 * Run the full flow. Opens the system browser and resolves once the user has
 * approved and Rust has stored the refresh token.
 */
export async function beginAuth(): Promise<SpotifyAccount> {
  if (!isTauri()) throw { code: 'unsupported', detail: 'Spotify requires the desktop app.' };
  const who = await invoke<SpotifyAccount>('spotify_begin_auth');
  // Signing in answers the question, so nobody has to ask it again.
  known = Promise.resolve(who);
  announce(who);
  return who;
}

export async function signOut(): Promise<void> {
  if (!isTauri()) return;
  // After, for the same reason as `clearClientId`: a listener asking whether
  // there is still a token must not be answered before it has been deleted.
  try {
    await invoke('spotify_sign_out');
  } finally {
    forgetAccount();
  }
}

/** Short-lived token for the Web Playback SDK. Rust refreshes it as needed. */
export async function accessToken(): Promise<string> {
  if (!isTauri()) throw { code: 'unsupported', detail: 'Spotify requires the desktop app.' };
  return invoke<string>('spotify_access_token');
}
