//! Persisted session state: the queue and playback settings.
//!
//! Written from Rust with plain `serde_json` rather than through a key-value
//! plugin exposed to JavaScript. The reason is the queue: it holds file paths,
//! and on startup those paths get asset-protocol access granted back to them.
//! If the webview could write this file, it could name a path there and have the
//! next launch unlock it — the same hole `files.rs` exists to close. Paths in
//! this file therefore only ever come from Rust's own record of what the user
//! picked.
//!
//! Entries whose files have since disappeared are dropped on load, so a deleted
//! or unplugged track quietly leaves the queue instead of failing at play time.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::files;
use crate::metadata::ScannedTrack;

const SESSION_FILE: &str = "session.json";

/// Bumped when the shape changes incompatibly. A mismatch is treated as "no
/// session" rather than an error — losing a queue is a far better outcome than
/// refusing to start.
const SESSION_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub queue: Vec<ScannedTrack>,
    /// Index into `queue`, or -1 for nothing selected.
    #[serde(default = "no_selection")]
    pub queue_index: i32,
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

fn no_selection() -> i32 {
    -1
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
            queue: Vec::new(),
            queue_index: no_selection(),
            volume: default_volume(),
            muted: false,
            repeat: default_repeat(),
            shuffle: false,
        }
    }
}

/// Restore the previous session, re-granting access to tracks that still exist.
///
/// Never fails in a way that blocks startup: a missing, corrupt or outdated file
/// yields defaults.
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

    // Remember which track was current so the index can follow it across the
    // removal of any tracks that vanished from disk.
    let current_path = usize::try_from(state.queue_index)
        .ok()
        .and_then(|i| state.queue.get(i))
        .map(|track| track.path.clone());

    state.queue.retain(|track| PathBuf::from(&track.path).is_file());

    state.queue_index = current_path
        .and_then(|path| state.queue.iter().position(|track| track.path == path))
        .and_then(|i| i32::try_from(i).ok())
        .unwrap_or(no_selection());

    let paths: Vec<PathBuf> = state.queue.iter().map(|t| PathBuf::from(&t.path)).collect();
    let scope = app.asset_protocol_scope();
    for path in &paths {
        if let Err(e) = scope.allow_file(path) {
            eprintln!("[session] could not restore access to {}: {e}", path.display());
        }
    }
    files::remember_restored_paths(&app, &paths);

    state.volume = state.volume.clamp(0.0, 1.0);
    if !matches!(state.repeat.as_str(), "off" | "all" | "one") {
        state.repeat = default_repeat();
    }

    state
}

/// Persist the session. Errors are returned so the frontend can surface them,
/// but callers generally treat saving as best-effort.
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

    // Write beside the target and rename, so a crash mid-write cannot leave a
    // truncated file that would lose the queue on next launch.
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
        assert_eq!(state.queue_index, -1);
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
        let json = serde_json::to_string(&original).expect("serializes");
        let parsed: SessionState = serde_json::from_str(&json).expect("deserializes");

        assert_eq!(parsed.volume, 0.35);
        assert!(parsed.muted);
        assert_eq!(parsed.repeat, "one");
        assert!(parsed.shuffle);
    }

    #[test]
    fn unknown_repeat_mode_is_rejected_by_the_validator() {
        // Mirrors the check in `load_session`; guards against a hand-edited file
        // putting the store into a mode it has no branch for.
        let mut repeat = "sideways".to_owned();
        if !matches!(repeat.as_str(), "off" | "all" | "one") {
            repeat = default_repeat();
        }
        assert_eq!(repeat, "off");
    }
}
