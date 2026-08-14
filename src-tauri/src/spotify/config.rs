//! Client ID resolution and storage.
//!
//! Spotify restricts Extended Quota Mode to organisations with 250k+ monthly
//! users, so this project can never ship one shared Client ID: an app stuck in
//! Development Mode only works for five accounts the owner allowlists by hand.
//! Every installation therefore registers its own Spotify app.
//!
//! That makes the Client ID ordinary user configuration rather than a build-time
//! constant, which is why it can be written at runtime and why the repository
//! contains none. Under PKCE there is no client secret, so the value is not a
//! credential — but one person's Client ID would burn another person's quota.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const CONFIG_FILE: &str = "config.json";

/// Overrides the stored value. Convenient for development; the app never writes it.
const CLIENT_ID_ENV: &str = "GROOVIUM_SPOTIFY_CLIENT_ID";

/// The redirect URI this app listens on. Must be registered verbatim in the
/// user's Spotify app, and is shown in the setup panel for copying because
/// mistyping it is the single most common way this flow fails.
pub const REDIRECT_URI: &str = "http://127.0.0.1:14536/callback";
pub const CALLBACK_PORT: u16 = 14536;

/// Where the user registers their own app. Opened from Rust so the frontend
/// never needs permission to open arbitrary URLs.
pub const DASHBOARD_URL: &str = "https://developer.spotify.com/dashboard";

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    #[serde(default)]
    spotify_client_id: Option<String>,
}

/// Resolve the Client ID: environment first, then the config file.
pub fn client_id(app: &AppHandle) -> Option<String> {
    if let Ok(from_env) = std::env::var(CLIENT_ID_ENV) {
        let trimmed = from_env.trim().to_owned();
        if !trimmed.is_empty() {
            return Some(trimmed);
        }
    }
    read_config(app).spotify_client_id.filter(|id| !id.is_empty())
}

pub fn set_client_id(app: &AppHandle, id: &str) -> Result<(), String> {
    let id = id.trim();
    validate(id)?;

    let mut config = read_config(app);
    config.spotify_client_id = Some(id.to_owned());
    write_config(app, &config)
}

pub fn clear_client_id(app: &AppHandle) -> Result<(), String> {
    let mut config = read_config(app);
    config.spotify_client_id = None;
    write_config(app, &config)
}

/// Catch an obviously wrong value before it turns into an opaque Spotify error.
///
/// Client IDs are 32 lowercase hex characters. Checking here means a user who
/// pasted the wrong field — the Client Secret, or a URL — is told so directly
/// instead of seeing `INVALID_CLIENT` after a browser round trip.
pub fn validate(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("empty".into());
    }
    if id.len() != 32 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("malformed".into());
    }
    Ok(())
}

fn config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(CONFIG_FILE))
}

fn read_config(app: &AppHandle) -> Config {
    config_path(app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_config(app: &AppHandle, config: &Config) -> Result<(), String> {
    let path = config_path(app).ok_or_else(|| "No app data directory available.".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
    }

    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, json).map_err(|e| format!("Could not write config: {e}"))?;
    fs::rename(&temp, &path).map_err(|e| format!("Could not replace config: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Placeholder, not anyone's registration: the tests only care about the
    /// shape, and a real Client ID in the repository would contradict the whole
    /// point of this module.
    const EXAMPLE_CLIENT_ID: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn accepts_a_real_shaped_client_id() {
        assert!(validate(EXAMPLE_CLIENT_ID).is_ok());
    }

    #[test]
    fn rejects_the_usual_mistakes() {
        // Empty, too short, too long, a pasted URL, and a value with spaces.
        for bad in [
            "",
            "0123456789",
            "0123456789abcdef0123456789abcdefaa",
            "https://developer.spotify.com/dashboard",
            "0123456789abcdef0123456789abcde ",
        ] {
            assert!(validate(bad).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn rejects_non_hex_characters() {
        // Right length, wrong alphabet — a common sign of a copied secret.
        assert!(validate("z135e168b5ab4b9aaebf28b1fae32a18").is_err());
    }

    #[test]
    fn redirect_uri_matches_the_port_we_bind() {
        assert!(REDIRECT_URI.contains(&CALLBACK_PORT.to_string()));
        // Loopback literal, not "localhost": Spotify stopped accepting the alias.
        assert!(REDIRECT_URI.starts_with("http://127.0.0.1:"));
    }
}
