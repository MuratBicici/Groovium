//! The shared `config.json` in the app data directory.
//!
//! Every provider that needs per-installation configuration writes into this one
//! file. That is why it lives here rather than inside a provider module: a
//! module that serialized only its own field would wipe every other field on
//! save, because serde writes the whole document. `update` reads, mutates and
//! writes back, so the clobbering cannot happen by construction.
//!
//! Nothing here is a credential in the sense the keyring holds one. Spotify's
//! Client ID is public under PKCE and a Last.fm API key authorises quota rather
//! than an account. They live here because each installation registers its own,
//! and because the repository must never contain either.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const CONFIG_FILE: &str = "config.json";

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default)]
    pub spotify_client_id: Option<String>,
    #[serde(default)]
    pub lastfm_api_key: Option<String>,
}

pub fn read(app: &AppHandle) -> AppConfig {
    config_path(app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// Read, mutate, write back.
///
/// The only supported way to change the file, so a caller cannot accidentally
/// drop a field belonging to another provider.
pub fn update(app: &AppHandle, mutate: impl FnOnce(&mut AppConfig)) -> Result<(), String> {
    let mut config = read(app);
    mutate(&mut config);
    write(app, &config)
}

fn config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(CONFIG_FILE))
}

fn write(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = config_path(app).ok_or_else(|| "No app data directory available.".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
    }

    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    // Write beside the target and rename, so a crash mid-write cannot leave a
    // truncated file that loses every provider's configuration at once.
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, json).map_err(|e| format!("Could not write config: {e}"))?;
    fs::rename(&temp, &path).map_err(|e| format!("Could not replace config: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_providers_field_does_not_erase_anothers() {
        // The reason this module exists. Two modules each serializing their own
        // struct into the same file would drop the other's field on every save.
        let stored = r#"{"spotifyClientId":"abc","lastfmApiKey":"xyz"}"#;
        let mut config: AppConfig = serde_json::from_str(stored).expect("parses");

        config.lastfm_api_key = Some("new-key".into());

        let written = serde_json::to_string(&config).expect("serializes");
        assert!(written.contains(r#""spotifyClientId":"abc""#), "Spotify's field survived");
        assert!(written.contains(r#""lastfmApiKey":"new-key""#));
    }

    #[test]
    fn a_missing_field_reads_as_none() {
        let config: AppConfig = serde_json::from_str("{}").expect("empty object parses");
        assert!(config.spotify_client_id.is_none());
        assert!(config.lastfm_api_key.is_none());
    }

    #[test]
    fn field_names_are_camel_case_on_disk() {
        // The file is human-editable; the names should match what the setup
        // panels and the README call them.
        let json = serde_json::to_string(&AppConfig {
            spotify_client_id: Some("a".into()),
            lastfm_api_key: Some("b".into()),
        })
        .unwrap();
        assert!(json.contains("spotifyClientId"));
        assert!(json.contains("lastfmApiKey"));
    }
}
