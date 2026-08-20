//! The managed local library.
//!
//! Importing a track **copies the file** into the app's own store rather than
//! remembering where it came from. The consequence the user asked for: once a
//! song is in the library it keeps playing even if the original is deleted, the
//! folder is reorganised, or the drive it lived on is unplugged. Removing it
//! from the library deletes the copy.
//!
//! The cost is honest and worth stating: imported music occupies disk twice,
//! and importing a large folder takes as long as copying it. That is why
//! scanning and copying are separate commands — the frontend can show how many
//! files and how many bytes are about to be duplicated and ask first.
//!
//! Two things fall out of owning the files. Cover art keeps working, because the
//! tags are still there to read. And the asset-protocol scope collapses to one
//! recursive grant on our own directory instead of a grant per picked file,
//! which is a narrower surface than Phase 1 had.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use walkdir::WalkDir;

use crate::metadata;

const LIBRARY_FILE: &str = "library.json";
/// Directory holding our copies, inside the app data directory.
const STORE_DIR: &str = "library";
const LIBRARY_VERSION: u32 = 1;

const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "wav", "ogg", "oga", "opus", "m4a", "aac", "weba",
];

/// Deep enough for `Artist/Album/Disc 1`, shallow enough that pointing at a
/// drive root cannot run away.
const MAX_SCAN_DEPTH: usize = 8;

/// Record progress this often during a long import.
///
/// The library used to be written once, after the last file. Everything copied
/// before a crash — or before a failing write — was left in the store with no
/// record pointing at it, which is disk nothing ever reclaims. Flushing as we
/// go bounds that loss to the last few files instead of the whole import.
const IMPORT_FLUSH_EVERY: usize = 25;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTrack {
    /// Stable across restarts; playlists reference this rather than a path, so
    /// a future "relink a moved file" feature can change the path underneath.
    pub id: String,
    /// File name inside the store directory.
    pub stored_file: String,
    /// Where it came from. Kept for display and to avoid importing twice.
    pub source_path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: u64,
    pub has_cover_art: bool,
    /// Sidecar image inside the store directory, extracted at import time.
    /// `None` on records from before the field existed; backfilled on load.
    /// The sidecar exists because the store directory has an asset-protocol
    /// grant — a file here is an `<img src>` with no IPC payload.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_file: Option<String>,
    pub added_at: u64,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LibraryFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    tracks: Vec<LibraryTrack>,
}

/// What a scan found, so the frontend can confirm before anything is copied.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub paths: Vec<String>,
    pub total_bytes: u64,
    /// Files already in the library, which will be skipped.
    pub duplicates: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ImportProgress {
    done: usize,
    total: usize,
    current_name: String,
}

/// Lets the frontend stop a long copy. Checked before each file.
#[derive(Default)]
pub struct ImportControl(AtomicBool);

impl ImportControl {
    fn reset(&self) {
        self.0.store(false, Ordering::Relaxed);
    }
    fn cancel(&self) {
        self.0.store(true, Ordering::Relaxed);
    }
    fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}

// --- Storage primitives, independent of Tauri so they can be tested ---------

/// The directory holding our copies of imported audio.
pub struct Store {
    pub root: PathBuf,
}

impl Store {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn path_of(&self, stored_file: &str) -> PathBuf {
        self.root.join(stored_file)
    }

    /// Copy a file in and return its name in the store.
    ///
    /// Copies to a temporary name and renames, so a failure part-way through
    /// cannot leave a half-written file that looks importable.
    pub fn take_in(&self, source: &Path, id: &str) -> Result<String, String> {
        fs::create_dir_all(&self.root)
            .map_err(|e| format!("Could not create the library folder: {e}"))?;

        let extension = source
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("audio")
            .to_ascii_lowercase();
        let stored_file = format!("{id}.{extension}");

        let final_path = self.root.join(&stored_file);
        let temp_path = self.root.join(format!("{id}.partial"));

        if let Err(e) = fs::copy(source, &temp_path) {
            let _ = fs::remove_file(&temp_path);
            return Err(format!("Could not copy {}: {e}", source.display()));
        }

        fs::rename(&temp_path, &final_path).map_err(|e| {
            let _ = fs::remove_file(&temp_path);
            format!("Could not finish importing {}: {e}", source.display())
        })?;

        Ok(stored_file)
    }

    pub fn discard(&self, stored_file: &str) -> Result<(), String> {
        let path = self.path_of(stored_file);
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            // Already gone is the outcome we wanted.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("Could not delete {}: {e}", path.display())),
        }
    }
}

fn new_id() -> String {
    let mut bytes = [0u8; 12];
    getrandom::fill(&mut bytes).expect("OS entropy source unavailable");
    URL_SAFE_NO_PAD.encode(bytes)
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| AUDIO_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn read_library(path: &Path) -> Vec<LibraryTrack> {
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    match serde_json::from_str::<LibraryFile>(&raw) {
        Ok(file) if file.version == LIBRARY_VERSION => file.tracks,
        Ok(_) => Vec::new(),
        Err(e) => {
            eprintln!("[library] ignoring unreadable library file: {e}");
            Vec::new()
        }
    }
}

/// Extract sidecar covers for records that predate the `cover_file` field.
///
/// Runs on every load and is almost always a no-op: a record either has its
/// sidecar, or has provably no artwork. The interesting case is a library
/// imported before sidecars existed — its records say `has_cover_art` without
/// owning a cover file, and extraction from our own copy is cheap enough at
/// widget scale to do inline rather than behind a migration command.
///
/// Returns whether anything changed and the file should be rewritten.
fn backfill_covers(tracks: &mut [LibraryTrack], store: &Store) -> bool {
    let mut dirty = false;
    for track in tracks.iter_mut() {
        if track.cover_file.is_some() || !track.has_cover_art {
            continue;
        }
        match metadata::extract_picture_to(&store.path_of(&track.stored_file), &store.root, &track.id) {
            Some(name) => track.cover_file = Some(name),
            // Our copy is the source of truth; nothing extractable means the
            // flag was optimistic. Clearing it stops the retry every launch.
            None => track.has_cover_art = false,
        }
        dirty = true;
    }
    dirty
}

fn write_library(path: &Path, tracks: &[LibraryTrack]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
    }

    let payload = LibraryFile {
        version: LIBRARY_VERSION,
        tracks: tracks.to_vec(),
    };
    let json = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;

    // Write beside the target and rename, so a crash mid-write cannot lose the
    // whole library.
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, json).map_err(|e| format!("Could not write the library: {e}"))?;
    fs::rename(&temp, path).map_err(|e| format!("Could not replace the library file: {e}"))
}

// --- Tauri wiring -----------------------------------------------------------

fn library_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_dir(app)?.join(LIBRARY_FILE))
}

fn store(app: &AppHandle) -> Result<Store, String> {
    Ok(Store::new(app_dir(app)?.join(STORE_DIR)))
}

fn app_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("No app data directory available: {e}"))
}

/// Load the library and grant the webview access to the store directory.
///
/// One recursive grant on a directory we own, rather than a grant per file the
/// user picked. Nothing outside it becomes reachable.
#[tauri::command(async)]
pub fn library_load(app: AppHandle) -> Result<Vec<LibraryTrack>, String> {
    let store = store(&app)?;
    fs::create_dir_all(&store.root).ok();

    app.asset_protocol_scope()
        .allow_directory(&store.root, true)
        .map_err(|e| format!("Could not grant access to the library folder: {e}"))?;

    let library_path = library_path(&app)?;
    let mut tracks = read_library(&library_path);
    if backfill_covers(&mut tracks, &store) {
        write_library(&library_path, &tracks)?;
    }
    Ok(tracks)
}

/// Ask for files and report what importing them would involve.
#[tauri::command(async)]
pub fn library_pick_files(app: AppHandle) -> Result<Option<ScanSummary>, String> {
    let selection = app
        .dialog()
        .file()
        .set_title("Add audio files")
        .add_filter("Audio", AUDIO_EXTENSIONS)
        .blocking_pick_files();

    let Some(files) = selection else { return Ok(None) };
    let paths: Vec<PathBuf> = files
        .into_iter()
        .filter_map(|f| f.into_path().ok())
        .filter(|p| is_audio_file(p))
        .collect();

    Ok(Some(summarize(&app, paths)?))
}

/// Ask for a folder and report what importing it would involve.
///
/// Separate from the copy so the frontend can say "240 files, 1.8 GB" and wait
/// for a yes. Duplicating an archive silently would be rude.
#[tauri::command(async)]
pub fn library_pick_folder(app: AppHandle) -> Result<Option<ScanSummary>, String> {
    let Some(folder) = app
        .dialog()
        .file()
        .set_title("Add a music folder")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };

    let root = folder
        .into_path()
        .map_err(|e| format!("Could not resolve the folder: {e}"))?;

    let paths: Vec<PathBuf> = WalkDir::new(&root)
        .max_depth(MAX_SCAN_DEPTH)
        .into_iter()
        // Skip unreadable directories rather than abandoning the whole scan.
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file() && is_audio_file(e.path()))
        .map(|e| e.path().to_path_buf())
        .collect();

    Ok(Some(summarize(&app, paths)?))
}

fn summarize(app: &AppHandle, paths: Vec<PathBuf>) -> Result<ScanSummary, String> {
    let existing = read_library(&library_path(app)?);
    // A set, not a list. Scanning a folder against a large library was a
    // membership test per file across every existing entry — quadratic, and it
    // ran on the thread the user is waiting on between picking a folder and
    // seeing the confirmation.
    let known: HashSet<&str> = existing.iter().map(|t| t.source_path.as_str()).collect();

    let mut fresh = Vec::new();
    let mut duplicates = 0usize;
    let mut total_bytes = 0u64;

    for path in paths {
        let as_string = path.to_string_lossy().into_owned();
        if known.contains(as_string.as_str()) {
            duplicates += 1;
            continue;
        }
        total_bytes += fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        fresh.push(as_string);
    }

    Ok(ScanSummary {
        paths: fresh,
        total_bytes,
        duplicates,
    })
}

/// Copy the given files into the store and add them to the library.
///
/// Emits `library:import-progress` per file and checks the cancel flag between
/// them. Cancelling keeps whatever was already imported.
#[tauri::command(async)]
pub fn library_import(
    app: AppHandle,
    paths: Vec<String>,
    control: State<'_, ImportControl>,
) -> Result<Vec<LibraryTrack>, String> {
    control.reset();

    let store = store(&app)?;
    let library_path = library_path(&app)?;
    let mut tracks = read_library(&library_path);
    let total = paths.len();
    let mut added = Vec::new();

    for (index, raw_path) in paths.iter().enumerate() {
        if control.is_cancelled() {
            break;
        }

        let source = PathBuf::from(raw_path);
        let name = source
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| raw_path.clone());

        let _ = app.emit(
            "library:import-progress",
            ImportProgress {
                done: index,
                total,
                current_name: name.clone(),
            },
        );

        // Re-check here as well as in `summarize`: the two calls are separated
        // by a confirmation dialog the user may have taken their time over.
        if tracks.iter().any(|t| t.source_path == *raw_path) {
            continue;
        }

        let id = new_id();
        let stored_file = match store.take_in(&source, &id) {
            Ok(name) => name,
            Err(e) => {
                // One unreadable file should not abandon the rest of the import.
                eprintln!("[library] skipping {raw_path}: {e}");
                continue;
            }
        };

        // Tags come from our own copy, so the entry is complete even if the
        // original disappears a moment later — but the filename fallback has to
        // come from the source. The copy is named after a generated id, and an
        // untagged file named after it would show a random string as its title.
        let scanned = metadata::read_track_named(&store.path_of(&stored_file), &source);
        // Artwork comes out now, while the copy is fresh — the sidecar is what
        // the webview renders, via the store directory's asset grant.
        let cover_file = metadata::extract_picture_to(&store.path_of(&stored_file), &store.root, &id);
        let track = LibraryTrack {
            id,
            stored_file,
            source_path: raw_path.clone(),
            title: scanned.title,
            artist: scanned.artist,
            album: scanned.album,
            duration_ms: scanned.duration_ms,
            // The scan can say "has art" while extraction says "nothing usable"
            // (oversized booklet scans, corrupt pictures). The sidecar is what
            // actually renders, so it decides.
            has_cover_art: cover_file.is_some(),
            cover_file,
            added_at: now_secs(),
        };

        tracks.push(track.clone());
        added.push(track);

        // Best effort: a failure here is not worth abandoning an import that is
        // otherwise working, and the final write below reports it properly.
        if added.len() % IMPORT_FLUSH_EVERY == 0 {
            if let Err(e) = write_library(&library_path, &tracks) {
                eprintln!("[library] could not checkpoint the library: {e}");
            }
        }
    }

    write_library(&library_path, &tracks)?;

    let _ = app.emit(
        "library:import-progress",
        ImportProgress {
            done: total,
            total,
            current_name: String::new(),
        },
    );

    Ok(added)
}

#[tauri::command]
pub fn library_cancel_import(control: State<'_, ImportControl>) {
    control.cancel();
}

/// Remove a track and delete the copy it owns.
#[tauri::command(async)]
pub fn library_remove(app: AppHandle, id: String) -> Result<(), String> {
    let library_path = library_path(&app)?;
    let mut tracks = read_library(&library_path);

    let Some(position) = tracks.iter().position(|t| t.id == id) else {
        return Ok(());
    };
    let removed = tracks.remove(position);

    let store = store(&app)?;
    store.discard(&removed.stored_file)?;
    if let Some(cover) = &removed.cover_file {
        // Best effort: an orphaned cover image wastes a few KB; it does not
        // justify failing the removal the user asked for.
        if let Err(e) = store.discard(cover) {
            eprintln!("[library] {e}");
        }
    }
    write_library(&library_path, &tracks)?;

    // The copy is gone, so any playlist row pointing at it could never play.
    crate::playlists::forget_library_track(&app, &id)
}

/// Absolute path of the store directory.
///
/// Asked for once at startup; the frontend joins `storedFile` onto it rather
/// than making a round trip per track.
#[tauri::command(async)]
pub fn library_store_dir(app: AppHandle) -> Result<String, String> {
    Ok(store(&app)?.root.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Scratch directory that cleans up after itself.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("groovium-test-{}", new_id()));
            fs::create_dir_all(&path).expect("temp dir");
            Self(path)
        }
        fn join(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn write_source(dir: &TempDir, name: &str, contents: &[u8]) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, contents).expect("write source");
        path
    }

    #[test]
    fn a_track_survives_deletion_of_its_source() {
        // The whole point of the phase: import copies the audio, so losing the
        // original must not lose the song.
        let dir = TempDir::new();
        let store = Store::new(dir.join("store"));
        let source = write_source(&dir, "song.mp3", b"audio-bytes");

        let stored = store.take_in(&source, "abc123").expect("import");
        fs::remove_file(&source).expect("delete the original");

        assert!(!source.exists());
        assert_eq!(
            fs::read(store.path_of(&stored)).expect("stored copy readable"),
            b"audio-bytes"
        );
    }

    #[test]
    fn stored_file_keeps_the_original_extension() {
        let dir = TempDir::new();
        let store = Store::new(dir.join("store"));
        let source = write_source(&dir, "song.FLAC", b"x");
        assert_eq!(store.take_in(&source, "id1").unwrap(), "id1.flac");
    }

    #[test]
    fn removing_deletes_the_copy() {
        let dir = TempDir::new();
        let store = Store::new(dir.join("store"));
        let source = write_source(&dir, "song.mp3", b"x");

        let stored = store.take_in(&source, "id2").unwrap();
        assert!(store.path_of(&stored).exists());

        store.discard(&stored).expect("discard");
        assert!(!store.path_of(&stored).exists());
    }

    #[test]
    fn discarding_something_already_gone_is_not_an_error() {
        let dir = TempDir::new();
        let store = Store::new(dir.join("store"));
        assert!(store.discard("never-existed.mp3").is_ok());
    }

    #[test]
    fn a_failed_copy_leaves_no_partial_file() {
        let dir = TempDir::new();
        let store = Store::new(dir.join("store"));

        let missing = dir.join("not-here.mp3");
        assert!(store.take_in(&missing, "id3").is_err());

        // Neither the partial nor the final name should be lying around.
        assert!(!store.path_of("id3.partial").exists());
        assert!(!store.path_of("id3.mp3").exists());
    }

    #[test]
    fn library_round_trips_through_json() {
        let dir = TempDir::new();
        let path = dir.join("library.json");

        let track = LibraryTrack {
            id: "id4".into(),
            stored_file: "id4.mp3".into(),
            source_path: r"C:\Music\song.mp3".into(),
            title: "Autobahn".into(),
            artist: "Kraftwerk".into(),
            album: "Autobahn".into(),
            duration_ms: 1234,
            has_cover_art: true,
            cover_file: Some("id4.cover.jpg".into()),
            added_at: 99,
        };

        write_library(&path, std::slice::from_ref(&track)).expect("write");
        assert_eq!(read_library(&path), vec![track]);
    }

    #[test]
    fn a_library_from_before_sidecar_covers_still_loads() {
        // `cover_file` was added without a version bump on purpose: bumping
        // would have discarded every existing library over one optional field.
        let dir = TempDir::new();
        let path = dir.join("library.json");
        fs::write(
            &path,
            r#"{"version":1,"tracks":[{"id":"a","storedFile":"a.mp3","sourcePath":"C:/x.mp3",
                "title":"T","artist":"A","album":"B","durationMs":1,"hasCoverArt":true,"addedAt":0}]}"#,
        )
        .unwrap();

        let tracks = read_library(&path);
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].cover_file, None, "old records read as None");
    }

    #[test]
    fn backfill_gives_up_on_a_track_with_no_extractable_art() {
        // A pre-sidecar record claims art, but the stored copy yields nothing
        // (here: not even audio). The flag must be cleared — otherwise every
        // launch would retry the extraction and rewrite the library.
        let dir = TempDir::new();
        let store = Store::new(dir.join("store"));
        fs::create_dir_all(&store.root).unwrap();
        fs::write(store.path_of("a.mp3"), b"not audio").unwrap();

        let mut tracks = vec![LibraryTrack {
            id: "a".into(),
            stored_file: "a.mp3".into(),
            source_path: String::new(),
            title: "T".into(),
            artist: "A".into(),
            album: "B".into(),
            duration_ms: 1,
            has_cover_art: true,
            cover_file: None,
            added_at: 0,
        }];

        assert!(backfill_covers(&mut tracks, &store), "the record changed");
        assert!(!tracks[0].has_cover_art);
        assert_eq!(tracks[0].cover_file, None);

        // Second pass has nothing left to do — the launch-loop guard.
        assert!(!backfill_covers(&mut tracks, &store));
    }

    #[test]
    fn backfill_leaves_settled_records_alone() {
        let dir = TempDir::new();
        let store = Store::new(dir.join("store"));

        let mut tracks = vec![
            LibraryTrack {
                id: "done".into(),
                stored_file: "done.mp3".into(),
                source_path: String::new(),
                title: "T".into(),
                artist: "A".into(),
                album: "B".into(),
                duration_ms: 1,
                has_cover_art: true,
                cover_file: Some("done.cover.jpg".into()),
                added_at: 0,
            },
            LibraryTrack {
                id: "artless".into(),
                stored_file: "artless.mp3".into(),
                source_path: String::new(),
                title: "T".into(),
                artist: "A".into(),
                album: "B".into(),
                duration_ms: 1,
                has_cover_art: false,
                cover_file: None,
                added_at: 0,
            },
        ];

        assert!(!backfill_covers(&mut tracks, &store), "nothing to do, no rewrite");
    }

    #[test]
    fn a_library_from_another_version_is_ignored() {
        let dir = TempDir::new();
        let path = dir.join("library.json");
        fs::write(&path, r#"{"version":999,"tracks":[{"id":"x"}]}"#).unwrap();
        assert!(read_library(&path).is_empty());
    }

    #[test]
    fn a_missing_library_reads_as_empty() {
        let dir = TempDir::new();
        assert!(read_library(&dir.join("nothing.json")).is_empty());
    }

    #[test]
    fn recognises_audio_extensions_case_insensitively() {
        assert!(is_audio_file(Path::new("a.mp3")));
        assert!(is_audio_file(Path::new("a.FLAC")));
        assert!(!is_audio_file(Path::new("cover.jpg")));
        assert!(!is_audio_file(Path::new("no-extension")));
    }

    #[test]
    fn cancelling_stops_the_flag_being_set_for_the_next_run() {
        // `library_import` resets before each run; a cancel from a previous
        // import must not abort the next one instantly.
        let control = ImportControl::default();
        control.cancel();
        assert!(control.is_cancelled());
        control.reset();
        assert!(!control.is_cancelled());
    }
}
