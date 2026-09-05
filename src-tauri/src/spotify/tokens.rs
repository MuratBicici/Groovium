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
    /// What was actually granted, space separated.
    ///
    /// Asking for a scope is not being given it, and a token issued before a
    /// scope was ever asked for keeps its old grant through every refresh. This
    /// is the only honest answer to "can this token read a playlist" short of
    /// trying it and reading a 403.
    pub scope: Option<String>,
}

struct CachedToken {
    value: String,
    expires_at: Instant,
}

/// In-memory access token, managed as Tauri state.
#[derive(Default)]
pub struct AccessTokenCache {
    current: Mutex<Option<CachedToken>>,
    /// Held across a refresh, so only one can be in flight.
    ///
    /// An async mutex rather than the one above, because it is held over an
    /// await. The one above is only ever taken to read or write a field and is
    /// released in the same expression.
    minting: tokio::sync::Mutex<()>,
}

impl AccessTokenCache {
    fn get(&self) -> Option<String> {
        let guard = self.current.lock().ok()?;
        let cached = guard.as_ref()?;
        (cached.expires_at > Instant::now()).then(|| cached.value.clone())
    }

    pub fn put(&self, value: &str, expires_in: u64) {
        if let Ok(mut guard) = self.current.lock() {
            *guard = Some(CachedToken {
                value: value.to_owned(),
                expires_at: Instant::now() + Duration::from_secs(expires_in).saturating_sub(EXPIRY_MARGIN),
            });
        }
    }

    pub fn clear(&self) {
        if let Ok(mut guard) = self.current.lock() {
            *guard = None;
        }
    }

    /// The cached token, or one new one however many callers arrive at once.
    ///
    /// `mint` returns the token and how many seconds it lasts. It runs at most
    /// once per expiry: the first caller through does the work and the rest
    /// wait and take the result, because the second look happens on the far
    /// side of the wait rather than before it.
    async fn or_mint<F, Fut>(&self, mint: F) -> Result<String, AuthError>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<(String, u64), AuthError>>,
    {
        if let Some(cached) = self.get() {
            return Ok(cached);
        }

        let _turn = self.minting.lock().await;

        // Whoever went first has usually just put a perfectly good token there.
        if let Some(cached) = self.get() {
            return Ok(cached);
        }

        let (value, expires_in) = mint().await?;
        self.put(&value, expires_in);
        Ok(value)
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
///
/// One refresh at a time, and everyone who waited takes what it minted.
///
/// Without that, an expired token meant a refresh per waiting request, and the
/// waiting requests are not hypothetical: filling the playlist shelf asks for
/// the page and for the account at once, so the first shelf of a session set
/// two off by construction.
///
/// The cost is not really the extra request. Spotify sometimes rotates the
/// refresh token, and two refreshes sent with the same one race to write the
/// answer back — so the loser can persist a token Spotify has already retired,
/// and the next launch finds the session gone for no reason the user could see.
pub async fn access_token(
    cache: &AccessTokenCache,
    client_id: &str,
) -> Result<String, AuthError> {
    cache
        .or_mint(|| async {
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

            // Spotify sometimes rotates the refresh token; persist it when it
            // does. Inside the turn, so a rotation cannot be raced.
            if let Some(rotated) = &response.refresh_token {
                store_refresh_token(rotated)?;
            }

            Ok((response.access_token, response.expires_in))
        })
        .await
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    /// A token was minted twice for one expiry, and that is the cheap half of it.
    ///
    /// Filling the playlist shelf asks Spotify for the page and for the account
    /// at once, so the first shelf of a session sent two refreshes by
    /// construction. Spotify sometimes rotates the refresh token, and two
    /// refreshes carrying the same one race to write the answer back — the
    /// loser stores a token Spotify has already retired, and the next launch
    /// finds the session gone with nothing to explain it.
    #[tokio::test]
    async fn mints_one_token_however_many_callers_arrive() {
        let cache = Arc::new(AccessTokenCache::default());
        let minted = Arc::new(AtomicUsize::new(0));

        let waiting: Vec<_> = (0..8)
            .map(|_| {
                let cache = Arc::clone(&cache);
                let minted = Arc::clone(&minted);
                tokio::spawn(async move {
                    cache
                        .or_mint(|| async {
                            minted.fetch_add(1, Ordering::SeqCst);
                            // Long enough that every other caller is already
                            // waiting when this one finishes.
                            tokio::time::sleep(Duration::from_millis(20)).await;
                            Ok(("token".to_owned(), 3600))
                        })
                        .await
                })
            })
            .collect();

        for task in waiting {
            assert_eq!(task.await.unwrap().unwrap(), "token");
        }
        assert_eq!(minted.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn does_not_ask_again_while_the_token_is_good() {
        let cache = AccessTokenCache::default();
        let minted = AtomicUsize::new(0);
        let mint = || async {
            minted.fetch_add(1, Ordering::SeqCst);
            Ok(("token".to_owned(), 3600))
        };

        assert_eq!(cache.or_mint(mint).await.unwrap(), "token");
        assert_eq!(cache.or_mint(mint).await.unwrap(), "token");
        assert_eq!(minted.load(Ordering::SeqCst), 1);
    }

    /// A failure is not a token. The next caller has to be able to try.
    #[tokio::test]
    async fn lets_the_next_caller_try_after_a_failure() {
        let cache = AccessTokenCache::default();

        let failed = cache
            .or_mint(|| async { Err(AuthError::new("offline", "no route")) })
            .await;
        assert!(failed.is_err());

        let second = cache.or_mint(|| async { Ok(("token".to_owned(), 3600)) }).await;
        assert_eq!(second.unwrap(), "token");
    }

    /// An expiry margin means a token good for less than it is stops early.
    #[tokio::test]
    async fn treats_a_token_inside_the_margin_as_spent() {
        let cache = AccessTokenCache::default();
        cache.put("nearly-gone", 1);
        assert!(cache.get().is_none());
    }
}
