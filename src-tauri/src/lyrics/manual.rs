//! Lyrics found by hand, for a local song the automatic search gets wrong.
//!
//! The listener types what to look for. LRCLIB and NetEase are both asked, and
//! everything that has words comes back as one list, the likeliest first: the
//! nearest in length, then with timings. One can be read before it is chosen,
//! and the one chosen is saved beside the song in the library (`library.rs`),
//! so it plays the same tomorrow, offline, and whatever the source later does
//! to its records. Groovium vouches for none of it — the listener chose it, and
//! the window says so.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::State;

use super::{
    lrclib, netease, LyricsLookup, LyricsResult, Matched, Pin, NETEASE_ENABLED, PLAIN_GAP_MS,
    SYNCED_GAP_MS,
};

/// How many NetEase songs have their words fetched at once, to say what each
/// holds before anyone picks it.
const NETEASE_AT_ONCE: usize = 4;

/// What a candidate holds.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Synced,
    Plain,
    Instrumental,
}

/// One record somebody could choose.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    /// `lrclib:<id>` or `netease:<id>`: how a preview or a match names it.
    pub key: String,
    pub source: &'static str,
    pub track_name: String,
    pub artist_name: String,
    pub album_name: String,
    pub duration_ms: u32,
    pub kind: Kind,
}

/// A candidate and what it holds.
#[derive(Clone, Debug)]
pub struct Picked {
    pub candidate: Candidate,
    pub result: LyricsResult,
}

/// Every candidate found by hand this session, by key: what a preview and a
/// match are made from, so neither has to ask again.
#[derive(Default)]
pub struct Candidates(Mutex<HashMap<String, Picked>>);

fn kind_of(result: &LyricsResult) -> Option<Kind> {
    match result {
        LyricsResult::Synced(lines) if !lines.is_empty() => Some(Kind::Synced),
        LyricsResult::Plain(text) if !text.trim().is_empty() => Some(Kind::Plain),
        LyricsResult::Instrumental => Some(Kind::Instrumental),
        _ => None,
    }
}

/// Look for `query` in every source, for a song `duration_ms` long.
///
/// One source failing is passed over, so long as the other answered; both
/// failing is the error. Nothing is asked for fewer than two characters.
#[tauri::command]
pub async fn search_lyrics(
    found: State<'_, Candidates>,
    query: String,
    duration_ms: u32,
) -> Result<Vec<Candidate>, String> {
    let query = query.trim().to_string();
    if query.chars().count() < 2 {
        return Ok(Vec::new());
    }

    // NetEase on a task of its own, so the two are asked side by side.
    let from_netease = NETEASE_ENABLED.then(|| tauri::async_runtime::spawn(netease_picks(query.clone())));
    let from_lrclib = lrclib_picks(&query).await;
    let from_netease = match from_netease {
        Some(task) => task.await.map_err(|e| e.to_string())?,
        None => Ok(Vec::new()),
    };

    let picked = match (from_lrclib, from_netease) {
        (Err(a), Err(_)) => return Err(a),
        (lrclib, netease) => {
            for e in [&lrclib, &netease].into_iter().filter_map(|r| r.as_ref().err()) {
                log::warn!("a lyrics source failed during a search by hand: {e}");
            }
            let mut all = lrclib.unwrap_or_default();
            all.extend(netease.unwrap_or_default());
            all
        }
    };

    let mut candidates: Vec<Candidate> = picked.iter().map(|p| p.candidate.clone()).collect();
    candidates = without_repeats(candidates);
    rank(&mut candidates, duration_ms);

    let mut held = found.0.lock().map_err(|e| e.to_string())?;
    for pick in picked {
        held.insert(pick.candidate.key.clone(), pick);
    }
    Ok(candidates)
}

/// What one candidate holds, to be read before it is chosen.
#[tauri::command]
pub async fn lyrics_candidate(
    found: State<'_, Candidates>,
    key: String,
) -> Result<LyricsResult, String> {
    Ok(take(&found, &key).await?.result)
}

/// The candidate `key` names: from this session's searches, or asked for again
/// by its number when it is not among them.
pub async fn take(found: &Candidates, key: &str) -> Result<Picked, String> {
    if let Some(hit) = found.0.lock().map_err(|e| e.to_string())?.get(key).cloned() {
        return Ok(hit);
    }
    let picked = fetch_key(key).await?;
    found
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(key.to_string(), picked.clone());
    Ok(picked)
}

async fn fetch_key(key: &str) -> Result<Picked, String> {
    let (source, number) = key
        .split_once(':')
        .ok_or_else(|| format!("{key} does not name a record."))?;
    let id: u64 = number
        .parse()
        .map_err(|_| format!("{key} does not name a record."))?;
    match source {
        "lrclib" => {
            let record = lrclib::by_id(id)
                .await?
                .ok_or_else(|| String::from("That record is no longer on LRCLIB."))?;
            from_record(&record).ok_or_else(|| String::from("That record has no words."))
        }
        // NetEase has no way to ask for a song's name by its number that is
        // not another guess at an unpublished endpoint; a search finds it again.
        _ => Err("Search again to choose that one.".into()),
    }
}

async fn lrclib_picks(query: &str) -> Result<Vec<Picked>, String> {
    Ok(lrclib::search_text(query)
        .await?
        .iter()
        .filter_map(from_record)
        .collect())
}

fn from_record(record: &lrclib::Record) -> Option<Picked> {
    // A record without its number could never be asked for again.
    if record.id == 0 {
        return None;
    }
    let result = lrclib::as_chosen(record);
    let kind = kind_of(&result)?;
    Some(Picked {
        candidate: Candidate {
            key: format!("lrclib:{}", record.id),
            source: "lrclib",
            track_name: record.track_name.clone(),
            artist_name: record.artist_name.clone(),
            album_name: record.album_name.clone(),
            duration_ms: record.duration_ms(),
            kind,
        },
        result,
    })
}

async fn netease_picks(query: String) -> Result<Vec<Picked>, String> {
    let songs = netease::search_text(&query).await?;
    // Their words are what says whether they have timings, so they are asked
    // for now — a few at a time, each within the usual limit, and a song whose
    // words cannot be had is simply left out.
    let gate = Arc::new(tokio::sync::Semaphore::new(NETEASE_AT_ONCE));
    let asking: Vec<_> = songs
        .into_iter()
        .map(|song| {
            let gate = Arc::clone(&gate);
            tauri::async_runtime::spawn(async move {
                let _turn = gate.acquire_owned().await.ok();
                let result = netease::chosen_lyrics(song.id).await;
                (song, result)
            })
        })
        .collect();

    let mut picked = Vec::new();
    for task in asking {
        let Ok((song, Ok(result))) = task.await else {
            continue;
        };
        let Some(kind) = kind_of(&result) else {
            continue;
        };
        picked.push(Picked {
            candidate: Candidate {
                key: format!("netease:{}", song.id),
                source: "netease",
                track_name: song.name.clone(),
                artist_name: song.artists(),
                album_name: song.album(),
                duration_ms: song.dt,
                kind,
            },
            result,
        });
    }
    Ok(picked)
}

/// The same record uploaded more than once — LRCLIB holds many songs several
/// times over, name for name and second for second — listed once.
fn without_repeats(candidates: Vec<Candidate>) -> Vec<Candidate> {
    let mut seen = std::collections::HashSet::new();
    candidates
        .into_iter()
        .filter(|c| {
            seen.insert((
                c.source,
                c.track_name.to_lowercase(),
                c.artist_name.to_lowercase(),
                c.album_name.to_lowercase(),
                c.duration_ms / 1000,
                c.kind as u8,
            ))
        })
        .collect()
}

/// The likeliest first, for a song `duration_ms` long: those close enough in
/// length for their timings to hold, then those close enough to read, then
/// the rest; within each, timings before words alone, then the nearest, then
/// LRCLIB before NetEase. A song whose length is not known is ranked by what
/// the records hold alone.
pub fn rank(candidates: &mut [Candidate], duration_ms: u32) {
    candidates.sort_by_key(|c| {
        let gap = if duration_ms == 0 { 0 } else { c.duration_ms.abs_diff(duration_ms) };
        let reach = if duration_ms == 0 || c.duration_ms == 0 {
            2
        } else if gap <= SYNCED_GAP_MS {
            0
        } else if gap <= PLAIN_GAP_MS {
            1
        } else {
            2
        };
        let holds = match c.kind {
            Kind::Synced => 0,
            Kind::Plain => 1,
            Kind::Instrumental => 2,
        };
        (reach, holds, gap, u8::from(c.source != "lrclib"))
    });
}

/// Whether a retiming can be kept for these lyrics: timed ones, the first and
/// last line pinned, the pins in order of line and of moment. The frontend
/// only ever sends such a one; this is what keeps a file from holding another.
pub fn timing_fits(pins: &[Pin], result: &LyricsResult) -> bool {
    let LyricsResult::Synced(lines) = result else {
        return false;
    };
    let (Some(first), Some(last)) = (pins.first(), pins.last()) else {
        return false;
    };
    first.line == 0
        && last.line as usize + 1 == lines.len()
        && pins.windows(2).all(|w| w[0].line < w[1].line && w[0].ms < w[1].ms)
}

/// What is written beside a song matched by hand.
#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub version: u32,
    pub source: String,
    pub source_id: String,
    pub track_name: String,
    pub artist_name: String,
    pub album_name: String,
    pub duration_ms: u32,
    pub result: LyricsResult,
    /// The listener's retiming of `result`, when they have set one. Left out
    /// of the file otherwise, so a file without it is still version 1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timing: Option<Vec<Pin>>,
}

/// The shape of `Saved` this build writes and reads.
pub const SAVED_VERSION: u32 = 1;

impl Saved {
    pub fn from_picked(picked: &Picked) -> Self {
        let c = &picked.candidate;
        Saved {
            version: SAVED_VERSION,
            source: c.source.to_string(),
            source_id: c.key.split_once(':').map_or("", |(_, id)| id).to_string(),
            track_name: c.track_name.clone(),
            artist_name: c.artist_name.clone(),
            album_name: c.album_name.clone(),
            duration_ms: c.duration_ms,
            result: picked.result.clone(),
            timing: None,
        }
    }

    /// As a lookup's answer, saying it was matched by hand and from where.
    pub fn into_lookup(self) -> LyricsLookup {
        let via = match self.source.as_str() {
            "lrclib" => "saved:lrclib",
            "netease" => "saved:netease",
            _ => "saved",
        };
        LyricsLookup {
            // Lyrics saved before signatures were taken out lose them here.
            result: super::lrc::without_signatures(self.result),
            matched: Some(Matched {
                track_name: self.track_name,
                artist_name: self.artist_name,
                album_name: self.album_name,
                duration_s: f64::from(self.duration_ms) / 1000.0,
                via,
            }),
            timing: self.timing,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lyrics::LyricLine;

    fn candidate(source: &'static str, duration_ms: u32, kind: Kind, key: &str) -> Candidate {
        Candidate {
            key: key.into(),
            source,
            track_name: "Song".into(),
            artist_name: "Band".into(),
            album_name: "Album".into(),
            duration_ms,
            kind,
        }
    }

    fn keys(list: &[Candidate]) -> Vec<&str> {
        list.iter().map(|c| c.key.as_str()).collect()
    }

    #[test]
    fn the_likeliest_come_first() {
        let mut list = vec![
            candidate("lrclib", 230_000, Kind::Synced, "far-synced"),
            candidate("lrclib", 186_000, Kind::Synced, "readable-synced"),
            candidate("netease", 181_000, Kind::Plain, "near-words"),
            candidate("netease", 182_000, Kind::Synced, "near-synced-netease"),
            candidate("lrclib", 182_000, Kind::Synced, "near-synced-lrclib"),
            candidate("lrclib", 180_500, Kind::Synced, "nearest-synced"),
        ];
        rank(&mut list, 180_000);
        assert_eq!(
            keys(&list),
            vec![
                // In step: timings first, the nearest first, LRCLIB on a tie.
                "nearest-synced",
                "near-synced-lrclib",
                "near-synced-netease",
                "near-words",
                // Close enough to read, then everything else.
                "readable-synced",
                "far-synced",
            ]
        );
    }

    #[test]
    fn a_song_of_unknown_length_is_ranked_by_what_records_hold() {
        let mut list = vec![
            candidate("netease", 200_000, Kind::Plain, "words"),
            candidate("netease", 300_000, Kind::Synced, "netease-synced"),
            candidate("lrclib", 100_000, Kind::Synced, "lrclib-synced"),
        ];
        rank(&mut list, 0);
        assert_eq!(keys(&list), vec!["lrclib-synced", "netease-synced", "words"]);
    }

    #[test]
    fn the_same_record_uploaded_twice_is_listed_once() {
        let list = vec![
            candidate("lrclib", 180_200, Kind::Synced, "first"),
            candidate("lrclib", 180_700, Kind::Synced, "second"),
            candidate("lrclib", 180_200, Kind::Plain, "words"),
            candidate("netease", 180_200, Kind::Synced, "elsewhere"),
        ];
        assert_eq!(keys(&without_repeats(list)), vec!["first", "words", "elsewhere"]);
    }

    #[test]
    fn a_record_without_its_number_or_words_is_not_offered() {
        let record = |id: u64, synced: Option<&str>, plain: Option<&str>| lrclib::Record {
            id,
            track_name: "Song".into(),
            artist_name: "Band".into(),
            album_name: String::new(),
            duration: 180.0,
            instrumental: false,
            plain_lyrics: plain.map(Into::into),
            synced_lyrics: synced.map(Into::into),
        };
        assert!(from_record(&record(0, Some("[00:01.00]words"), None)).is_none());
        assert!(from_record(&record(7, None, None)).is_none());
        let picked = from_record(&record(7, Some("[00:01.00]words"), None)).expect("offered");
        assert_eq!(picked.candidate.key, "lrclib:7");
        assert_eq!(picked.candidate.kind, Kind::Synced);
    }

    /// Both sources, asked for real: `cargo test lyrics::manual::tests::live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live() {
        tauri::async_runtime::block_on(async {
            let query = "Daft Punk Get Lucky";
            let mut list: Vec<Candidate> = lrclib_picks(query)
                .await
                .expect("LRCLIB answers")
                .into_iter()
                .chain(netease_picks(query.into()).await.unwrap_or_default())
                .map(|p| p.candidate)
                .collect();
            list = without_repeats(list);
            rank(&mut list, 248_000);
            for c in list.iter().take(12) {
                println!(
                    "{:<16} {:<8} {:>7} ms  {} — {} [{}]",
                    c.key,
                    format!("{:?}", c.kind),
                    c.duration_ms,
                    c.track_name,
                    c.artist_name,
                    c.album_name
                );
            }
            assert!(!list.is_empty());
        });
    }

    #[test]
    fn what_is_saved_reads_back_as_the_same_lyrics_and_says_where_from() {
        let picked = Picked {
            candidate: candidate("netease", 181_000, Kind::Synced, "netease:42"),
            result: LyricsResult::Synced(vec![LyricLine {
                time_ms: 1_000,
                text: "a line".into(),
                ..Default::default()
            }]),
        };
        let saved = Saved::from_picked(&picked);
        assert_eq!(saved.source_id, "42");
        let json = serde_json::to_string(&saved).unwrap();
        let back: Saved = serde_json::from_str(&json).unwrap();
        assert_eq!(back, saved);

        let lookup = back.into_lookup();
        assert_eq!(lookup.result, picked.result);
        assert_eq!(lookup.matched.map(|m| m.via), Some("saved:netease"));
        assert_eq!(lookup.timing, None);
    }

    fn three_lines() -> LyricsResult {
        LyricsResult::Synced(
            [1_000, 5_000, 9_000]
                .into_iter()
                .map(|time_ms| LyricLine {
                    time_ms,
                    text: "a line".into(),
                    ..Default::default()
                })
                .collect(),
        )
    }

    #[test]
    fn a_retiming_is_kept_with_the_lyrics_and_an_older_file_has_none() {
        let mut saved = Saved::from_picked(&Picked {
            candidate: candidate("lrclib", 181_000, Kind::Synced, "lrclib:7"),
            result: three_lines(),
        });
        let json = serde_json::to_string(&saved).unwrap();
        // A file written before retiming existed says nothing about it.
        assert!(!json.contains("timing"));
        assert_eq!(serde_json::from_str::<Saved>(&json).unwrap().timing, None);

        saved.timing = Some(vec![Pin { line: 0, ms: 2_500 }, Pin { line: 2, ms: 9_000 }]);
        let back: Saved = serde_json::from_str(&serde_json::to_string(&saved).unwrap()).unwrap();
        assert_eq!(back.version, SAVED_VERSION);
        assert_eq!(back.into_lookup().timing, saved.timing);
    }

    #[test]
    fn only_a_timing_that_fits_the_lines_is_kept() {
        let pin = |line, ms| Pin { line, ms };
        let lines = three_lines();
        assert!(timing_fits(&[pin(0, 2_000), pin(2, 9_000)], &lines));
        assert!(timing_fits(&[pin(0, 2_000), pin(1, 4_000), pin(2, 9_000)], &lines));
        // The last line not pinned, a line past the end, out of order.
        assert!(!timing_fits(&[pin(0, 2_000), pin(1, 9_000)], &lines));
        assert!(!timing_fits(&[pin(0, 2_000), pin(3, 9_000)], &lines));
        assert!(!timing_fits(&[pin(0, 9_000), pin(2, 2_000)], &lines));
        assert!(!timing_fits(&[], &lines));
        // Words without timings have nothing to retime.
        assert!(!timing_fits(&[pin(0, 0)], &LyricsResult::Plain("words".into())));
    }
}
