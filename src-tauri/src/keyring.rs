//! Bridge to the OS credential store.
//!
//! Windows Credential Manager (DPAPI), macOS Keychain, or the Secret Service on
//! *nix — the `keyring` crate picks the right one per platform. Nothing is ever
//! written to a file this app controls, which is what keeps the project's
//! zero-knowledge promise honest: no intermediary server, and no plaintext
//! secrets on disk.
//!
//! Note on paths: this module is named `keyring` and so is the crate it uses, so
//! every reference to the crate is written as `::keyring` to disambiguate.
//!
//! SECURITY — see the matching note in `src/core/security/tokenVault.ts`. These
//! commands are currently reachable from any JavaScript running in the webview.
//! Before the first real OAuth provider ships, `vault_get_token` must be scoped
//! so refresh tokens stay inside Rust and only short-lived access tokens cross
//! into JS.

use ::keyring::v1::{Entry, Error as KeyringError};

/// Service name under which all Groovium secrets are grouped in the OS store.
/// Kept in sync with the bundle identifier in `tauri.conf.json`. Changing it
/// orphans anything already stored, so settle it before the first release.
const SERVICE: &str = "com.groovium.desktop";

/// Reject anything that is not a well-formed `provider:key` account name, so a
/// caller cannot reach outside its own namespace.
fn validate_account(account: &str) -> Result<(), String> {
    let mut parts = account.split(':');
    let provider = parts.next().unwrap_or_default();
    let key = parts.next().unwrap_or_default();

    if parts.next().is_some() || provider.is_empty() || key.is_empty() {
        return Err(format!("Invalid vault account name: {account:?}"));
    }
    if !account
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == ':')
    {
        return Err(format!("Invalid vault account name: {account:?}"));
    }
    Ok(())
}

fn entry_for(account: &str) -> Result<Entry, String> {
    validate_account(account)?;
    Entry::new(SERVICE, account).map_err(|e| format!("Credential store unavailable: {e}"))
}

/// Store a secret. Overwrites any existing value for the same account.
#[tauri::command]
pub fn vault_set_token(account: String, value: String) -> Result<(), String> {
    entry_for(&account)?
        .set_password(&value)
        .map_err(|e| format!("Could not store credential: {e}"))
}

/// Read a secret. Returns `None` when nothing is stored, which is not an error.
#[tauri::command]
pub fn vault_get_token(account: String) -> Result<Option<String>, String> {
    match entry_for(&account)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(format!("Could not read credential: {e}")),
    }
}

/// Remove a secret. Deleting something that was never stored is a no-op.
#[tauri::command]
pub fn vault_delete_token(account: String) -> Result<(), String> {
    match entry_for(&account)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not delete credential: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::validate_account;

    #[test]
    fn accepts_provider_scoped_names() {
        assert!(validate_account("spotify:refresh_token").is_ok());
    }

    #[test]
    fn rejects_malformed_names() {
        for bad in ["", "spotify", "spotify:", ":token", "a:b:c", "sp otify:token"] {
            assert!(validate_account(bad).is_err(), "should reject {bad:?}");
        }
    }
}
