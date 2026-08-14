//! Native file selection for local audio.
//!
//! The dialog deliberately lives in Rust rather than in JavaScript. That is what
//! lets the asset protocol run with an empty static scope: the webview cannot
//! name a path it wants access to, it can only receive paths the user picked in
//! an OS dialog, and only those get allowed.
//!
//! The weaker design — a `allow_asset_path(path)` command callable from JS —
//! would hand any script in the webview a way to unlock arbitrary files
//! (`~/.ssh/id_rsa`, a password vault) and then read them through
//! `convertFileSrc`. Keeping the picker on this side removes that move entirely.
//!
//! Scope grants are per-run and not persisted. A future "remember my library"
//! feature has to re-allow its paths on startup.

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

/// Extensions offered in the dialog filter. Mirrors what the webview's audio
/// element can actually decode; see `src-tauri/src/audio.rs` on format limits.
const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "wav", "ogg", "oga", "opus", "m4a", "aac", "weba",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedAudioFile {
    /// File name with extension. The frontend derives display metadata from it.
    name: String,
    /// Absolute path, for the frontend to hand to `convertFileSrc()`.
    path: String,
}

/// Open a native audio-file picker and grant asset-protocol access to whatever
/// the user chose. Returns an empty list when the dialog is dismissed.
///
/// `async` on a synchronous function moves execution to Tauri's thread pool.
/// That matters: `blocking_pick_files` on the main thread deadlocks against the
/// event loop and freezes the window.
#[tauri::command(async)]
pub fn pick_audio_files(app: AppHandle) -> Result<Vec<PickedAudioFile>, String> {
    let selection = app
        .dialog()
        .file()
        .set_title("Add audio files")
        .add_filter("Audio", AUDIO_EXTENSIONS)
        .blocking_pick_files();

    let Some(file_paths) = selection else {
        return Ok(Vec::new());
    };

    let scope = app.asset_protocol_scope();
    let mut picked = Vec::with_capacity(file_paths.len());

    for file_path in file_paths {
        let path = file_path
            .into_path()
            .map_err(|e| format!("Could not resolve selected file: {e}"))?;

        scope
            .allow_file(&path)
            .map_err(|e| format!("Could not grant access to {}: {e}", path.display()))?;

        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned());

        picked.push(PickedAudioFile {
            name,
            path: path.to_string_lossy().into_owned(),
        });
    }

    Ok(picked)
}
