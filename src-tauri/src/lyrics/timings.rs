//! The listener's retiming of Spotify songs' lyrics, in a file of its own.
//!
//! A song on this computer keeps its retiming in the file its lyrics are
//! saved in. A Spotify song has no such file, so its timing is kept here, in
//! `lyrics-timing.json` beside the settings — a file somebody can see, back up
//! and carry to another computer, which the webview's own storage was not.
//! Export writes the same file wherever they choose; import reads one back and
//! merges it with what is here, the newer timing of a song winning.
//!
//! Each timing is kept with enough of the record it was set against — the
//! source, how many lines, the first of them — for the frontend to leave it
//! unused when the lyrics found are another (`timingChoice.ts`).
//!
//! The lyrics chosen by hand for Spotify songs (`chosen.rs`) go out in the
//! same exported file and come back in with it: the listener's own work on a
//! Spotify song's lyrics, carried together.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use super::chosen::{self, Chosen};
use super::Pin;

const FILE: &str = "lyrics-timing.json";
const VERSION: u32 = 1;

/// Enough songs for anyone's habits; the least recently retimed go first.
pub const KEEP: usize = 2_000;

/// One song's timing and the record it was set against.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Kept {
    pub source: String,
    pub lines: u32,
    pub first: String,
    pub timing: Vec<Pin>,
    /// When it was last set, in milliseconds since 1970: which of two wins.
    #[serde(default)]
    pub saved_at: u64,
}

#[derive(Serialize, Deserialize, Default)]
struct TimingsFile {
    version: u32,
    songs: HashMap<String, Kept>,
    /// Lyrics chosen by hand, in an exported file only; one exported before
    /// they were carried has none, and a build from then passes them over.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    chosen: HashMap<String, Chosen>,
}

/// Held for every read-modify-write of this file and of the chosen lyrics', so
/// a keep, a choice and an import cannot cross.
#[derive(Default)]
pub struct TimingsLock(Mutex<()>);

impl TimingsLock {
    pub fn hold(&self) -> Result<MutexGuard<'_, ()>, String> {
        self.0.lock().map_err(|e| e.to_string())
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Whether a timing could be one the strip set: the first and last line
/// pinned, the pins in order of line and of moment.
fn valid(kept: &Kept) -> bool {
    let (Some(first), Some(last)) = (kept.timing.first(), kept.timing.last()) else {
        return false;
    };
    kept.lines > 0
        && first.line == 0
        && last.line + 1 == kept.lines
        && kept.timing.windows(2).all(|w| w[0].line < w[1].line && w[0].ms < w[1].ms)
}

/// The songs in a file, or none when it is missing, another shape or unreadable.
fn read(path: &Path) -> HashMap<String, Kept> {
    let Ok(raw) = fs::read_to_string(path) else {
        return HashMap::new();
    };
    parse(&raw).map(|file| file.songs).unwrap_or_else(|| {
        log::warn!("[lyrics] ignoring an unreadable {}", path.display());
        HashMap::new()
    })
}

/// A timings file, with only what could be timings and chosen lyrics in it;
/// None when it is not one.
fn parse(raw: &str) -> Option<TimingsFile> {
    let file: TimingsFile = serde_json::from_str(raw).ok()?;
    (file.version == VERSION).then(|| TimingsFile {
        version: VERSION,
        songs: file.songs.into_iter().filter(|(_, k)| valid(k)).collect(),
        chosen: file.chosen.into_iter().filter(|(id, c)| chosen::valid(id, c)).collect(),
    })
}

fn write(path: &Path, songs: HashMap<String, Kept>) -> Result<(), String> {
    write_json(path, &TimingsFile { version: VERSION, songs, chosen: HashMap::new() })
}

/// Written whole beside the file and then put in its place, so a crash
/// half-way leaves the old one rather than half of a new one.
pub fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, json).map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    fs::rename(&temp, path).map_err(|e| format!("Could not replace {}: {e}", path.display()))
}

/// Down to `KEEP`, the most recently set kept.
fn trim(songs: &mut HashMap<String, Kept>) {
    if songs.len() <= KEEP {
        return;
    }
    let mut ages: Vec<(u64, String)> = songs.iter().map(|(id, k)| (k.saved_at, id.clone())).collect();
    ages.sort();
    for (_, id) in ages.into_iter().take(songs.len() - KEEP) {
        songs.remove(&id);
    }
}

/// Take in songs from elsewhere: a song not here, or set more recently there.
/// The songs taken.
fn merge(into: &mut HashMap<String, Kept>, from: HashMap<String, Kept>) -> Vec<String> {
    let mut taken = Vec::new();
    for (id, kept) in from {
        if !valid(&kept) {
            continue;
        }
        if into.get(&id).is_some_and(|here| here.saved_at > kept.saved_at) {
            continue;
        }
        into.insert(id.clone(), kept);
        taken.push(id);
    }
    trim(into);
    taken
}

/// How many songs, a song whose timing and chosen lyrics both came counted once.
fn songs_in(timed: impl IntoIterator<Item = String>, chosen: impl IntoIterator<Item = String>) -> usize {
    timed.into_iter().chain(chosen).collect::<HashSet<_>>().len()
}

fn timings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(FILE))
        .map_err(|e| format!("No app data directory available: {e}"))
}

/// Every Spotify song's timing.
#[tauri::command(async)]
pub fn lyrics_timings_load(app: AppHandle) -> Result<HashMap<String, Kept>, String> {
    Ok(read(&timings_path(&app)?))
}

/// Keep a song's timing, stamped now, or forget it with `None`.
#[tauri::command(async)]
pub fn lyrics_timing_keep(
    app: AppHandle,
    lock: State<'_, TimingsLock>,
    track_id: String,
    kept: Option<Kept>,
) -> Result<(), String> {
    let _held = lock.hold()?;
    let path = timings_path(&app)?;
    let mut songs = read(&path);
    match kept {
        Some(mut kept) => {
            if !valid(&kept) {
                return Err("That timing does not fit its lyrics.".into());
            }
            kept.saved_at = now_ms();
            songs.insert(track_id, kept);
            trim(&mut songs);
        }
        None => {
            if songs.remove(&track_id).is_none() {
                return Ok(());
            }
        }
    }
    write(&path, songs)
}

/// Take in timings the webview kept before they had a file. How many.
#[tauri::command(async)]
pub fn lyrics_timings_merge(
    app: AppHandle,
    lock: State<'_, TimingsLock>,
    songs: HashMap<String, Kept>,
) -> Result<usize, String> {
    let _held = lock.hold()?;
    let path = timings_path(&app)?;
    let mut here = read(&path);
    let taken = merge(&mut here, songs).len();
    if taken > 0 {
        write(&path, here)?;
    }
    Ok(taken)
}

/// Write every timing and every song's chosen lyrics to a file of the
/// listener's choosing. How many songs, or `None` when the dialog was closed.
#[tauri::command(async)]
pub fn lyrics_timings_export(app: AppHandle, lock: State<'_, TimingsLock>) -> Result<Option<usize>, String> {
    let (songs, chosen) = {
        let _held = lock.hold()?;
        (read(&timings_path(&app)?), chosen::read(&chosen::chosen_path(&app)?))
    };
    let Some(target) = app
        .dialog()
        .file()
        .set_title("Export lyrics timings")
        .set_file_name("groovium-lyrics-timing.json")
        .add_filter("JSON", &["json"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = target.into_path().map_err(|e| e.to_string())?;
    let count = songs_in(songs.keys().cloned(), chosen.keys().cloned());
    write_json(&path, &TimingsFile { version: VERSION, songs, chosen })?;
    Ok(Some(count))
}

/// Read timings and chosen lyrics exported elsewhere and merge them with these.
/// How many songs were taken, or `None` when the dialog was closed.
/// `unreadable` for a file that is not one.
#[tauri::command(async)]
pub fn lyrics_timings_import(app: AppHandle, lock: State<'_, TimingsLock>) -> Result<Option<usize>, String> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Import lyrics timings")
        .add_filter("JSON", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let source = picked.into_path().map_err(|_| "unreadable".to_string())?;
    let raw = fs::read_to_string(&source).map_err(|_| "unreadable".to_string())?;
    let incoming = parse(&raw).ok_or_else(|| "unreadable".to_string())?;

    let _held = lock.hold()?;
    let path = timings_path(&app)?;
    let mut here = read(&path);
    let timed = merge(&mut here, incoming.songs);
    write(&path, here)?;

    let chosen_path = chosen::chosen_path(&app)?;
    let mut chosen_here = chosen::read(&chosen_path);
    let chosen = chosen::merge(&mut chosen_here, incoming.chosen);
    if !chosen.is_empty() {
        chosen::write(&chosen_path, chosen_here)?;
    }
    Ok(Some(songs_in(timed, chosen)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kept(saved_at: u64) -> Kept {
        Kept {
            source: "lrclib".into(),
            lines: 3,
            first: "a line".into(),
            timing: vec![Pin { line: 0, ms: 1_000 }, Pin { line: 2, ms: 9_000 }],
            saved_at,
        }
    }

    #[test]
    fn a_file_reads_back_as_written_and_a_bad_one_as_nothing() {
        let dir = std::env::temp_dir().join(format!("groovium-timings-{}", now_ms()));
        let path = dir.join(FILE);
        assert!(read(&path).is_empty());

        let songs = HashMap::from([("spotify:track:a".to_string(), kept(5))]);
        write(&path, songs.clone()).unwrap();
        assert_eq!(read(&path), songs);

        fs::write(&path, "{not json").unwrap();
        assert!(read(&path).is_empty());
        fs::write(&path, r#"{"version":9,"songs":{}}"#).unwrap();
        assert!(read(&path).is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn only_timings_that_could_be_set_are_taken() {
        assert!(valid(&kept(0)));
        let mut last_unpinned = kept(0);
        last_unpinned.timing[1].line = 1;
        assert!(!valid(&last_unpinned));
        let mut crossed = kept(0);
        crossed.timing[1].ms = 500;
        assert!(!valid(&crossed));
        let mut empty = kept(0);
        empty.timing.clear();
        assert!(!valid(&empty));

        let raw = serde_json::to_string(&TimingsFile {
            version: VERSION,
            songs: HashMap::from([("good".into(), kept(1)), ("bad".into(), crossed)]),
            chosen: HashMap::new(),
        })
        .unwrap();
        assert_eq!(parse(&raw).unwrap().songs.keys().collect::<Vec<_>>(), vec!["good"]);
    }

    #[test]
    fn an_export_carries_chosen_lyrics_and_an_older_one_has_none() {
        // As exported before chosen lyrics were carried: read, with none.
        let older = r#"{"version":1,"songs":{"a":{"source":"lrclib","lines":3,"first":"a line","timing":[{"line":0,"ms":1000},{"line":2,"ms":9000}],"savedAt":1}}}"#;
        let file = parse(older).expect("reads");
        assert_eq!(file.songs.len(), 1);
        assert!(file.chosen.is_empty());

        let lyrics: crate::lyrics::manual::Saved = serde_json::from_value(serde_json::json!({
            "version": 1, "source": "netease", "sourceId": "42", "trackName": "Song",
            "artistName": "Band", "albumName": "", "durationMs": 180000,
            "result": {"status": "Plain", "data": "some words"}
        }))
        .unwrap();
        let chosen = HashMap::from([
            ("b".to_string(), Chosen { lyrics: lyrics.clone(), saved_at: 2 }),
            // Never carried for a song of the library's, which keeps its own.
            ("library:c".to_string(), Chosen { lyrics, saved_at: 2 }),
        ]);
        let raw = serde_json::to_string(&TimingsFile { version: VERSION, songs: file.songs, chosen }).unwrap();
        let back = parse(&raw).expect("reads");
        assert_eq!(back.chosen.keys().collect::<Vec<_>>(), vec!["b"]);
        // And the file kept here never holds them.
        assert!(!serde_json::to_string(&TimingsFile::default()).unwrap().contains("chosen"));
    }

    #[test]
    fn a_song_with_a_timing_and_chosen_lyrics_is_one_song() {
        let ids = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(songs_in(ids(&["a", "b"]), ids(&["b", "c"])), 3);
        assert_eq!(songs_in(ids(&[]), ids(&[])), 0);
    }

    #[test]
    fn a_merge_takes_new_songs_and_newer_timings_only() {
        let mut here = HashMap::from([("a".to_string(), kept(10)), ("b".to_string(), kept(10))]);
        let mut newer = kept(20);
        newer.timing[0].ms = 2_000;
        let from = HashMap::from([
            ("a".to_string(), kept(5)),
            ("b".to_string(), newer.clone()),
            ("c".to_string(), kept(1)),
        ]);
        assert_eq!(merge(&mut here, from).len(), 2);
        assert_eq!(here["a"].saved_at, 10);
        assert_eq!(here["b"], newer);
        assert!(here.contains_key("c"));
    }

    #[test]
    fn the_least_recently_set_go_first_past_the_limit() {
        let mut songs: HashMap<String, Kept> =
            (0..KEEP as u64 + 3).map(|n| (format!("s{n}"), kept(n))).collect();
        trim(&mut songs);
        assert_eq!(songs.len(), KEEP);
        assert!(!songs.contains_key("s0") && !songs.contains_key("s2"));
        assert!(songs.contains_key("s3"));
    }
}
