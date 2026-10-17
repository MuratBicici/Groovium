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
//!
//! A song can be linked instead, when the listener would rather not copy it:
//! listed, tagged and played from where it is, with nothing copied in but its
//! cover. Groovium cannot answer for a file it does not hold — moved, renamed
//! or deleted, a linked song no longer plays, and the library says so rather
//! than pretending. Each linked file gets an asset grant of its own, for that
//! file alone. Removing one forgets it; the file itself is never touched.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use walkdir::WalkDir;

use crate::lyrics::manual::{self, Candidates, Saved, SAVED_VERSION};
use crate::lyrics::{LyricsLookup, Pin};
use crate::metadata;

const LIBRARY_FILE: &str = "library.json";
/// Directory holding our copies, inside the app data directory.
const STORE_DIR: &str = "library";
const LIBRARY_VERSION: u32 = 1;

/// What the webview's own player can decode, which is what plays a local
/// song. WebM, MP4 and its audiobook twin M4B were tried in it and play;
/// Matroska is what it says it plays, with Opus or Vorbis inside. AIFF, ALAC,
/// WMA and APE it cannot, and they are not offered. `windows/hooks.nsh`
/// offers Groovium in "Open with" for exactly these.
const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "wav", "ogg", "oga", "opus", "m4a", "aac", "weba", "webm", "mp4", "m4b",
    "mka",
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
    /// Lyrics chosen by hand, saved in a file of their own inside the store
    /// directory (`lyrics::manual`). `None` for a song left to the automatic
    /// search, and on records from before the field existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lyrics: Option<LyricsMatch>,
    /// Played from where it is, nothing copied in but its cover: `stored_file`
    /// is empty and `source_path` is the file itself.
    #[serde(default, skip_serializing_if = "is_false")]
    pub linked: bool,
    /// A linked song whose file was not where it was at the last load. Worked
    /// out again on every load, never trusted from the file.
    #[serde(default, skip_serializing_if = "is_false")]
    pub missing: bool,
    pub added_at: u64,
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// Which lyrics a song was matched with by hand: the file they were saved in,
/// and enough about the record they came from to say so without opening it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LyricsMatch {
    pub file: String,
    pub source: String,
    pub track_name: String,
    pub artist_name: String,
    pub duration_ms: u32,
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
/// The files the picker has offered during this run.
///
/// `library_import` is handed a list of paths by the webview, which means the
/// page names the files Rust will copy. That round trip is what makes the
/// confirmation step possible — the summary goes up, a yes comes back — but it
/// leaves Rust unable to tell a path someone chose in a dialog from one the
/// page made up. Anything that ever reaches script execution in the webview
/// could otherwise copy a file from anywhere on disk into the library, where
/// the asset protocol will happily serve it back.
///
/// Remembering what was offered closes that loop: a path is importable only if
/// it came out of a dialog. Paths accumulate rather than replacing each other,
/// so a summary someone left sitting on screen while picking again is still
/// good.
pub struct PickedPaths(Mutex<HashSet<PathBuf>>);

impl PickedPaths {
    fn offer(&self, paths: &[PathBuf]) {
        let mut offered = self.0.lock().unwrap_or_else(|e| e.into_inner());
        offered.extend(paths.iter().cloned());
    }

    fn was_offered(&self, path: &Path) -> bool {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains(path)
    }
}

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

/// A single path component, with no directory in it and no way out of one.
fn is_bare_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && Path::new(name).components().count() == 1
        && name != ".."
        && name != "."
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

    /// Where a stored file lives, if its name is one this store could have
    /// written.
    ///
    /// `Path::join` replaces the base outright when handed an absolute path,
    /// and walks up for `..`. These names are read back from `library.json`,
    /// which is an ordinary file that nothing stops anyone editing — so
    /// without this check a doctored entry could aim `discard` at any file the
    /// user is able to delete, or aim a cover read at any file they can read.
    pub fn path_of(&self, stored_file: &str) -> Option<PathBuf> {
        is_bare_name(stored_file).then(|| self.root.join(stored_file))
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

    /// Write a cover chosen by hand, and return its name in the store.
    ///
    /// `owner` is what it belongs to — a track's id, or `playlist-` and a
    /// playlist's — and it must be a bare name like every other file here.
    /// Each cover gets a new name rather than overwriting the last: the
    /// webview caches an image by its address, and a new picture at the old
    /// address was the old picture for as long as the cache kept it.
    pub fn put_cover(&self, owner: &str, jpeg_base64: &str) -> Result<String, String> {
        let bytes = cover_bytes(jpeg_base64)?;
        self.put_new(format!("{owner}.cover-{}.jpg", new_id()), &bytes, "the cover")
    }

    /// Write lyrics chosen by hand, and return their name in the store. A new
    /// name each time, for the reason a cover has one.
    pub fn put_lyrics(&self, owner: &str, json: &str) -> Result<String, String> {
        self.put_new(format!("{owner}.lyrics-{}.json", new_id()), json.as_bytes(), "the lyrics")
    }

    /// Lyrics saved by `put_lyrics`, if `name` is one and they can be read as
    /// this build writes them.
    pub fn read_lyrics(&self, name: &str) -> Option<Saved> {
        let raw = fs::read_to_string(self.path_of(name)?)
            .map_err(|e| log::warn!("[library] could not read {name}: {e}"))
            .ok()?;
        let saved: Saved = serde_json::from_str(&raw)
            .map_err(|e| log::warn!("[library] unreadable lyrics in {name}: {e}"))
            .ok()?;
        (saved.version == SAVED_VERSION).then_some(saved)
    }

    /// A file of ours under `name`, written beside it and renamed into place so
    /// a failure cannot leave half of it. `what` is how an error names it.
    fn put_new(&self, name: String, bytes: &[u8], what: &str) -> Result<String, String> {
        if !is_bare_name(&name) {
            return Err(format!("That is not something {what} can belong to."));
        }
        fs::create_dir_all(&self.root)
            .map_err(|e| format!("Could not create the library folder: {e}"))?;
        let path = self.root.join(&name);
        let temp = self.root.join(format!("{name}.partial"));
        fs::write(&temp, bytes).map_err(|e| {
            let _ = fs::remove_file(&temp);
            format!("Could not save {what}: {e}")
        })?;
        fs::rename(&temp, &path).map_err(|e| {
            let _ = fs::remove_file(&temp);
            format!("Could not save {what}: {e}")
        })?;
        Ok(name)
    }

    pub fn discard(&self, stored_file: &str) -> Result<(), String> {
        let Some(path) = self.path_of(stored_file) else {
            return Err(format!("{stored_file} is not a name this store wrote."));
        };
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            // Already gone is the outcome we wanted.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("Could not delete {}: {e}", path.display())),
        }
    }
}

/// The largest cover accepted. The crop sends a JPEG of a quarter of a
/// megabyte; this is room for anything sensible and nothing absurd.
const COVER_MAX_BYTES: usize = 4 * 1024 * 1024;

/// A cover as sent from the webview: base64 JPEG, checked before it is kept.
fn cover_bytes(jpeg_base64: &str) -> Result<Vec<u8>, String> {
    let bytes = STANDARD
        .decode(jpeg_base64.trim())
        .map_err(|_| String::from("That picture could not be read."))?;
    if bytes.len() > COVER_MAX_BYTES {
        return Err("That picture is too large.".into());
    }
    // Every JPEG starts with this, and the crop only ever makes JPEGs.
    if !bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Err("That picture is not a JPEG.".into());
    }
    Ok(bytes)
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
            log::warn!("[library] ignoring unreadable library file: {e}");
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
        // A linked song's art is in its own file, and a file that is not there
        // now may be back: tried again next time rather than given up on.
        let audio = if track.linked {
            let file = PathBuf::from(&track.source_path);
            if !file.is_file() {
                continue;
            }
            Some(file)
        } else {
            // A name this store could not have written is a tampered record,
            // not a track with artwork waiting to be found.
            store.path_of(&track.stored_file)
        };
        let extracted =
            audio.and_then(|file| metadata::extract_picture_to(&file, &store.root, &track.id));
        match extracted {
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

pub(crate) fn store(app: &AppHandle) -> Result<Store, String> {
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
    look_for_linked(&app, &mut tracks);
    if backfill_covers(&mut tracks, &store) {
        write_library(&library_path, &tracks)?;
    }
    Ok(tracks)
}

/// Ask for files and report what importing them would involve.
#[tauri::command(async)]
pub fn library_pick_files(
    app: AppHandle,
    picked: State<'_, PickedPaths>,
) -> Result<Option<ScanSummary>, String> {
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

    picked.offer(&paths);
    Ok(Some(summarize(&app, paths)?))
}

/// Ask for a folder and report what importing it would involve.
///
/// Separate from the copy so the frontend can say "240 files, 1.8 GB" and wait
/// for a yes. Duplicating an archive silently would be rude.
#[tauri::command(async)]
pub fn library_pick_folder(
    app: AppHandle,
    picked: State<'_, PickedPaths>,
) -> Result<Option<ScanSummary>, String> {
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

    let paths = audio_files_in(&root);
    picked.offer(&paths);
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

/// The audio files in a folder and the folders under it.
fn audio_files_in(root: &Path) -> Vec<PathBuf> {
    WalkDir::new(root)
        .max_depth(MAX_SCAN_DEPTH)
        .into_iter()
        // Skip unreadable directories rather than abandoning the whole scan.
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file() && is_audio_file(e.path()))
        .map(|e| e.path().to_path_buf())
        .collect()
}

/// How a file comes into the library: copied into the store, or linked where
/// it is.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Bring {
    Copy,
    Link,
}

/// Let the webview read one linked file, and nothing beside it. Audio only: a
/// record is a file anyone can edit, and a grant made from it should not be
/// able to reach a document.
fn grant(app: &AppHandle, file: &Path) {
    if !is_audio_file(file) {
        return;
    }
    if let Err(e) = app.asset_protocol_scope().allow_file(file) {
        log::warn!("[library] could not grant access to {}: {e}", file.display());
    }
}

/// Mark the linked songs whose files are not there, and grant the rest.
fn look_for_linked(app: &AppHandle, tracks: &mut [LibraryTrack]) {
    for file in mark_missing(tracks) {
        grant(app, &file);
    }
}

/// Mark the linked songs whose files are not there; the files that are.
fn mark_missing(tracks: &mut [LibraryTrack]) -> Vec<PathBuf> {
    let mut present = Vec::new();
    for track in tracks.iter_mut().filter(|t| t.linked) {
        let file = PathBuf::from(&track.source_path);
        track.missing = !file.is_file();
        if !track.missing {
            present.push(file);
        }
    }
    present
}

/// What a store holds for a track and should go with it: its copy, unless it
/// is linked and has none, its cover and its lyrics. Never a linked song's
/// own file, which is not in the store and not ours.
fn owned_files(track: &LibraryTrack) -> Vec<&str> {
    let copy = (!track.linked).then_some(track.stored_file.as_str());
    copy.into_iter()
        .chain(track.cover_file.as_deref())
        .chain(track.lyrics.as_ref().map(|l| l.file.as_str()))
        .collect()
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
    picked: State<'_, PickedPaths>,
) -> Result<Vec<LibraryTrack>, String> {
    refuse_uninvited(&paths, &picked)?;
    bring_in(&app, &paths, &control, Bring::Copy)
}

/// Add the given files without copying them: linked, played from where they
/// are. The same progress and the same cancel as an import.
#[tauri::command(async)]
pub fn library_link(
    app: AppHandle,
    paths: Vec<String>,
    control: State<'_, ImportControl>,
    picked: State<'_, PickedPaths>,
) -> Result<Vec<LibraryTrack>, String> {
    refuse_uninvited(&paths, &picked)?;
    bring_in(&app, &paths, &control, Bring::Link)
}

/// A path that never came out of a dialog — or a drop, or the system opening
/// a file with Groovium — is not a file anyone asked for. Refused as a whole
/// rather than quietly filtered, because in normal use this cannot happen:
/// the frontend hands back exactly the list it was given. The count is
/// reported and the paths are not, so nothing invented gets echoed into the
/// interface.
fn refuse_uninvited(paths: &[String], picked: &PickedPaths) -> Result<(), String> {
    let uninvited = paths
        .iter()
        .filter(|raw| !picked.was_offered(Path::new(raw)))
        .count();
    if uninvited > 0 {
        return Err(format!(
            "{uninvited} of these files were never chosen in a file dialog, so nothing was added."
        ));
    }
    Ok(())
}

fn bring_in(
    app: &AppHandle,
    paths: &[String],
    control: &ImportControl,
    how: Bring,
) -> Result<Vec<LibraryTrack>, String> {
    control.reset();

    let store = store(app)?;
    let library_path = library_path(app)?;
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

        let Some(track) = make_track(app, &store, &source, raw_path, how) else {
            continue;
        };
        tracks.push(track.clone());
        added.push(track);

        // Best effort: a failure here is not worth abandoning an import that is
        // otherwise working, and the final write below reports it properly.
        if added.len() % IMPORT_FLUSH_EVERY == 0 {
            if let Err(e) = write_library(&library_path, &tracks) {
                log::warn!("[library] could not checkpoint the library: {e}");
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

/// One file as a record: copied in, or linked. None for a file that cannot be
/// read, which should not abandon the rest of an import.
fn make_track(
    app: &AppHandle,
    store: &Store,
    source: &Path,
    raw_path: &str,
    how: Bring,
) -> Option<LibraryTrack> {
    let track = record_for(store, source, raw_path, how)?;
    if track.linked {
        grant(app, source);
    }
    Some(track)
}

/// `make_track` without the grant, which is all that needs the app.
fn record_for(store: &Store, source: &Path, raw_path: &str, how: Bring) -> Option<LibraryTrack> {
    let id = new_id();
    let (stored_file, audio) = match how {
        Bring::Copy => {
            let stored_file = match store.take_in(source, &id) {
                Ok(name) => name,
                Err(e) => {
                    log::warn!("[library] skipping {raw_path}: {e}");
                    return None;
                }
            };
            // `take_in` generated this name, so it is always one the store
            // could have written; the check is here because `path_of` promises
            // it rather than because this call site is in doubt.
            let copy = store.path_of(&stored_file)?;
            (stored_file, copy)
        }
        Bring::Link => {
            if !source.is_file() {
                log::warn!("[library] skipping {raw_path}: not a file");
                return None;
            }
            (String::new(), source.to_path_buf())
        }
    };

    // Tags come from our own copy when there is one, so the entry is complete
    // even if the original disappears a moment later — but the filename
    // fallback has to come from the source. The copy is named after a
    // generated id, and an untagged file named after it would show a random
    // string as its title.
    let scanned = metadata::read_track_named(&audio, source);
    // Artwork comes out now, into the store either way — the sidecar is what
    // the webview renders, via the store directory's asset grant.
    let cover_file = metadata::extract_picture_to(&audio, &store.root, &id);
    Some(LibraryTrack {
        id,
        stored_file,
        source_path: raw_path.to_string(),
        title: scanned.title,
        artist: scanned.artist,
        album: scanned.album,
        duration_ms: scanned.duration_ms,
        // The scan can say "has art" while extraction says "nothing usable"
        // (oversized booklet scans, corrupt pictures). The sidecar is what
        // actually renders, so it decides.
        has_cover_art: cover_file.is_some(),
        cover_file,
        lyrics: None,
        linked: how == Bring::Link,
        missing: false,
        added_at: now_secs(),
    })
}

/// Copy a linked song into the library after all, so it stops depending on
/// its file. The same record and the same id, so its lyrics, its timing and
/// its places in playlists all stay. `missing` when the file is not there.
#[tauri::command(async)]
pub fn library_copy_in(app: AppHandle, id: String) -> Result<LibraryTrack, String> {
    let library_path = library_path(&app)?;
    let mut tracks = read_library(&library_path);
    let Some(track) = tracks.iter_mut().find(|t| t.id == id) else {
        return Err("That song is no longer in the library.".into());
    };
    if !track.linked {
        return Ok(track.clone());
    }
    let source = PathBuf::from(&track.source_path);
    if !source.is_file() {
        return Err("missing".into());
    }
    track.stored_file = store(&app)?.take_in(&source, &track.id)?;
    track.linked = false;
    track.missing = false;
    let updated = track.clone();
    write_library(&library_path, &tracks)?;
    Ok(updated)
}

/// What the window is given by a drag from outside: shown while it hovers,
/// and once let go, summarised like a pick, so the listener is asked whether
/// to copy before anything is added. The files are offered as a dialog's
/// would be: dropping them was choosing them.
pub fn on_drag_drop(app: &AppHandle, event: &DragDropEvent) {
    match event {
        DragDropEvent::Enter { .. } => {
            let _ = app.emit("library:drop-hover", true);
        }
        DragDropEvent::Leave => {
            let _ = app.emit("library:drop-hover", false);
        }
        DragDropEvent::Drop { paths, .. } => {
            let _ = app.emit("library:drop-hover", false);
            let app = app.clone();
            let paths = paths.clone();
            // A dropped folder is walked, which can take a while; not on the
            // thread the window runs on.
            tauri::async_runtime::spawn_blocking(move || {
                let files = audio_files_among(&paths);
                app.state::<PickedPaths>().offer(&files);
                match summarize(&app, files) {
                    Ok(summary) => {
                        let _ = app.emit("library:dropped", summary);
                    }
                    Err(e) => log::warn!("[library] could not read what was dropped: {e}"),
                }
            });
        }
        _ => {}
    }
}

/// The audio files among things dropped: files as they are, folders walked.
fn audio_files_among(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for path in paths {
        if path.is_dir() {
            files.extend(audio_files_in(path));
        } else if path.is_file() && is_audio_file(path) {
            files.push(path.clone());
        }
    }
    files
}

/// Songs opened with Groovium from outside — "Open with", a double click —
/// before the webview was there to hear of it.
#[derive(Default)]
pub struct Opened(Mutex<Vec<String>>);

impl Opened {
    pub fn hold(&self, ids: Vec<String>) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).extend(ids);
    }
}

/// Link the audio files the system opened with Groovium, or find them where
/// they are already in the library, and return their ids in the order given.
/// Taken as chosen: the listener picked them, in Explorer rather than in a
/// dialog of ours. Anything else on the command line is ignored.
pub fn open_with(app: &AppHandle, args: impl IntoIterator<Item = String>) -> Vec<String> {
    let files: Vec<PathBuf> = args
        .into_iter()
        .map(PathBuf::from)
        .filter(|p| p.is_file() && is_audio_file(p))
        .collect();
    if files.is_empty() {
        return Vec::new();
    }
    let (Ok(library_path), Ok(store)) = (library_path(app), store(app)) else {
        return Vec::new();
    };
    let mut tracks = read_library(&library_path);
    let mut ids = Vec::new();
    let mut changed = false;
    for file in files {
        let raw = file.to_string_lossy().into_owned();
        if let Some(known) = tracks.iter().find(|t| t.source_path == raw) {
            if known.linked {
                grant(app, &file);
            }
            ids.push(known.id.clone());
            continue;
        }
        if let Some(track) = make_track(app, &store, &file, &raw, Bring::Link) {
            ids.push(track.id.clone());
            tracks.push(track);
            changed = true;
        }
    }
    if changed {
        if let Err(e) = write_library(&library_path, &tracks) {
            log::warn!("[library] could not keep the songs opened with Groovium: {e}");
        }
    }
    ids
}

/// The songs opened with Groovium before the webview had loaded, once.
#[tauri::command]
pub fn library_take_opened(opened: State<'_, Opened>) -> Vec<String> {
    std::mem::take(&mut *opened.0.lock().unwrap_or_else(|e| e.into_inner()))
}

#[tauri::command]
pub fn library_cancel_import(control: State<'_, ImportControl>) {
    control.cancel();
}

/// Remove a track and delete the copy it owns. A linked song owns no copy:
/// only its record and what the store holds for it go, never its file.
#[tauri::command(async)]
pub fn library_remove(app: AppHandle, id: String) -> Result<(), String> {
    let library_path = library_path(&app)?;
    let mut tracks = read_library(&library_path);

    let Some(position) = tracks.iter().position(|t| t.id == id) else {
        return Ok(());
    };
    let removed = tracks.remove(position);

    let store = store(&app)?;
    let mut owned = owned_files(&removed).into_iter();
    // The copy first, and not best effort: a song whose audio could not be
    // deleted stays in the library rather than leaving the file orphaned.
    if !removed.linked {
        if let Some(copy) = owned.next() {
            store.discard(copy)?;
        }
    }
    // Best effort, the rest: an orphaned cover or lyrics file wastes a few KB;
    // it does not justify failing the removal the user asked for.
    for file in owned {
        if let Err(e) = store.discard(file) {
            log::warn!("[library] {e}");
        }
    }
    write_library(&library_path, &tracks)?;

    // The copy is gone, so any playlist row pointing at it could never play.
    crate::playlists::forget_library_track(&app, &id)
}

/// A text field as a person typed it: trimmed, and not too long to show.
fn clean_field(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return fallback.to_string();
    }
    trimmed.chars().take(200).collect()
}

/// Change what a song is called: its title, artist and album.
///
/// The app's own record only. The audio file's tags are left alone — this is
/// the library's copy, and the name shown is the library's business.
#[tauri::command(async)]
pub fn library_update_track(
    app: AppHandle,
    id: String,
    title: String,
    artist: String,
    album: String,
) -> Result<LibraryTrack, String> {
    let library_path = library_path(&app)?;
    let mut tracks = read_library(&library_path);
    let Some(track) = tracks.iter_mut().find(|t| t.id == id) else {
        return Err("That song is no longer in the library.".into());
    };
    if title.trim().is_empty() {
        return Err("A song needs a title.".into());
    }
    track.title = clean_field(&title, &track.title);
    track.artist = artist.trim().chars().take(200).collect();
    track.album = album.trim().chars().take(200).collect();
    let updated = track.clone();
    write_library(&library_path, &tracks)?;
    Ok(updated)
}

/// Give a song a cover chosen by hand, in place of whatever it had.
#[tauri::command(async)]
pub fn library_set_cover(app: AppHandle, id: String, jpeg: String) -> Result<LibraryTrack, String> {
    let library_path = library_path(&app)?;
    let mut tracks = read_library(&library_path);
    let Some(track) = tracks.iter_mut().find(|t| t.id == id) else {
        return Err("That song is no longer in the library.".into());
    };
    let store = store(&app)?;
    let name = store.put_cover(&track.id, &jpeg)?;
    let old = track.cover_file.replace(name);
    track.has_cover_art = true;
    let updated = track.clone();
    write_library(&library_path, &tracks)?;
    // After the record points at the new one, so a failure here costs a few
    // kilobytes and never a song without a cover.
    if let Some(old) = old {
        if let Err(e) = store.discard(&old) {
            log::warn!("[library] {e}");
        }
    }
    Ok(updated)
}

/// Match a song with lyrics found by hand: `key` names a candidate from a
/// search (`lyrics::manual`). The lyrics are saved beside the song, in place
/// of any it had, so they play without asking anyone again.
#[tauri::command]
pub async fn library_set_lyrics(
    app: AppHandle,
    found: State<'_, Candidates>,
    id: String,
    key: String,
) -> Result<LibraryTrack, String> {
    let picked = manual::take(&found, &key).await?;
    let saved = Saved::from_picked(&picked);
    let json = serde_json::to_string(&saved).map_err(|e| e.to_string())?;

    let library_path = library_path(&app)?;
    let mut tracks = read_library(&library_path);
    let Some(track) = tracks.iter_mut().find(|t| t.id == id) else {
        return Err("That song is no longer in the library.".into());
    };
    let store = store(&app)?;
    let file = store.put_lyrics(&track.id, &json)?;
    let old = track.lyrics.replace(LyricsMatch {
        file,
        source: saved.source,
        track_name: saved.track_name,
        artist_name: saved.artist_name,
        duration_ms: saved.duration_ms,
    });
    let updated = track.clone();
    write_library(&library_path, &tracks)?;
    // After the record points at the new file, as with a cover.
    if let Some(old) = old {
        if let Err(e) = store.discard(&old.file) {
            log::warn!("[library] {e}");
        }
    }
    Ok(updated)
}

/// Keep the listener's retiming of a song's matched lyrics, or forget it with
/// `None`. Written as a new file and swapped in, as a new match is, so a
/// failure leaves the old timing rather than half of the new one.
#[tauri::command(async)]
pub fn library_set_lyrics_timing(
    app: AppHandle,
    id: String,
    timing: Option<Vec<Pin>>,
) -> Result<LibraryTrack, String> {
    let library_path = library_path(&app)?;
    let mut tracks = read_library(&library_path);
    let Some(track) = tracks.iter_mut().find(|t| t.id == id) else {
        return Err("That song is no longer in the library.".into());
    };
    let Some(matched) = track.lyrics.as_mut() else {
        return Err("That song has no lyrics matched to it.".into());
    };
    let store = store(&app)?;
    let Some(mut saved) = store.read_lyrics(&matched.file) else {
        return Err("The lyrics matched to that song could not be read.".into());
    };
    if let Some(pins) = &timing {
        if !manual::timing_fits(pins, &saved.result) {
            return Err("That timing does not fit these lyrics.".into());
        }
    }
    saved.timing = timing;
    let json = serde_json::to_string(&saved).map_err(|e| e.to_string())?;
    let file = store.put_lyrics(&track.id, &json)?;
    let old = std::mem::replace(&mut matched.file, file);
    let updated = track.clone();
    write_library(&library_path, &tracks)?;
    if let Err(e) = store.discard(&old) {
        log::warn!("[library] {e}");
    }
    Ok(updated)
}

/// Forget the lyrics matched to a song by hand. A song on this computer is
/// never looked up on its own, so it has none until it is matched again.
#[tauri::command(async)]
pub fn library_clear_lyrics(app: AppHandle, id: String) -> Result<LibraryTrack, String> {
    let library_path = library_path(&app)?;
    let mut tracks = read_library(&library_path);
    let Some(track) = tracks.iter_mut().find(|t| t.id == id) else {
        return Err("That song is no longer in the library.".into());
    };
    let old = track.lyrics.take();
    let updated = track.clone();
    write_library(&library_path, &tracks)?;
    if let Some(old) = old {
        if let Err(e) = store(&app)?.discard(&old.file) {
            log::warn!("[library] {e}");
        }
    }
    Ok(updated)
}

/// The lyrics a song was matched with by hand, if it was. `track_id` is the
/// player's, `library:<id>`; anything else has none.
pub fn saved_lyrics(app: &AppHandle, track_id: &str) -> Option<LyricsLookup> {
    let id = track_id.strip_prefix("library:")?;
    let tracks = read_library(&library_path(app).ok()?);
    let file = tracks.into_iter().find(|t| t.id == id)?.lyrics?.file;
    Some(store(app).ok()?.read_lyrics(&file)?.into_lookup())
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
    #[test]
    fn every_extension_added_is_offered_in_open_with() {
        // The installer's list is written out by hand; this keeps it whole.
        let hooks = include_str!("../windows/hooks.nsh");
        for ext in AUDIO_EXTENSIONS {
            assert!(hooks.contains(&format!("${{MACRO}} \"{ext}\"")), "{ext} is not in windows/hooks.nsh");
        }
    }

    #[test]
    fn a_record_from_before_linking_is_a_copy() {
        let old = r#"{"version":1,"tracks":[{"id":"a","storedFile":"a.mp3","sourcePath":"C:\\Music\\a.mp3","title":"A","artist":"B","album":"C","durationMs":1,"hasCoverArt":false,"addedAt":1}]}"#;
        let file: LibraryFile = serde_json::from_str(old).expect("reads");
        assert!(!file.tracks[0].linked);
        assert!(!file.tracks[0].missing);
        // And a copy says nothing about either when written again.
        let json = serde_json::to_string(&file.tracks[0]).unwrap();
        assert!(!json.contains("linked") && !json.contains("missing"));
    }

    #[test]
    fn a_linked_song_is_read_where_it_is_and_nothing_is_copied() {
        let dir = TempDir::new();
        let store = Store::new(dir.join("store"));
        fs::create_dir_all(&store.root).unwrap();
        let source = write_source(&dir, "Some Artist - Some Song.mp3", b"not really audio");
        let raw = source.to_string_lossy().into_owned();

        let track = record_for(&store, &source, &raw, Bring::Link).expect("a record");
        assert!(track.linked);
        assert!(track.stored_file.is_empty());
        assert_eq!(track.source_path, raw);
        // Named from the file, as an untagged copy would be.
        assert_eq!(track.title, "Some Song");
        // Nothing of the audio went into the store.
        let in_store: Vec<_> = fs::read_dir(&store.root).unwrap().collect();
        assert!(in_store.is_empty(), "{in_store:?}");

        // A file that is not there is not linked.
        let gone = dir.join("gone.mp3");
        assert!(record_for(&store, &gone, &gone.to_string_lossy(), Bring::Link).is_none());
    }

    #[test]
    fn removing_a_linked_song_leaves_its_file_alone() {
        let mut track = test_track("a");
        track.linked = true;
        track.stored_file = String::new();
        track.cover_file = Some("a.cover-x.jpg".into());
        assert_eq!(owned_files(&track), vec!["a.cover-x.jpg"]);
        track.linked = false;
        track.stored_file = "a.mp3".into();
        assert_eq!(owned_files(&track), vec!["a.mp3", "a.cover-x.jpg"]);
    }

    #[test]
    fn a_linked_song_whose_file_went_is_marked_and_comes_back_when_it_does() {
        let dir = TempDir::new();
        let source = write_source(&dir, "song.mp3", b"x");
        let mut linked = test_track("a");
        linked.linked = true;
        linked.source_path = source.to_string_lossy().into_owned();
        let copied = test_track("b");
        let mut tracks = vec![linked, copied];

        assert_eq!(mark_missing(&mut tracks), vec![source.clone()]);
        assert!(!tracks[0].missing);
        fs::remove_file(&source).unwrap();
        assert!(mark_missing(&mut tracks).is_empty());
        assert!(tracks[0].missing);
        // A copy is never missing: its audio is ours.
        assert!(!tracks[1].missing);
        fs::write(&source, b"x").unwrap();
        mark_missing(&mut tracks);
        assert!(!tracks[0].missing);
    }

    #[test]
    fn what_is_dropped_is_its_audio_files_and_the_audio_in_its_folders() {
        let dir = TempDir::new();
        let song = write_source(&dir, "song.mp3", b"x");
        let note = write_source(&dir, "notes.txt", b"x");
        fs::create_dir_all(dir.join("album/disc 1")).unwrap();
        let deep = dir.join("album/disc 1/track.flac");
        fs::write(&deep, b"x").unwrap();
        fs::write(dir.join("album/cover.jpg"), b"x").unwrap();

        let mut found = audio_files_among(&[song.clone(), note, dir.join("album")]);
        found.sort();
        let mut expected = vec![song, deep];
        expected.sort();
        assert_eq!(found, expected);
    }

    fn test_track(id: &str) -> LibraryTrack {
        LibraryTrack {
            id: id.into(),
            stored_file: format!("{id}.mp3"),
            source_path: format!(r"C:\Music\{id}.mp3"),
            title: "Song".into(),
            artist: "Band".into(),
            album: "Album".into(),
            duration_ms: 1000,
            has_cover_art: false,
            cover_file: None,
            lyrics: None,
            linked: false,
            missing: false,
            added_at: 1,
        }
    }

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
            fs::read(store.path_of(&stored).expect("a bare name")).expect("stored copy readable"),
            b"audio-bytes"
        );
    }

    #[test]
    fn a_stored_name_that_is_a_path_is_refused() {
        // `library.json` is an ordinary file on disk. A doctored entry must not
        // be able to aim the store at something outside itself — `join` swaps
        // the base out entirely for an absolute path, and honours `..`.
        let dir = TempDir::new();
        let store = Store::new(dir.join("store"));

        for hostile in [
            "../../secrets.txt",
            r"..\..\secrets.txt",
            "/etc/passwd",
            r"C:\Windows\System32\drivers\etc\hosts",
            "sub/dir.mp3",
            "..",
            "",
        ] {
            assert!(store.path_of(hostile).is_none(), "{hostile} is not a bare name");
            assert!(store.discard(hostile).is_err(), "{hostile} cannot be deleted");
        }

        assert!(store.path_of("abc123.mp3").is_some());
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
        assert!(store.path_of(&stored).expect("a bare name").exists());

        store.discard(&stored).expect("discard");
        assert!(!store.path_of(&stored).expect("a bare name").exists());
    }

    #[test]
    fn a_cover_is_kept_only_when_it_is_a_jpeg_of_sensible_size() {
        let jpeg = STANDARD.encode([0xFF, 0xD8, 0xFF, 0xE0, 0, 1, 2, 3]);
        assert!(cover_bytes(&jpeg).is_ok());
        let png = STANDARD.encode([0x89, b'P', b'N', b'G']);
        assert!(cover_bytes(&png).is_err());
        assert!(cover_bytes("not base64 at all!").is_err());
        let huge = STANDARD.encode(vec![0xFFu8; COVER_MAX_BYTES + 1]);
        assert!(cover_bytes(&huge).is_err());
    }

    #[test]
    fn a_cover_gets_a_new_name_each_time_inside_the_store() {
        let dir = TempDir::new();
        let store = Store::new(dir.0.clone());
        let jpeg = STANDARD.encode([0xFF, 0xD8, 0xFF, 0xE0]);
        let first = store.put_cover("abc", &jpeg).expect("written");
        let second = store.put_cover("abc", &jpeg).expect("written");
        assert_ne!(first, second, "a new address, so no cache shows the old one");
        assert!(store.path_of(&first).is_some_and(|p| p.exists()));
        assert!(store.put_cover("../escape", &jpeg).is_err());
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
        assert!(!store.path_of("id3.partial").expect("a bare name").exists());
        assert!(!store.path_of("id3.mp3").expect("a bare name").exists());
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
            lyrics: None,
            linked: false,
            missing: false,
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
        // Nor did `lyrics` bump it, for the same reason.
        assert_eq!(tracks[0].lyrics, None);
    }

    #[test]
    fn lyrics_matched_by_hand_are_saved_and_read_back() {
        let dir = TempDir::new();
        let store = Store::new(dir.0.clone());
        let saved = Saved {
            version: SAVED_VERSION,
            source: "lrclib".into(),
            source_id: "7".into(),
            track_name: "Song".into(),
            artist_name: "Band".into(),
            album_name: "Album".into(),
            duration_ms: 180_000,
            result: crate::lyrics::LyricsResult::Plain("words".into()),
            timing: None,
        };
        let name = store
            .put_lyrics("abc", &serde_json::to_string(&saved).unwrap())
            .expect("written");
        assert!(name.starts_with("abc.lyrics-") && name.ends_with(".json"));
        assert_eq!(store.read_lyrics(&name), Some(saved));

        // Nothing outside the store, written or read.
        assert!(store.put_lyrics("../escape", "{}").is_err());
        assert!(store.read_lyrics("../escape.json").is_none());
        // A file of another shape is not taken for lyrics.
        let other = store.put_lyrics("abc", r#"{"version":2}"#).expect("written");
        assert!(store.read_lyrics(&other).is_none());
    }

    #[test]
    fn backfill_gives_up_on_a_track_with_no_extractable_art() {
        // A pre-sidecar record claims art, but the stored copy yields nothing
        // (here: not even audio). The flag must be cleared — otherwise every
        // launch would retry the extraction and rewrite the library.
        let dir = TempDir::new();
        let store = Store::new(dir.join("store"));
        fs::create_dir_all(&store.root).unwrap();
        fs::write(store.path_of("a.mp3").expect("a bare name"), b"not audio").unwrap();

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
            lyrics: None,
            linked: false,
            missing: false,
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
                lyrics: None,
                linked: false,
                missing: false,
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
                lyrics: None,
                linked: false,
                missing: false,
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
