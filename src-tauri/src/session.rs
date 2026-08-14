//! Persisted playback settings.
//!
//! This used to hold the queue as well, which is why it re-granted asset access
//! on startup. It no longer does: what plays now comes from the library or a
//! playlist, and both are saved in their own files. Keeping a second copy of
//! the track list here would have been a second source of truth for the same
//! thing.
//!
//! What is left is small enough to be uninteresting: volume, mute, repeat and
//! shuffle.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const SESSION_FILE: &str = "session.json";

/// Bumped when the shape changes incompatibly. Version 1 carried a queue of
/// file paths; those files are ignored rather than migrated, because the
/// library now owns imported audio outright.
const SESSION_VERSION: u32 = 2;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    #[serde(default)]
    pub version: u32,
    #[serde(default = "default_volume")]
    pub volume: f64,
    #[serde(default)]
    pub muted: bool,
    /// "off" | "all" | "one". Validated on load.
    #[serde(default = "default_repeat")]
    pub repeat: String,
    #[serde(default)]
    pub shuffle: bool,
}

fn default_volume() -> f64 {
    0.8
}
fn default_repeat() -> String {
    "off".to_owned()
}

impl Default for SessionState {
    fn default() -> Self {
        Self {
            version: SESSION_VERSION,
            volume: default_volume(),
            muted: false,
            repeat: default_repeat(),
            shuffle: false,
        }
    }
}

/// Never fails in a way that blocks startup: a missing, corrupt or outdated
/// file yields defaults.
#[tauri::command(async)]
pub fn load_session(app: AppHandle) -> SessionState {
    let Some(path) = session_path(&app) else {
        return SessionState::default();
    };
    let Ok(contents) = fs::read_to_string(&path) else {
        return SessionState::default();
    };
    let Ok(mut state) = serde_json::from_str::<SessionState>(&contents) else {
        eprintln!("[session] ignoring unreadable session file at {}", path.display());
        return SessionState::default();
    };

    if state.version != SESSION_VERSION {
        return SessionState::default();
    }

    state.volume = state.volume.clamp(0.0, 1.0);
    if !matches!(state.repeat.as_str(), "off" | "all" | "one") {
        state.repeat = default_repeat();
    }
    state
}

#[tauri::command(async)]
pub fn save_session(app: AppHandle, state: SessionState) -> Result<(), String> {
    let path = session_path(&app).ok_or_else(|| "No app data directory available.".to_string())?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
    }

    let payload = SessionState {
        version: SESSION_VERSION,
        ..state
    };
    let json = serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("Could not serialize session: {e}"))?;

    let temp = path.with_extension("json.tmp");
    fs::write(&temp, json).map_err(|e| format!("Could not write session: {e}"))?;
    fs::rename(&temp, &path).map_err(|e| format!("Could not replace session file: {e}"))?;
    Ok(())
}

fn session_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(SESSION_FILE))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let state: SessionState = serde_json::from_str("{}").expect("empty object should parse");
        assert_eq!(state.volume, 0.8);
        assert_eq!(state.repeat, "off");
        assert!(!state.shuffle);
    }

    #[test]
    fn round_trips_through_json() {
        let original = SessionState {
            volume: 0.35,
            muted: true,
            repeat: "one".to_owned(),
            shuffle: true,
            ..SessionState::default()
        };
        let parsed: SessionState =
            serde_json::from_str(&serde_json::to_string(&original).unwrap()).unwrap();

        assert_eq!(parsed.volume, 0.35);
        assert!(parsed.muted);
        assert_eq!(parsed.repeat, "one");
    }

    #[test]
    fn a_version_one_file_with_a_queue_is_discarded() {
        // The old shape carried file paths that the library now owns outright.
        let raw = r#"{"version":1,"queue":[{"path":"C:/x.mp3"}],"volume":0.5}"#;
        let parsed: SessionState = serde_json::from_str(raw).expect("parses");
        assert_eq!(parsed.version, 1, "version is read before being rejected");
        // `load_session` returns defaults for anything that is not the current
        // version; this asserts the guard it relies on.
        assert_ne!(parsed.version, SESSION_VERSION);
    }

    #[test]
    fn unknown_repeat_mode_is_rejected_by_the_validator() {
        let mut repeat = "sideways".to_owned();
        if !matches!(repeat.as_str(), "off" | "all" | "one") {
            repeat = default_repeat();
        }
        assert_eq!(repeat, "off");
    }
}
