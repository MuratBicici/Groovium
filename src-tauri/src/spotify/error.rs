//! Machine-readable authentication errors.
//!
//! Spotify's own messages are useless to a user — a mistyped Client ID and an
//! unregistered redirect URI both surface as `INVALID_CLIENT`. Rust classifies
//! the failure into a stable `code`; the frontend turns that code into a
//! sentence telling the user what to fix (`src/core/security/authErrors.ts`).
//!
//! `detail` carries the raw text for the console. It is never the thing shown
//! to the user.

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthError {
    /// Stable identifier the frontend switches on. Changing one of these
    /// silently drops the user back to a generic message, so they are covered
    /// by a test on both sides.
    pub code: String,
    pub detail: String,
}

impl AuthError {
    pub fn new(code: &str, detail: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
            detail: detail.into(),
        }
    }
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.detail)
    }
}

/// Every code this module can produce.
///
/// Exists so the frontend's mapping can be checked for completeness rather than
/// discovering a missing case in front of a user.
pub const ALL_CODES: &[&str] = &[
    "no_client_id",
    "invalid_client_id",
    "invalid_client",
    "redirect_uri_mismatch",
    "port_busy",
    "state_mismatch",
    "access_denied",
    "timeout",
    "token_exchange_failed",
    "keyring_failed",
    "not_authenticated",
    "network",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_unique() {
        let mut sorted = ALL_CODES.to_vec();
        sorted.sort_unstable();
        let before = sorted.len();
        sorted.dedup();
        assert_eq!(sorted.len(), before, "duplicate code in ALL_CODES");
    }

    #[test]
    fn codes_are_snake_case_identifiers() {
        // The frontend uses these as object keys and in a switch; anything with
        // punctuation or spaces would be a silent mismatch.
        for code in ALL_CODES {
            assert!(
                code.chars().all(|c| c.is_ascii_lowercase() || c == '_'),
                "{code:?} is not a snake_case identifier"
            );
        }
    }
}
