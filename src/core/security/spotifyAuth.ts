import { isTauri } from '@/core/utils/env';

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
  /** "premium" | "free" | "open" | "unknown". Playback needs premium. */
  product: string;
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
  await invoke('spotify_clear_client_id');
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
 * Run the full flow. Opens the system browser and resolves once the user has
 * approved and Rust has stored the refresh token.
 */
export async function beginAuth(): Promise<SpotifyAccount> {
  if (!isTauri()) throw { code: 'unsupported', detail: 'Spotify requires the desktop app.' };
  return invoke<SpotifyAccount>('spotify_begin_auth');
}

export async function signOut(): Promise<void> {
  if (!isTauri()) return;
  await invoke('spotify_sign_out');
}

/** Short-lived token for the Web Playback SDK. Rust refreshes it as needed. */
export async function accessToken(): Promise<string> {
  if (!isTauri()) throw { code: 'unsupported', detail: 'Spotify requires the desktop app.' };
  return invoke<string>('spotify_access_token');
}
