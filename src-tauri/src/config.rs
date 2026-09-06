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
    /// The scopes Spotify last reported granting, space separated.
    ///
    /// Not a credential — it is a list of permissions, readable by anyone who
    /// opens this file, and useless without the token in the keyring. It lives
    /// beside the Client ID because it belongs to that registration.
    #[serde(default)]
    pub spotify_scopes: Option<String>,
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
#[derive(Serialize, Deserialize)]
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
    /// The Spotify drawer beside the player. Saved for the same reason
    /// `compact` is: the window plugin restores position but not size.
    #[serde(default)]
    pub drawer_open: bool,
    /// Which side of the player the drawer comes out of: `"left"` or `"right"`.
    ///
    /// A string rather than a flag, because this file is meant to be readable
    /// by the person whose file it is, and `"drawerSide": "left"` says what it
    /// means where `"drawerOnLeft": true` needs the reader to know which way
    /// round the default was. Anything unrecognised reads as the default on the
    /// way in, so a typo loses the preference rather than the window.
    #[serde(default = "right_side")]
    pub drawer_side: String,
    /// The two colours a hand-rolled palette is built from, as `#rrggbb`.
    /// Only meaningful while `theme` is `custom`, but kept either way so
    /// switching to a preset and back does not lose the choice.
    #[serde(default)]
    pub custom_primary: Option<String>,
    #[serde(default)]
    pub custom_secondary: Option<String>,
    /// Raise every contrast target by a grade, on any palette. Strengthens
    /// text and nothing else.
    #[serde(default)]
    pub boost_contrast: bool,
    /// A hairline in the accent colour around the window, replacing the black
    /// ring that separates it from the desktop.
    #[serde(default)]
    pub window_border: bool,
    /// Bars behind the deck, moving to what this app is playing.
    ///
    /// On unless turned off, including in a config written before the field
    /// existed. It listens to this app's own webview and nothing else on the
    /// machine, so there is nothing here anyone needs to opt into — and a
    /// setting that had to be found before the feature existed at all would
    /// mean most people never saw it.
    #[serde(default = "on_unless_turned_off")]
    pub visualizer: bool,
    /// Light around the window's edge, climbing with how loud the music is.
    ///
    /// Off unless asked for, unlike the visualiser. That one is behind the deck
    /// where an ornament belongs; this one is on the window's own border, and a
    /// border that started moving on its own after an update would be a change
    /// to the shape of the app rather than something added to it.
    #[serde(default)]
    pub window_glow: bool,
    /// How the edge light is tuned, each nought to one with a half in the
    /// middle. A half is what it was tuned to before there was anything to
    /// move it with, so a config from before these existed reads as unchanged.
    #[serde(default = "middling")]
    pub glow_strength: f32,
    #[serde(default = "middling")]
    pub glow_sensitivity: f32,
    #[serde(default = "middling")]
    pub glow_speed: f32,
    /// The last version whose summary was shown on the way in. `None` means
    /// nobody has been shown anything, which is equally true of a first run and
    /// of a config written before this field existed — both get the summary
    /// once, which is the honest answer to "you have not seen this yet".
    #[serde(default)]
    pub last_seen_version: Option<String>,
    /// The version an offer to update was declined for. `None` means no offer
    /// has been turned down, which is the state every install starts in.
    #[serde(default)]
    pub declined_version: Option<String>,
}

/// What a fresh installation is, spelled out.
///
/// Written rather than derived, because a derived one says every switch is off
/// and that is not what this app is: the visualiser is on unless somebody turns
/// it off, and a `#[serde(default)]` on the field alone would not have covered
/// a config file with no `settings` object in it at all — which is what an
/// upgrade from before any of this looks like.
impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: None,
            language: None,
            reduce_motion: false,
            always_on_top: false,
            compact: false,
            drawer_open: false,
            drawer_side: right_side(),
            custom_primary: None,
            custom_secondary: None,
            boost_contrast: false,
            window_border: false,
            visualizer: on_unless_turned_off(),
            window_glow: false,
            glow_strength: middling(),
            glow_sensitivity: middling(),
            glow_speed: middling(),
            last_seen_version: None,
            declined_version: None,
        }
    }
}

/// Serde needs a function rather than a literal for a non-`false` default.
/// The side a drawer comes out of unless somebody has said otherwise.
///
/// Right, because that is where it has always been and because a window near
/// the left edge of a screen has nowhere to grow the other way.
/// The middle of a slider, which is the tuning everything shipped with.
fn middling() -> f32 {
    0.5
}

fn right_side() -> String {
    "right".to_owned()
}

fn on_unless_turned_off() -> bool {
    true
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
    fn a_config_from_before_the_drawer_had_a_side_opens_on_the_right() {
        // Where it has always been. An upgrade must not move somebody's window
        // because a field appeared.
        let config: AppConfig = serde_json::from_str(r#"{"settings":{}}"#).expect("parses");
        assert_eq!(config.settings.drawer_side, "right");
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
            drawer_open: true,
            drawer_side: "left".into(),
            custom_primary: Some("#2e231b".into()),
            custom_secondary: None,
            boost_contrast: true,
            window_border: false,
            visualizer: true,
            window_glow: true,
            glow_strength: 0.8,
            glow_sensitivity: 0.2,
            glow_speed: 0.5,
            last_seen_version: Some("1.0.4".into()),
            declined_version: Some("1.0.5".into()),
        };

        let written = serde_json::to_string(&config).expect("serializes");
        assert!(written.contains(r#""spotifyClientId":"abc""#));
        assert!(written.contains(r#""lastfmApiKey":"xyz""#));
        assert!(written.contains(r#""theme":"prussian-blue""#));
        assert!(written.contains(r#""reduceMotion":true"#));
        assert!(written.contains(r#""compact":true"#));
        assert!(written.contains(r#""drawerOpen":true"#));
        // Two hashes: the value itself contains `"#`, which closes an
        // `r#"..."#` literal early.
        assert!(written.contains(r##""customPrimary":"#2e231b""##));
        assert!(written.contains(r#""lastSeenVersion":"1.0.4""#));
        assert!(written.contains(r#""declinedVersion":"1.0.5""#));
    }

    #[test]
    fn a_config_from_before_the_summary_existed_has_seen_nothing() {
        // The upgrade path for this field: an install from 1.0.3 has no
        // `lastSeenVersion`, which has to read as "nothing has been shown"
        // rather than as a parse failure that resets every other preference.
        let config: AppConfig = serde_json::from_str(
            r#"{"settings":{"theme":"espresso","reduceMotion":true}}"#,
        )
        .expect("parses");
        assert!(config.settings.last_seen_version.is_none());
        assert!(config.settings.declined_version.is_none());
        assert_eq!(config.settings.theme.as_deref(), Some("espresso"));
        assert!(config.settings.reduce_motion);
    }

    #[test]
    fn a_config_written_before_settings_existed_still_reads() {
        let config: AppConfig =
            serde_json::from_str(r#"{"spotifyClientId":"abc"}"#).expect("parses");
        // Nobody has been granted anything on this installation as far as the
        // file knows, which is how a token from before the drawer is told apart
        // from one issued under the wider grant.
        assert!(config.spotify_scopes.is_none());
        assert!(config.settings.theme.is_none());
        assert!(config.settings.language.is_none());
        assert!(!config.settings.reduce_motion);
        assert!(!config.settings.always_on_top);
        assert!(!config.settings.compact);
        assert!(config.settings.custom_primary.is_none());
        // Added after 1.0.2 shipped; `default` rather than a version bump, so
        // an existing file keeps its theme instead of being discarded over two
        // new booleans.
        assert!(!config.settings.boost_contrast);
        assert!(!config.settings.window_border);
        // Absent from an older file means on. It listens to this app and
        // nothing else, so an upgrade gets the feature rather than a switch
        // nobody knew to look for.
        assert!(config.settings.visualizer);
    }

    #[test]
    fn field_names_are_camel_case_on_disk() {
        // The file is human-editable; the names should match what the setup
        // panels and the README call them.
        let json = serde_json::to_string(&AppConfig {
            spotify_client_id: Some("a".into()),
            lastfm_api_key: Some("b".into()),
            spotify_scopes: Some("streaming".into()),
            settings: Settings {
                reduce_motion: true,
                always_on_top: true,
                ..Settings::default()
            },
        })
        .unwrap();
        assert!(json.contains("spotifyClientId"));
        assert!(json.contains("lastfmApiKey"));
        assert!(json.contains("spotifyScopes"));
        assert!(json.contains("reduceMotion"));
        assert!(json.contains("alwaysOnTop"));
    }
}
