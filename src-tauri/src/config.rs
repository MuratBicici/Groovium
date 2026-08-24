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
    #[serde(default)]
    pub settings: Settings,
}

/// What the person using this app chose, as opposed to what a provider needs.
///
/// Nested rather than flat so the file stays readable by eye, and so the
/// distinction between "configuration this installation was given" and
/// "preferences someone set" survives in the document itself.
///
/// Every field is optional in the sense that a missing one takes the default:
/// a config written before any of this existed still reads, and a settings file
/// from a newer build still loads on an older one.
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// Palette id, matching the `data-theme` values in `styles.css`. `None` is
    /// the default palette, which sets no attribute at all.
    #[serde(default)]
    pub theme: Option<String>,
    /// BCP 47-ish language tag. `None` means "follow the operating system",
    /// which is only consulted on a first run.
    #[serde(default)]
    pub language: Option<String>,
    /// Set independently of the OS `prefers-reduced-motion` setting; either one
    /// being on is enough to stop the animation.
    #[serde(default)]
    pub reduce_motion: bool,
    #[serde(default)]
    pub always_on_top: bool,
    /// Collapsed to the controls. The window plugin saves position only, so
    /// without this the window would come back full height on every launch.
    #[serde(default)]
    pub compact: bool,
    /// The two colours a hand-rolled palette is built from, as `#rrggbb`.
    /// Only meaningful while `theme` is `custom`, but kept either way so
    /// switching to a preset and back does not lose the choice.
    #[serde(default)]
    pub custom_primary: Option<String>,
    #[serde(default)]
    pub custom_secondary: Option<String>,
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Settings {
    read(&app).settings
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    update(&app, |config| config.settings = settings)
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
    fn saving_a_preference_does_not_erase_a_providers_key() {
        // The same hazard as above, one level down: settings arrive from the
        // webview as a whole object, and writing them through `update` must
        // leave everything a provider put in this file alone.
        let stored = r#"{"spotifyClientId":"abc","lastfmApiKey":"xyz"}"#;
        let mut config: AppConfig = serde_json::from_str(stored).expect("parses");

        config.settings = Settings {
            theme: Some("prussian-blue".into()),
            language: Some("tr".into()),
            reduce_motion: true,
            always_on_top: false,
            compact: true,
            custom_primary: Some("#2e231b".into()),
            custom_secondary: None,
        };

        let written = serde_json::to_string(&config).expect("serializes");
        assert!(written.contains(r#""spotifyClientId":"abc""#));
        assert!(written.contains(r#""lastfmApiKey":"xyz""#));
        assert!(written.contains(r#""theme":"prussian-blue""#));
        assert!(written.contains(r#""reduceMotion":true"#));
        assert!(written.contains(r#""compact":true"#));
        // Two hashes: the value itself contains `"#`, which closes an
        // `r#"..."#` literal early.
        assert!(written.contains(r##""customPrimary":"#2e231b""##));
    }

    #[test]
    fn a_config_written_before_settings_existed_still_reads() {
        let config: AppConfig =
            serde_json::from_str(r#"{"spotifyClientId":"abc"}"#).expect("parses");
        assert!(config.settings.theme.is_none());
        assert!(config.settings.language.is_none());
        assert!(!config.settings.reduce_motion);
        assert!(!config.settings.always_on_top);
        assert!(!config.settings.compact);
        assert!(config.settings.custom_primary.is_none());
    }

    #[test]
    fn field_names_are_camel_case_on_disk() {
        // The file is human-editable; the names should match what the setup
        // panels and the README call them.
        let json = serde_json::to_string(&AppConfig {
            spotify_client_id: Some("a".into()),
            lastfm_api_key: Some("b".into()),
            settings: Settings {
                reduce_motion: true,
                always_on_top: true,
                ..Settings::default()
            },
        })
        .unwrap();
        assert!(json.contains("spotifyClientId"));
        assert!(json.contains("lastfmApiKey"));
        assert!(json.contains("reduceMotion"));
        assert!(json.contains("alwaysOnTop"));
    }
}
