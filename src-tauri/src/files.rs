//! Native file selection and library scanning for local audio.
//!
//! The dialog deliberately lives in Rust rather than in JavaScript. That is what
//! lets the asset protocol run with an empty static scope: the webview cannot
//! name a path it wants access to, it can only receive paths the user picked in
//! an OS dialog, and only those get allowed.
//!
//! The weaker design — an `allow_asset_path(path)` command callable from JS —
//! would hand any script in the webview a way to unlock arbitrary files
//! (`~/.ssh/id_rsa`, a password vault) and then read them through
//! `convertFileSrc`. Keeping the picker on this side removes that move entirely.
//!
//! `read_cover_art` returns raw file bytes, so it is held to the same rule: it
//! serves only paths already recorded in [`PickedPaths`]. The webview can ask
//! about a file it was given, never about one it names itself.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use walkdir::WalkDir;

use crate::metadata::{self, CoverArt, ScannedTrack};

/// Extensions offered in the dialog filter and accepted during a folder scan.
/// Mirrors what the webview's audio element can actually decode; see
/// `src-tauri/src/audio.rs` on format limits.
const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "wav", "ogg", "oga", "opus", "m4a", "aac", "weba",
];

/// How deep a folder scan will walk. Deep enough for `Artist/Album/Disc 1`,
/// shallow enough that pointing at a drive root cannot run away.
const MAX_SCAN_DEPTH: usize = 8;

/// Emit a progress event every this many files, rather than per file — a large
/// library would otherwise flood the IPC channel with events nobody reads.
const SCAN_PROGRESS_INTERVAL: usize = 25;

/// Paths the user has granted access to during this run.
///
/// Fail-closed on purpose: entries are stored exactly as handed to the frontend,
/// and lookups compare exactly. A path that does not match is refused rather
/// than normalized into something that might match.
#[derive(Default)]
pub struct PickedPaths(Mutex<HashSet<PathBuf>>);

impl PickedPaths {
    fn remember(&self, path: &Path) {
        if let Ok(mut paths) = self.0.lock() {
            paths.insert(path.to_path_buf());
        }
    }

    fn contains(&self, path: &Path) -> bool {
        self.0
            .lock()
            .map(|paths| paths.contains(path))
            .unwrap_or(false)
    }
}

/// Re-register paths restored from a previous session so their artwork stays
/// reachable. Called from `session.rs`, never from the webview.
pub fn remember_restored_paths(app: &AppHandle, paths: &[PathBuf]) {
    let state = app.state::<PickedPaths>();
    for path in paths {
        state.remember(path);
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScanProgress {
    scanned: usize,
}

/// Open a native audio-file picker, read tags, and grant asset-protocol access
/// to whatever the user chose. Returns an empty list when the dialog is
/// dismissed.
///
/// `async` on a synchronous function moves execution to Tauri's thread pool.
/// That matters: `blocking_pick_files` on the main thread deadlocks against the
/// event loop and freezes the window.
#[tauri::command(async)]
pub fn pick_audio_files(app: AppHandle) -> Result<Vec<ScannedTrack>, String> {
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
    let picked_paths = app.state::<PickedPaths>();
    let mut tracks = Vec::with_capacity(file_paths.len());

    for file_path in file_paths {
        let path = file_path
            .into_path()
            .map_err(|e| format!("Could not resolve selected file: {e}"))?;

        scope
            .allow_file(&path)
            .map_err(|e| format!("Could not grant access to {}: {e}", path.display()))?;
        picked_paths.remember(&path);

        tracks.push(metadata::read_track(&path));
    }

    Ok(tracks)
}

/// Open a folder picker and scan it recursively for audio files.
///
/// The whole folder is granted recursively — the user chose it, so reaching its
/// subdirectories is what they asked for. Individual files are still recorded in
/// [`PickedPaths`] so artwork lookups stay exact-match.
#[tauri::command(async)]
pub fn pick_music_folder(app: AppHandle) -> Result<Vec<ScannedTrack>, String> {
    let Some(folder) = app
        .dialog()
        .file()
        .set_title("Add a music folder")
        .blocking_pick_folder()
    else {
        return Ok(Vec::new());
    };

    let root = folder
        .into_path()
        .map_err(|e| format!("Could not resolve selected folder: {e}"))?;

    app.asset_protocol_scope()
        .allow_directory(&root, true)
        .map_err(|e| format!("Could not grant access to {}: {e}", root.display()))?;

    let picked_paths = app.state::<PickedPaths>();
    let mut tracks = Vec::new();

    for entry in WalkDir::new(&root)
        .max_depth(MAX_SCAN_DEPTH)
        .into_iter()
        // Skip unreadable directories rather than abandoning the whole scan.
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_file() || !is_audio_file(entry.path()) {
            continue;
        }

        picked_paths.remember(entry.path());
        tracks.push(metadata::read_track(entry.path()));

        if tracks.len() % SCAN_PROGRESS_INTERVAL == 0 {
            let _ = app.emit(
                "library:scan-progress",
                ScanProgress {
                    scanned: tracks.len(),
                },
            );
        }
    }

    // Folder order is filesystem order, which is arbitrary. Album then title is
    // the least surprising default for a freshly imported folder.
    tracks.sort_by(|a, b| {
        a.album
            .cmp(&b.album)
            .then_with(|| a.title.cmp(&b.title))
    });

    let _ = app.emit(
        "library:scan-progress",
        ScanProgress {
            scanned: tracks.len(),
        },
    );

    Ok(tracks)
}

/// Return embedded artwork for a track the user already picked.
///
/// Refuses any path not in [`PickedPaths`]. Without that check this would be a
/// general-purpose file reader for anything the webview cares to name.
#[tauri::command(async)]
pub fn read_cover_art(
    path: String,
    picked_paths: State<'_, PickedPaths>,
) -> Result<Option<CoverArt>, String> {
    let path = PathBuf::from(path);

    if !picked_paths.contains(&path) {
        return Err(format!(
            "Refusing to read {}: not a file selected in this session.",
            path.display()
        ));
    }

    Ok(metadata::read_picture(&path))
}

fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let ext = ext.to_ascii_lowercase();
            AUDIO_EXTENSIONS.contains(&ext.as_str())
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_audio_extensions_case_insensitively() {
        assert!(is_audio_file(Path::new("a.mp3")));
        assert!(is_audio_file(Path::new("a.FLAC")));
        assert!(is_audio_file(Path::new(r"C:\Music\b.M4a")));
    }

    #[test]
    fn rejects_non_audio_files() {
        for name in ["cover.jpg", "notes.txt", "no-extension", "archive.mp3.zip"] {
            assert!(!is_audio_file(Path::new(name)), "should reject {name:?}");
        }
    }

    #[test]
    fn only_remembered_paths_are_readable() {
        let picked = PickedPaths::default();
        let allowed = PathBuf::from(r"C:\Music\song.mp3");

        assert!(!picked.contains(&allowed));
        picked.remember(&allowed);
        assert!(picked.contains(&allowed));

        // A path the user never selected stays refused.
        assert!(!picked.contains(Path::new(r"C:\Users\murat\.ssh\id_rsa")));
    }
}
