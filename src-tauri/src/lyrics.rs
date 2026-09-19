//! Time-synced lyrics from LRCLIB, for the song that is playing.
//!
//! A proof of concept: the lookup, the parsing and a cache, so the window can
//! show whether the right lyrics come back and whether they keep time. Nothing
//! here is on screen for users yet — the panel that calls it is a development
//! build's alone.
//!
//! LRCLIB is asked first for an exact match on title, artist, album and length.
//! When it has none it is searched, and the result nearest in length is taken —
//! but only within ten seconds, because past that it is a different recording
//! (a live take, a radio edit) and lyrics that drift a verse out of step are
//! worse than none.
//!
//! Requests go out from here rather than from the webview, like every other
//! service this app talks to apart from Spotify, so the page's security policy
//! does not have to name another host.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

const API_ROOT: &str = "https://lrclib.net/api";

/// LRCLIB asks clients to say who they are.
const USER_AGENT: &str = concat!(
    "Groovium/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/MuratBicici/Groovium)"
);

const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);

/// How far a searched record's length may be from the track's and still be it.
pub const MAX_LENGTH_GAP_MS: u64 = 10_000;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LyricLine {
    pub time_ms: u32,
    pub text: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "status", content = "data")]
pub enum LyricsResult {
    Synced(Vec<LyricLine>),
    Plain(String),
    Instrumental,
    NotFound,
}

/// Which LRCLIB record an answer came from, so it can be checked by eye.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Matched {
    pub track_name: String,
    pub artist_name: String,
    pub album_name: String,
    pub duration_s: f64,
    /// `get` for an exact match, `search` for the nearest one found.
    pub via: &'static str,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LyricsLookup {
    pub result: LyricsResult,
    pub matched: Option<Matched>,
}

/// Answers already had this session, by track id.
///
/// Only settled answers go in — "not found" and "instrumental" included, since
/// asking again will not change them. A request that failed does not: the next
/// try may well reach the server.
#[derive(Default)]
pub struct LyricsCache(Mutex<HashMap<String, LyricsLookup>>);

/// One LRCLIB record, as much of it as is used.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    #[serde(default)]
    pub track_name: String,
    #[serde(default)]
    pub artist_name: String,
    #[serde(default)]
    pub album_name: String,
    #[serde(default)]
    pub duration: f64,
    #[serde(default)]
    pub instrumental: bool,
    pub plain_lyrics: Option<String>,
    pub synced_lyrics: Option<String>,
}

impl Record {
    fn has_synced(&self) -> bool {
        self.synced_lyrics
            .as_deref()
            .is_some_and(|s| !s.trim().is_empty())
    }

    fn length_gap_ms(&self, duration_ms: u32) -> u64 {
        ((self.duration * 1000.0).round() as i64 - i64::from(duration_ms)).unsigned_abs()
    }
}

#[tauri::command]
pub async fn get_lyrics(
    cache: State<'_, LyricsCache>,
    track_id: String,
    track_name: String,
    artist_name: String,
    album_name: String,
    duration_ms: u32,
) -> Result<LyricsLookup, String> {
    if let Some(hit) = cache.0.lock().map_err(|e| e.to_string())?.get(&track_id) {
        return Ok(hit.clone());
    }

    let lookup = look_up(&track_name, &artist_name, &album_name, duration_ms)
        .await
        .inspect_err(|e| log::warn!("lyrics lookup failed: {e}"))?;

    cache
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(track_id, lookup.clone());
    Ok(lookup)
}

async fn look_up(
    track: &str,
    artist: &str,
    album: &str,
    duration_ms: u32,
) -> Result<LyricsLookup, String> {
    let seconds = ((f64::from(duration_ms)) / 1000.0).round().to_string();
    let exact = endpoint(
        "get",
        &[
            ("artist_name", artist),
            ("track_name", track),
            ("album_name", album),
            ("duration", &seconds),
        ],
    )?;
    if let Some(body) = fetch(exact).await? {
        let record: Record =
            serde_json::from_str(&body).map_err(|e| format!("Unreadable LRCLIB answer: {e}"))?;
        return Ok(answer(&record, "get"));
    }

    // No exact match. Search by title and artist, then by the two together as
    // free text, which catches a title spelt differently on either side.
    let mut found = search(&[("track_name", track), ("artist_name", artist)]).await?;
    if found.is_empty() {
        found = search(&[("q", &format!("{artist} {track}"))]).await?;
    }
    Ok(match choose(&found, duration_ms) {
        Some(record) => answer(record, "search"),
        None => LyricsLookup {
            result: LyricsResult::NotFound,
            matched: None,
        },
    })
}

async fn search(params: &[(&str, &str)]) -> Result<Vec<Record>, String> {
    let Some(body) = fetch(endpoint("search", params)?).await? else {
        return Ok(Vec::new());
    };
    serde_json::from_str(&body).map_err(|e| format!("Unreadable LRCLIB search: {e}"))
}

/// The nearest record in length, if any is near enough to be the same take.
/// On equal distance one with synced lyrics wins.
pub fn choose(records: &[Record], duration_ms: u32) -> Option<&Record> {
    records
        .iter()
        .filter(|r| r.length_gap_ms(duration_ms) <= MAX_LENGTH_GAP_MS)
        .min_by_key(|r| (r.length_gap_ms(duration_ms), !r.has_synced()))
}

fn answer(record: &Record, via: &'static str) -> LyricsLookup {
    LyricsLookup {
        result: result_of(record),
        matched: Some(Matched {
            track_name: record.track_name.clone(),
            artist_name: record.artist_name.clone(),
            album_name: record.album_name.clone(),
            duration_s: record.duration,
            via,
        }),
    }
}

pub fn result_of(record: &Record) -> LyricsResult {
    if record.instrumental {
        return LyricsResult::Instrumental;
    }
    if let Some(synced) = record
        .synced_lyrics
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        let lines = parse_lrc(synced);
        if !lines.is_empty() {
            return LyricsResult::Synced(lines);
        }
    }
    match record.plain_lyrics.as_deref().map(str::trim) {
        Some(plain) if !plain.is_empty() => LyricsResult::Plain(plain.to_string()),
        _ => LyricsResult::NotFound,
    }
}

fn endpoint(path: &str, params: &[(&str, &str)]) -> Result<reqwest::Url, String> {
    reqwest::Url::parse_with_params(&format!("{API_ROOT}/{path}"), params)
        .map_err(|e| format!("Could not build the LRCLIB address: {e}"))
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .unwrap_or_default()
    })
}

/// One GET. `None` for a 404, which is LRCLIB's "no such track".
async fn fetch(url: reqwest::Url) -> Result<Option<String>, String> {
    let response = client()
        .get(url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Could not reach LRCLIB: {e}"))?;
    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !status.is_success() {
        return Err(format!("LRCLIB returned {status}."));
    }
    response
        .text()
        .await
        .map(Some)
        .map_err(|e| format!("Could not read the LRCLIB response: {e}"))
}

// --- LRC ---------------------------------------------------------------------

/// `[mm:ss]`, `[mm:ss.x]`, `[mm:ss.xx]` or `[mm:ss.xxx]` (a colon before the
/// fraction is accepted too) as milliseconds. `None` for anything else.
fn stamp_ms(tag: &str) -> Option<i64> {
    let (minutes, rest) = tag.split_once(':')?;
    let (seconds, fraction) = match rest.split_once(['.', ':']) {
        Some((s, f)) => (s, f),
        None => (rest, ""),
    };
    if minutes.is_empty() || !minutes.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if seconds.len() != 2 || !seconds.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if fraction.len() > 3 || !fraction.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let frac_ms = match fraction.len() {
        0 => 0,
        1 => fraction.parse::<i64>().ok()? * 100,
        2 => fraction.parse::<i64>().ok()? * 10,
        _ => fraction.parse::<i64>().ok()?,
    };
    Some(minutes.parse::<i64>().ok()? * 60_000 + seconds.parse::<i64>().ok()? * 1000 + frac_ms)
}

/// The tags at the start of a line, and what follows them.
fn split_tags(line: &str) -> (Vec<&str>, &str) {
    let mut tags = Vec::new();
    let mut rest = line.trim_start();
    while let Some(inner) = rest.strip_prefix('[') {
        let Some(end) = inner.find(']') else { break };
        tags.push(&inner[..end]);
        rest = &inner[end + 1..];
    }
    (tags, rest)
}

/// Every timed line, earliest first.
///
/// A line with several stamps — a chorus written once — becomes one line per
/// stamp. Metadata tags are skipped. `[offset:±ms]` is applied: a positive
/// offset brings the words in earlier. A stamp with no words after it is kept,
/// because it marks where the singing stops.
pub fn parse_lrc(text: &str) -> Vec<LyricLine> {
    let mut offset = 0i64;
    let mut timed: Vec<(i64, String)> = Vec::new();

    for line in text.lines() {
        let (tags, rest) = split_tags(line);
        let mut stamps = Vec::new();
        for tag in tags {
            if let Some(ms) = stamp_ms(tag) {
                stamps.push(ms);
            } else if let Some(value) = tag.strip_prefix("offset:") {
                offset = value.trim().trim_start_matches('+').parse().unwrap_or(0);
            }
        }
        let words = rest.trim();
        for ms in stamps {
            timed.push((ms, words.to_string()));
        }
    }

    let mut lines: Vec<LyricLine> = timed
        .into_iter()
        .map(|(ms, text)| LyricLine {
            time_ms: u32::try_from((ms - offset).max(0)).unwrap_or(u32::MAX),
            text,
        })
        .collect();
    lines.sort_by_key(|l| l.time_ms);
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(time_ms: u32, text: &str) -> LyricLine {
        LyricLine {
            time_ms,
            text: text.into(),
        }
    }

    #[test]
    fn reads_stamps_at_every_precision() {
        let lines = parse_lrc("[00:01]a\n[00:02.5]b\n[00:03.25]c\n[01:04.125]d\n[00:05:50]e");
        assert_eq!(
            lines,
            vec![
                line(1000, "a"),
                line(2500, "b"),
                line(3250, "c"),
                line(5500, "e"),
                line(64125, "d"),
            ]
        );
    }

    #[test]
    fn a_line_with_several_stamps_is_sung_each_time() {
        let lines = parse_lrc("[00:30.00][00:10.00]chorus\n[00:20.00]verse");
        assert_eq!(
            lines,
            vec![
                line(10000, "chorus"),
                line(20000, "verse"),
                line(30000, "chorus")
            ]
        );
    }

    #[test]
    fn skips_metadata_and_keeps_empty_lines() {
        let lines =
            parse_lrc("[ar:Someone]\n[ti:Something]\n[00:01.00]words\n[00:04.00]\nnot a line");
        assert_eq!(lines, vec![line(1000, "words"), line(4000, "")]);
    }

    #[test]
    fn applies_the_offset_and_never_goes_below_zero() {
        let lines = parse_lrc("[offset:+500]\n[00:00.20]early\n[00:02.00]late");
        assert_eq!(lines, vec![line(0, "early"), line(1500, "late")]);
        let later = parse_lrc("[offset:-250]\n[00:01.00]x");
        assert_eq!(later, vec![line(1250, "x")]);
    }

    #[test]
    fn refuses_what_is_not_a_stamp() {
        assert_eq!(stamp_ms("1:2"), None);
        assert_eq!(stamp_ms("aa:12"), None);
        assert_eq!(stamp_ms("00:12.1234"), None);
        assert_eq!(stamp_ms("length:03:20"), None);
    }

    fn record(duration: f64, synced: bool) -> Record {
        Record {
            track_name: format!("{duration}{synced}"),
            artist_name: String::new(),
            album_name: String::new(),
            duration,
            instrumental: false,
            plain_lyrics: Some("words".into()),
            synced_lyrics: synced.then(|| "[00:01.00]words".to_string()),
        }
    }

    #[test]
    fn picks_the_nearest_length() {
        let found = [
            record(200.0, true),
            record(181.0, true),
            record(185.0, true),
        ];
        assert_eq!(choose(&found, 180_400).map(|r| r.duration), Some(181.0));
    }

    #[test]
    fn prefers_synced_lyrics_at_the_same_distance() {
        let found = [record(180.0, false), record(180.0, true)];
        assert!(choose(&found, 180_000).is_some_and(Record::has_synced));
    }

    #[test]
    fn refuses_a_record_too_far_off_to_be_the_same_take() {
        let found = [record(191.0, true)];
        assert!(choose(&found, 180_000).is_none());
        let edge = [record(190.0, true)];
        assert!(choose(&edge, 180_000).is_some());
    }

    #[test]
    fn maps_a_record_to_what_it_holds() {
        let mut r = record(180.0, true);
        assert!(matches!(result_of(&r), LyricsResult::Synced(_)));
        r.synced_lyrics = Some("no stamps here".into());
        assert_eq!(result_of(&r), LyricsResult::Plain("words".into()));
        r.plain_lyrics = None;
        assert_eq!(result_of(&r), LyricsResult::NotFound);
        r.instrumental = true;
        assert_eq!(result_of(&r), LyricsResult::Instrumental);
    }

    #[test]
    fn reads_lrclib_json() {
        let body = r#"{"id":1,"trackName":"T","artistName":"A","albumName":"B","duration":181.5,
            "instrumental":false,"plainLyrics":"x","syncedLyrics":null}"#;
        let r: Record = serde_json::from_str(body).unwrap();
        assert_eq!(r.duration, 181.5);
        assert!(!r.has_synced());
    }
}
