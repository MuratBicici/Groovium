//! Lyrics chosen by hand for a Spotify song.
//!
//! A song on this computer keeps the lyrics matched to it beside it, in the
//! library (`library.rs`). A Spotify song is looked up afresh each time it is
//! played, and when that finds nothing, or LRCLIB is too busy to answer, or
//! what it finds is wrong, the listener can search for its lyrics themselves
//! (`manual.rs`). The record they choose is kept here, in `lyrics-chosen.json`
//! beside the settings, and answers for that song from then on instead of the
//! search — until they take it away again.
//!
//! The timings file's export carries these too, and its import brings them
//! back (`timings.rs`), the more recently chosen of two winning.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use super::manual::{self, Candidates, Saved, SAVED_VERSION};
use super::timings::{now_ms, write_json, TimingsLock, KEEP};
use super::{LyricsLookup, LyricsResult};

const FILE: &str = "lyrics-chosen.json";
const VERSION: u32 = 1;

/// One song's lyrics, as chosen, and when.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Chosen {
    pub lyrics: Saved,
    /// When they were chosen, in milliseconds since 1970: which of two wins.
    #[serde(default)]
    pub saved_at: u64,
}

#[derive(Serialize, Deserialize, Default)]
struct ChosenFile {
    version: u32,
    songs: HashMap<String, Chosen>,
}

/// Whether these could be lyrics somebody chose for a Spotify song: in a shape
/// this build reads, with something in them, and not for a song of the
/// library's, which keeps its own.
pub fn valid(track_id: &str, chosen: &Chosen) -> bool {
    let holds = match &chosen.lyrics.result {
        LyricsResult::Synced(lines) => !lines.is_empty(),
        LyricsResult::Plain(text) => !text.trim().is_empty(),
        LyricsResult::Instrumental => true,
        LyricsResult::NotFound => false,
    };
    holds && chosen.lyrics.version == SAVED_VERSION && !track_id.starts_with("library:")
}

/// The songs in a file, or none when it is missing, another shape or unreadable.
pub fn read(path: &Path) -> HashMap<String, Chosen> {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return HashMap::new();
    };
    match serde_json::from_str::<ChosenFile>(&raw) {
        Ok(file) if file.version == VERSION => file
            .songs
            .into_iter()
            .filter(|(id, chosen)| valid(id, chosen))
            .collect(),
        _ => {
            log::warn!("[lyrics] ignoring an unreadable {}", path.display());
            HashMap::new()
        }
    }
}

pub fn write(path: &Path, songs: HashMap<String, Chosen>) -> Result<(), String> {
    write_json(path, &ChosenFile { version: VERSION, songs })
}

/// Down to `KEEP`, the most recently chosen kept.
fn trim(songs: &mut HashMap<String, Chosen>) {
    if songs.len() <= KEEP {
        return;
    }
    let mut ages: Vec<(u64, String)> = songs.iter().map(|(id, c)| (c.saved_at, id.clone())).collect();
    ages.sort();
    for (_, id) in ages.into_iter().take(songs.len() - KEEP) {
        songs.remove(&id);
    }
}

/// Take in songs from elsewhere: a song not here, or chosen more recently
/// there. The songs taken.
pub fn merge(into: &mut HashMap<String, Chosen>, from: HashMap<String, Chosen>) -> Vec<String> {
    let mut taken = Vec::new();
    for (id, chosen) in from {
        if !valid(&id, &chosen) || into.get(&id).is_some_and(|here| here.saved_at > chosen.saved_at) {
            continue;
        }
        into.insert(id.clone(), chosen);
        taken.push(id);
    }
    trim(into);
    taken
}

pub fn chosen_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(FILE))
        .map_err(|e| format!("No app data directory available: {e}"))
}

/// The lyrics chosen for this song, if somebody chose some.
pub fn chosen_lyrics(app: &AppHandle, track_id: &str) -> Option<LyricsLookup> {
    let mut songs = read(&chosen_path(app).ok()?);
    Some(songs.remove(track_id)?.lyrics.into_lookup())
}

/// Keep `key`, a candidate from a search by hand, as this song's lyrics, in
/// place of any chosen before. The lyrics as they will be shown.
#[tauri::command]
pub async fn lyrics_choose(
    app: AppHandle,
    found: State<'_, Candidates>,
    lock: State<'_, TimingsLock>,
    track_id: String,
    key: String,
) -> Result<LyricsLookup, String> {
    let picked = manual::take(&found, &key).await?;
    let chosen = Chosen {
        lyrics: Saved::from_picked(&picked),
        saved_at: now_ms(),
    };
    if !valid(&track_id, &chosen) {
        return Err("Those lyrics cannot be chosen for this song.".into());
    }
    let lookup = chosen.lyrics.clone().into_lookup();
    let _held = lock.hold()?;
    let path = chosen_path(&app)?;
    let mut songs = read(&path);
    songs.insert(track_id, chosen);
    trim(&mut songs);
    write(&path, songs)?;
    Ok(lookup)
}

/// Forget the lyrics chosen for this song, so it is looked for again.
#[tauri::command(async)]
pub fn lyrics_unchoose(app: AppHandle, lock: State<'_, TimingsLock>, track_id: String) -> Result<(), String> {
    let _held = lock.hold()?;
    let path = chosen_path(&app)?;
    let mut songs = read(&path);
    if songs.remove(&track_id).is_none() {
        return Ok(());
    }
    write(&path, songs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lyrics::LyricLine;

    fn chosen(saved_at: u64) -> Chosen {
        Chosen {
            lyrics: Saved {
                version: SAVED_VERSION,
                source: "lrclib".into(),
                source_id: "7".into(),
                track_name: "Song".into(),
                artist_name: "Band".into(),
                album_name: String::new(),
                duration_ms: 180_000,
                result: LyricsResult::Synced(vec![LyricLine {
                    time_ms: 1_000,
                    text: "a line".into(),
                    ..Default::default()
                }]),
                timing: None,
            },
            saved_at,
        }
    }

    #[test]
    fn a_file_reads_back_as_written_and_a_bad_one_as_nothing() {
        let dir = std::env::temp_dir().join(format!("groovium-chosen-{}", now_ms()));
        let path = dir.join(FILE);
        assert!(read(&path).is_empty());

        let songs = HashMap::from([("spotify:track:a".to_string(), chosen(5))]);
        write(&path, songs.clone()).unwrap();
        assert_eq!(read(&path), songs);

        std::fs::write(&path, "{not json").unwrap();
        assert!(read(&path).is_empty());
        std::fs::write(&path, r#"{"version":9,"songs":{}}"#).unwrap();
        assert!(read(&path).is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn only_lyrics_with_something_in_them_for_a_spotify_song_are_taken() {
        assert!(valid("spotify:track:a", &chosen(0)));
        assert!(!valid("library:a", &chosen(0)));
        let mut nothing = chosen(0);
        nothing.lyrics.result = LyricsResult::NotFound;
        assert!(!valid("spotify:track:a", &nothing));
        let mut empty = chosen(0);
        empty.lyrics.result = LyricsResult::Synced(Vec::new());
        assert!(!valid("spotify:track:a", &empty));
        let mut later = chosen(0);
        later.lyrics.version = SAVED_VERSION + 1;
        assert!(!valid("spotify:track:a", &later));
    }

    #[test]
    fn a_merge_takes_new_songs_and_newer_choices_only() {
        let mut here = HashMap::from([("a".to_string(), chosen(10)), ("b".to_string(), chosen(10))]);
        let mut newer = chosen(20);
        newer.lyrics.source_id = "8".into();
        let from = HashMap::from([
            ("a".to_string(), chosen(5)),
            ("b".to_string(), newer.clone()),
            ("c".to_string(), chosen(1)),
            ("library:d".to_string(), chosen(1)),
        ]);
        let mut taken = merge(&mut here, from);
        taken.sort();
        assert_eq!(taken, vec!["b", "c"]);
        assert_eq!(here["a"].saved_at, 10);
        assert_eq!(here["b"], newer);
        assert!(!here.contains_key("library:d"));
    }

    #[test]
    fn chosen_lyrics_answer_as_matched_by_hand() {
        let lookup = chosen(1).lyrics.into_lookup();
        assert_eq!(lookup.matched.map(|m| m.via), Some("saved:lrclib"));
        assert_eq!(lookup.timing, None);
    }
}
