//! The app's own playlists.
//!
//! These replace the transient queue. A queue was a list you edited once and
//! lost on restart; a playlist is a thing you keep, which is what makes
//! "find a song on Spotify, put it next to my own files" possible at all.
//!
//! Items are mixed on purpose. A local item is a **reference** into the library
//! so its metadata lives in one place and follows a rename; a Spotify item
//! carries its metadata inline, because nothing else in the app is holding it.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const PLAYLISTS_FILE: &str = "playlists.json";
const PLAYLISTS_VERSION: u32 = 1;

/// Keeps one runaway list from making the whole file unreadable.
const MAX_ITEMS_PER_PLAYLIST: usize = 5000;

/// Note the per-variant `rename_all`: on the enum itself it would only rename
/// the *variants*, leaving fields as `library_id` while the frontend sends
/// `libraryId`. That mismatch made adding to a playlist fail silently.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "source")]
pub enum PlaylistItem {
    /// Points at a `LibraryTrack`. Metadata is read from the library.
    #[serde(rename = "local", rename_all = "camelCase")]
    Local { library_id: String },
    /// Carries its own metadata: Spotify tracks are not stored anywhere else.
    #[serde(rename = "spotify", rename_all = "camelCase")]
    Spotify {
        uri: String,
        title: String,
        artist: String,
        album: String,
        duration_ms: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        cover_art_url: Option<String>,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub created_at: u64,
    #[serde(default)]
    pub items: Vec<PlaylistItem>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PlaylistsFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    playlists: Vec<Playlist>,
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

fn read_all(path: &Path) -> Vec<Playlist> {
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    match serde_json::from_str::<PlaylistsFile>(&raw) {
        Ok(file) if file.version == PLAYLISTS_VERSION => file.playlists,
        Ok(_) => Vec::new(),
        Err(e) => {
            eprintln!("[playlists] ignoring unreadable playlists file: {e}");
            Vec::new()
        }
    }
}

fn write_all(path: &Path, playlists: &[Playlist]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
    }

    let payload = PlaylistsFile {
        version: PLAYLISTS_VERSION,
        playlists: playlists.to_vec(),
    };
    let json = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;

    let temp = path.with_extension("json.tmp");
    fs::write(&temp, json).map_err(|e| format!("Could not write playlists: {e}"))?;
    fs::rename(&temp, path).map_err(|e| format!("Could not replace the playlists file: {e}"))
}

fn playlists_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(PLAYLISTS_FILE))
        .map_err(|e| format!("No app data directory available: {e}"))
}

/// Reject blank names before they become an unclickable empty row.
fn clean_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("A playlist needs a name.".into());
    }
    Ok(trimmed.chars().take(80).collect())
}

// --- Commands ---------------------------------------------------------------

#[tauri::command(async)]
pub fn playlists_load(app: AppHandle) -> Result<Vec<Playlist>, String> {
    Ok(read_all(&playlists_path(&app)?))
}

#[tauri::command(async)]
pub fn playlist_create(app: AppHandle, name: String) -> Result<Playlist, String> {
    let path = playlists_path(&app)?;
    let mut playlists = read_all(&path);

    let playlist = Playlist {
        id: new_id(),
        name: clean_name(&name)?,
        created_at: now_secs(),
        items: Vec::new(),
    };

    playlists.push(playlist.clone());
    write_all(&path, &playlists)?;
    Ok(playlist)
}

#[tauri::command(async)]
pub fn playlist_rename(app: AppHandle, id: String, name: String) -> Result<(), String> {
    let path = playlists_path(&app)?;
    let mut playlists = read_all(&path);
    let clean = clean_name(&name)?;

    let Some(playlist) = playlists.iter_mut().find(|p| p.id == id) else {
        return Err("That playlist no longer exists.".into());
    };
    playlist.name = clean;
    write_all(&path, &playlists)
}

#[tauri::command(async)]
pub fn playlist_delete(app: AppHandle, id: String) -> Result<(), String> {
    let path = playlists_path(&app)?;
    let mut playlists = read_all(&path);
    playlists.retain(|p| p.id != id);
    write_all(&path, &playlists)
}

/// Whether two entries stand for the same song.
///
/// Compared by identity rather than by full equality: a Spotify item's cached
/// title or artwork can differ between two lookups of the same track, and that
/// should not make it a different song.
fn same_track(a: &PlaylistItem, b: &PlaylistItem) -> bool {
    match (a, b) {
        (PlaylistItem::Local { library_id: x }, PlaylistItem::Local { library_id: y }) => x == y,
        (PlaylistItem::Spotify { uri: x, .. }, PlaylistItem::Spotify { uri: y, .. }) => x == y,
        _ => false,
    }
}

/// Add a track. Returns false when it was already there.
///
/// Enforced here because this is the only write path. Not an error: asking for
/// something that is already true should not look like a failure, and the
/// frontend says "Already in X" rather than showing a red bar.
#[tauri::command(async)]
pub fn playlist_add_item(app: AppHandle, id: String, item: PlaylistItem) -> Result<bool, String> {
    let path = playlists_path(&app)?;
    let mut playlists = read_all(&path);

    let Some(playlist) = playlists.iter_mut().find(|p| p.id == id) else {
        return Err("That playlist no longer exists.".into());
    };
    if playlist.items.iter().any(|existing| same_track(existing, &item)) {
        return Ok(false);
    }
    if playlist.items.len() >= MAX_ITEMS_PER_PLAYLIST {
        return Err("That playlist is full.".into());
    }

    playlist.items.push(item);
    write_all(&path, &playlists)?;
    Ok(true)
}

/// Remove by position: the same track may legitimately appear twice.
#[tauri::command(async)]
pub fn playlist_remove_item(app: AppHandle, id: String, index: usize) -> Result<(), String> {
    let path = playlists_path(&app)?;
    let mut playlists = read_all(&path);

    let Some(playlist) = playlists.iter_mut().find(|p| p.id == id) else {
        return Err("That playlist no longer exists.".into());
    };
    if index < playlist.items.len() {
        playlist.items.remove(index);
    }
    write_all(&path, &playlists)
}

/// Drop references to library tracks that no longer exist.
///
/// Called after a library removal: the copy is gone, so any playlist pointing
/// at it would otherwise show a row that can never play.
pub fn forget_library_track(app: &AppHandle, library_id: &str) -> Result<(), String> {
    let path = playlists_path(app)?;
    let mut playlists = read_all(&path);

    let mut changed = false;
    for playlist in &mut playlists {
        let before = playlist.items.len();
        playlist
            .items
            .retain(|item| !matches!(item, PlaylistItem::Local { library_id: id } if id == library_id));
        changed |= playlist.items.len() != before;
    }

    if changed {
        write_all(&path, &playlists)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("groovium-pl-{}", new_id()));
            fs::create_dir_all(&path).expect("temp dir");
            Self(path)
        }
        fn file(&self) -> PathBuf {
            self.0.join("playlists.json")
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn spotify_item(uri: &str) -> PlaylistItem {
        PlaylistItem::Spotify {
            uri: uri.into(),
            title: "Song".into(),
            artist: "Artist".into(),
            album: "Album".into(),
            duration_ms: 1000,
            cover_art_url: None,
        }
    }

    #[test]
    fn a_playlist_can_hold_both_sources_at_once() {
        // The reason playlists replaced the queue.
        let dir = TempDir::new();
        let playlist = Playlist {
            id: "p1".into(),
            name: "Mixed".into(),
            created_at: 0,
            items: vec![
                PlaylistItem::Local { library_id: "lib1".into() },
                spotify_item("spotify:track:abc"),
            ],
        };

        write_all(&dir.file(), std::slice::from_ref(&playlist)).expect("write");
        assert_eq!(read_all(&dir.file()), vec![playlist]);
    }

    #[test]
    fn item_kind_is_tagged_by_source() {
        // The frontend switches on `source`, so the discriminant must survive.
        let json = serde_json::to_string(&PlaylistItem::Local { library_id: "x".into() }).unwrap();
        assert!(json.contains(r#""source":"local""#));
        assert!(serde_json::to_string(&spotify_item("u")).unwrap().contains(r#""source":"spotify""#));
    }

    #[test]
    fn deserialises_exactly_what_the_frontend_sends() {
        // Regression, and the direction the original tests missed: they only
        // checked Rust -> JSON. The frontend sends camelCase, and a mismatch
        // here makes `playlist_add_item` reject the payload, so adding a track
        // silently does nothing.
        let local: PlaylistItem =
            serde_json::from_str(r#"{"source":"local","libraryId":"lib42"}"#).expect("local item");
        assert_eq!(local, PlaylistItem::Local { library_id: "lib42".into() });

        let spotify: PlaylistItem = serde_json::from_str(
            r#"{"source":"spotify","uri":"spotify:track:x","title":"T","artist":"A",
                 "album":"Al","durationMs":1234,"coverArtUrl":"https://i/x.jpg"}"#,
        )
        .expect("spotify item");
        assert_eq!(
            spotify,
            PlaylistItem::Spotify {
                uri: "spotify:track:x".into(),
                title: "T".into(),
                artist: "A".into(),
                album: "Al".into(),
                duration_ms: 1234,
                cover_art_url: Some("https://i/x.jpg".into()),
            }
        );
    }

    #[test]
    fn a_spotify_item_without_artwork_still_parses() {
        let item: PlaylistItem = serde_json::from_str(
            r#"{"source":"spotify","uri":"u","title":"T","artist":"A","album":"Al","durationMs":1}"#,
        )
        .expect("optional cover art");
        assert!(matches!(item, PlaylistItem::Spotify { cover_art_url: None, .. }));
    }

    #[test]
    fn what_rust_writes_can_be_read_back_by_rust() {
        // Round trip through the on-disk shape, so the file written yesterday
        // still loads today.
        for item in [PlaylistItem::Local { library_id: "l".into() }, spotify_item("u")] {
            let json = serde_json::to_string(&item).unwrap();
            let parsed: PlaylistItem = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, item);
        }
    }

    #[test]
    fn removing_a_library_track_clears_it_from_playlists() {
        let dir = TempDir::new();
        let playlists = vec![Playlist {
            id: "p1".into(),
            name: "Mixed".into(),
            created_at: 0,
            items: vec![
                PlaylistItem::Local { library_id: "gone".into() },
                PlaylistItem::Local { library_id: "kept".into() },
                spotify_item("spotify:track:abc"),
            ],
        }];
        write_all(&dir.file(), &playlists).unwrap();

        // Mirrors what `forget_library_track` does, without needing an AppHandle.
        let mut loaded = read_all(&dir.file());
        for playlist in &mut loaded {
            playlist
                .items
                .retain(|i| !matches!(i, PlaylistItem::Local { library_id } if library_id == "gone"));
        }
        write_all(&dir.file(), &loaded).unwrap();

        let after = read_all(&dir.file());
        assert_eq!(after[0].items.len(), 2);
        assert!(!after[0]
            .items
            .contains(&PlaylistItem::Local { library_id: "gone".into() }));
    }

    #[test]
    fn blank_names_are_rejected() {
        for bad in ["", "   ", "\t"] {
            assert!(clean_name(bad).is_err(), "should reject {bad:?}");
        }
        assert_eq!(clean_name("  Road Trip  ").unwrap(), "Road Trip");
    }

    #[test]
    fn a_very_long_name_is_truncated_rather_than_refused() {
        let long = "a".repeat(500);
        assert_eq!(clean_name(&long).unwrap().chars().count(), 80);
    }

    #[test]
    fn a_file_from_another_version_is_ignored() {
        let dir = TempDir::new();
        fs::write(dir.file(), r#"{"version":999,"playlists":[{"id":"x"}]}"#).unwrap();
        assert!(read_all(&dir.file()).is_empty());
    }

    #[test]
    fn the_same_track_is_recognised_regardless_of_cached_metadata() {
        // Two lookups of one Spotify track can carry different artwork or a
        // slightly different title; the URI is what makes it the same song.
        let a = PlaylistItem::Spotify {
            uri: "spotify:track:same".into(),
            title: "Song".into(),
            artist: "Artist".into(),
            album: "Album".into(),
            duration_ms: 1000,
            cover_art_url: None,
        };
        let b = PlaylistItem::Spotify {
            uri: "spotify:track:same".into(),
            title: "Song (Remastered)".into(),
            artist: "Artist".into(),
            album: "Album".into(),
            duration_ms: 1002,
            cover_art_url: Some("https://i/x.jpg".into()),
        };
        assert!(same_track(&a, &b));
        assert!(!same_track(&a, &spotify_item("spotify:track:other")));
    }

    #[test]
    fn local_items_are_matched_by_library_id() {
        let a = PlaylistItem::Local { library_id: "lib1".into() };
        assert!(same_track(&a, &PlaylistItem::Local { library_id: "lib1".into() }));
        assert!(!same_track(&a, &PlaylistItem::Local { library_id: "lib2".into() }));
        // A local and a Spotify entry are never the same thing.
        assert!(!same_track(&a, &spotify_item("u")));
    }

    #[test]
    fn position_based_removal_still_works_on_a_deduplicated_list() {
        // Removal stayed positional: it is the index the user clicked, and that
        // remains unambiguous whether or not duplicates can be added.
        let dir = TempDir::new();
        let playlist = Playlist {
            id: "p1".into(),
            name: "Mixed".into(),
            created_at: 0,
            items: vec![
                PlaylistItem::Local { library_id: "a".into() },
                PlaylistItem::Local { library_id: "b".into() },
            ],
        };
        write_all(&dir.file(), std::slice::from_ref(&playlist)).unwrap();

        let mut loaded = read_all(&dir.file());
        loaded[0].items.remove(0);
        write_all(&dir.file(), &loaded).unwrap();

        let after = read_all(&dir.file());
        assert_eq!(after[0].items, vec![PlaylistItem::Local { library_id: "b".into() }]);
    }
}
