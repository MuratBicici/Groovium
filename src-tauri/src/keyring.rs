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
//! SECURITY — this used to expose `vault_get_token` as a Tauri command, which
//! meant any script running in the webview could read any stored secret by name.
//! That is gone. Nothing here is callable from JavaScript any more; these are
//! plain Rust functions, used by `spotify::tokens` and nothing else.
//!
//! The rule that replaced it: a refresh token has no path out of this process.
//! The webview asks for a short-lived access token and Rust refreshes it
//! transparently — see `src/core/security/spotifyAuth.ts` for the surface that
//! is left.

use ::keyring::v1::{Entry, Error as KeyringError};

/// Service name under which all Groovium secrets are grouped in the OS store.
/// Kept in sync with the bundle identifier in `tauri.conf.json`. Changing it
/// orphans anything already stored, so settle it before the first release.
const SERVICE: &str = "com.groovium.desktop";

/// Reject anything that is not a well-formed `provider:key` account name.
///
/// Less load-bearing than it was, now that callers are all in-process, but it
/// still keeps one provider's namespace from colliding with another's and
/// catches a malformed name at the call site rather than in the OS store.
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
pub fn set_secret(account: &str, value: &str) -> Result<(), String> {
    entry_for(account)?
        .set_password(value)
        .map_err(|e| format!("Could not store credential: {e}"))
}

/// Read a secret. Returns `None` when nothing is stored, which is not an error.
pub fn get_secret(account: &str) -> Result<Option<String>, String> {
    match entry_for(account)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(format!("Could not read credential: {e}")),
    }
}

/// Remove a secret. Deleting something that was never stored is a no-op.
pub fn delete_secret(account: &str) -> Result<(), String> {
    match entry_for(account)?.delete_credential() {
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
