import type { SourceType } from '@/core/types';
import { isTauri } from '@/core/utils/env';

/**
 * Bridge to the OS credential store (DPAPI / Keychain / Secret Service) exposed
 * by `src-tauri/src/keyring.rs`.
 *
 * SECURITY — read before building on this.
 *
 * These commands let the webview read a stored secret by name. That is fine for
 * Phase 1, where nothing is stored yet, but it does NOT satisfy the project's
 * zero-knowledge goal on its own: any script running in the webview (an injected
 * bug, a compromised dependency, a provider SDK loaded from a CDN) can call
 * `getToken` and exfiltrate a long-lived refresh token.
 *
 * The intended end state, to be built alongside the first real OAuth provider:
 *
 *   1. Refresh tokens are written and read only inside Rust. `vault_get_token`
 *      gets scoped so refresh-token keys are not reachable from JS at all.
 *   2. Rust owns the refresh call and hands the webview only short-lived access
 *      tokens, held in memory and never persisted.
 *   3. The Tauri capability for these commands is narrowed to the main window.
 *
 * Until then, treat anything reachable through here as readable by the webview.
 */

/** Namespaced so one provider cannot read another's secrets by guessing a key. */
export type VaultKey = 'access_token' | 'refresh_token' | 'user_token' | 'developer_token';

function accountFor(provider: SourceType, key: VaultKey): string {
  return `${provider}:${key}`;
}

function unavailable(operation: string): void {
  console.warn(
    `[tokenVault] ${operation} is a no-op outside Tauri — there is no OS credential store in a plain browser.`,
  );
}

export async function setToken(
  provider: SourceType,
  key: VaultKey,
  value: string,
): Promise<void> {
  if (!isTauri()) return unavailable('setToken');
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('vault_set_token', { account: accountFor(provider, key), value });
}

export async function getToken(provider: SourceType, key: VaultKey): Promise<string | null> {
  if (!isTauri()) {
    unavailable('getToken');
    return null;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string | null>('vault_get_token', { account: accountFor(provider, key) });
}

export async function deleteToken(provider: SourceType, key: VaultKey): Promise<void> {
  if (!isTauri()) return unavailable('deleteToken');
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('vault_delete_token', { account: accountFor(provider, key) });
}
