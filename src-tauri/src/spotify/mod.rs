//! Spotify integration.
//!
//! The commands here are the entire Spotify surface the webview can reach.
//! Notably absent: anything that returns a refresh token. That is the rule this
//! module exists to enforce — see `tokens.rs`.

pub mod auth;
pub mod config;
pub mod error;
pub mod pkce;
pub mod tokens;

use tauri::{AppHandle, State};

use auth::Account;
use error::AuthError;
use tokens::AccessTokenCache;

/// Run the full authorization flow. Opens the browser and blocks until the user
/// finishes or the listener times out.
#[tauri::command]
pub async fn spotify_begin_auth(
    app: AppHandle,
    cache: State<'_, AccessTokenCache>,
) -> Result<Account, AuthError> {
    auth::begin(&app, &cache).await
}

/// A short-lived access token, refreshed transparently when it has expired.
///
/// This is the only credential that ever crosses into JavaScript.
#[tauri::command]
pub async fn spotify_access_token(
    app: AppHandle,
    cache: State<'_, AccessTokenCache>,
) -> Result<String, AuthError> {
    let client_id = config::client_id(&app)
        .ok_or_else(|| AuthError::new("no_client_id", "No Spotify Client ID configured."))?;
    tokens::access_token(&cache, &client_id).await
}

#[tauri::command]
pub fn spotify_is_authenticated() -> bool {
    tokens::is_authenticated()
}

#[tauri::command]
pub fn spotify_sign_out(cache: State<'_, AccessTokenCache>) -> Result<(), AuthError> {
    cache.clear();
    tokens::forget()
}

/// Whether a Client ID has been configured, without revealing it.
///
/// The setup panel only needs to know if the step is done; handing the value
/// back would serve no purpose.
#[tauri::command]
pub fn spotify_has_client_id(app: AppHandle) -> bool {
    config::client_id(&app).is_some()
}

#[tauri::command]
pub fn spotify_set_client_id(app: AppHandle, client_id: String) -> Result<(), AuthError> {
    config::set_client_id(&app, &client_id)
        .map_err(|e| AuthError::new("invalid_client_id", format!("Client ID is {e}.")))
}

#[tauri::command]
pub fn spotify_clear_client_id(app: AppHandle) -> Result<(), AuthError> {
    config::clear_client_id(&app).map_err(|e| AuthError::new("keyring_failed", e))
}

/// The redirect URI the user must register. Read from Rust rather than
/// duplicated in the frontend so the copy button cannot drift from the port
/// actually being bound.
#[tauri::command]
pub fn spotify_redirect_uri() -> &'static str {
    config::REDIRECT_URI
}

/// Open the Spotify developer dashboard in the system browser.
///
/// Done here rather than through the JS opener plugin so the webview needs no
/// URL-opening permission at all: the address is a constant on this side and
/// cannot be substituted from the frontend.
#[tauri::command]
pub fn spotify_open_dashboard(app: AppHandle) -> Result<(), AuthError> {
    use tauri_plugin_opener::OpenerExt;

    app.opener()
        .open_url(config::DASHBOARD_URL, None::<&str>)
        .map_err(|e| AuthError::new("network", format!("Could not open the browser: {e}")))
}
