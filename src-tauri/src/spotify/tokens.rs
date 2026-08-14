//! Token storage and refresh.
//!
//! The refresh token is written to the OS credential store and read back only
//! here. It is never returned from a Tauri command, so there is no path by which
//! a script in the webview could obtain it — that is the whole point of the
//! change that removed the generic vault commands.
//!
//! The webview asks for an access token instead. Those last an hour, live in
//! memory, and are re-minted here when they expire.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Deserialize;

use crate::keyring;
use crate::spotify::error::AuthError;

const REFRESH_TOKEN_ACCOUNT: &str = "spotify:refresh_token";
const TOKEN_ENDPOINT: &str = "https://accounts.spotify.com/api/token";

/// Refresh slightly early so a request cannot set off with a token that expires
/// while it is in flight.
const EXPIRY_MARGIN: Duration = Duration::from_secs(60);

#[derive(Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub expires_in: u64,
    /// Absent when refreshing — Spotify only re-issues it sometimes.
    pub refresh_token: Option<String>,
}

struct CachedToken {
    value: String,
    expires_at: Instant,
}

/// In-memory access token, managed as Tauri state.
#[derive(Default)]
pub struct AccessTokenCache(Mutex<Option<CachedToken>>);

impl AccessTokenCache {
    fn get(&self) -> Option<String> {
        let guard = self.0.lock().ok()?;
        let cached = guard.as_ref()?;
        (cached.expires_at > Instant::now()).then(|| cached.value.clone())
    }

    pub fn put(&self, value: &str, expires_in: u64) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = Some(CachedToken {
                value: value.to_owned(),
                expires_at: Instant::now() + Duration::from_secs(expires_in).saturating_sub(EXPIRY_MARGIN),
            });
        }
    }

    pub fn clear(&self) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = None;
        }
    }
}

pub fn store_refresh_token(token: &str) -> Result<(), AuthError> {
    keyring::set_secret(REFRESH_TOKEN_ACCOUNT, token)
        .map_err(|e| AuthError::new("keyring_failed", e))
}

pub fn refresh_token() -> Result<Option<String>, AuthError> {
    keyring::get_secret(REFRESH_TOKEN_ACCOUNT).map_err(|e| AuthError::new("keyring_failed", e))
}

pub fn forget() -> Result<(), AuthError> {
    keyring::delete_secret(REFRESH_TOKEN_ACCOUNT)
        .map_err(|e| AuthError::new("keyring_failed", e))
}

pub fn is_authenticated() -> bool {
    matches!(refresh_token(), Ok(Some(_)))
}

/// Return a usable access token, refreshing if the cached one has expired.
pub async fn access_token(
    cache: &AccessTokenCache,
    client_id: &str,
) -> Result<String, AuthError> {
    if let Some(cached) = cache.get() {
        return Ok(cached);
    }

    let Some(refresh) = refresh_token()? else {
        return Err(AuthError::new(
            "not_authenticated",
            "No stored Spotify session.",
        ));
    };

    let response = exchange(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", &refresh),
        ("client_id", client_id),
    ])
    .await?;

    // Spotify sometimes rotates the refresh token; persist it when it does.
    if let Some(rotated) = &response.refresh_token {
        store_refresh_token(rotated)?;
    }

    cache.put(&response.access_token, response.expires_in);
    Ok(response.access_token)
}

/// POST to Spotify's token endpoint and interpret the outcome.
pub async fn exchange(form: &[(&str, &str)]) -> Result<TokenResponse, AuthError> {
    let client = reqwest::Client::new();
    let response = client
        .post(TOKEN_ENDPOINT)
        .form(form)
        .send()
        .await
        .map_err(|e| AuthError::new("network", e.to_string()))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| AuthError::new("network", e.to_string()))?;

    if !status.is_success() {
        // Spotify answers a bad Client ID and an unregistered redirect URI with
        // the same `invalid_client` status, so the body is the only way to tell
        // the user which one to go fix.
        let code = if body.contains("redirect_uri") {
            "redirect_uri_mismatch"
        } else if status == reqwest::StatusCode::BAD_REQUEST
            || status == reqwest::StatusCode::UNAUTHORIZED
        {
            "invalid_client"
        } else {
            "token_exchange_failed"
        };
        return Err(AuthError::new(code, format!("{status}: {body}")));
    }

    serde_json::from_str(&body).map_err(|e| {
        AuthError::new(
            "token_exchange_failed",
            format!("Unexpected token response: {e}"),
        )
    })
}
