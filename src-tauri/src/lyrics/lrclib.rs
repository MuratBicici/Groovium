//! LRCLIB: an open lyrics database with an open API, and the first place asked.

use serde::Deserialize;

use super::clean::{primary_artist, same_song};
use super::lrc::{parse_lrc, words_of};
use super::{fetch, flaw, or_default, pick_nearest, Found, LyricsResult, Query, SYNCED_GAP_MS};

const API_ROOT: &str = "https://lrclib.net/api";

/// One LRCLIB record, as much of it as is used.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    #[serde(default, deserialize_with = "or_default")]
    pub track_name: String,
    #[serde(default, deserialize_with = "or_default")]
    pub artist_name: String,
    #[serde(default, deserialize_with = "or_default")]
    pub album_name: String,
    #[serde(default, deserialize_with = "or_default")]
    pub duration: f64,
    #[serde(default, deserialize_with = "or_default")]
    pub instrumental: bool,
    pub plain_lyrics: Option<String>,
    pub synced_lyrics: Option<String>,
}

impl Record {
    #[cfg(test)]
    pub fn has_synced(&self) -> bool {
        self.synced_lyrics
            .as_deref()
            .is_some_and(|s| !s.trim().is_empty())
    }

    /// How good a pick this is, lower better: synced and clean, synced with
    /// a flaw (see `flaw`), then words alone.
    pub fn rank(&self) -> u8 {
        match self
            .synced_lyrics
            .as_deref()
            .filter(|s| !s.trim().is_empty())
        {
            Some(synced) => flaw(&parse_lrc(synced)),
            None => 3,
        }
    }

    pub fn duration_ms(&self) -> u32 {
        (self.duration * 1000.0).round().max(0.0) as u32
    }
}

fn endpoint(path: &str, params: &[(&str, &str)]) -> Result<reqwest::Url, String> {
    reqwest::Url::parse_with_params(&format!("{API_ROOT}/{path}"), params)
        .map_err(|e| format!("Could not build the LRCLIB address: {e}"))
}

/// An exact match: LRCLIB's own lookup by name, album and length, which it
/// allows two seconds either way. `title` is passed because it is asked twice —
/// as Spotify has it, and cleaned.
pub async fn exact(q: &Query, title: &str, via: &'static str) -> Result<Option<Found>, String> {
    let seconds = (f64::from(q.duration_ms) / 1000.0).round().to_string();
    let url = endpoint(
        "get",
        &[
            ("artist_name", q.artist.as_str()),
            ("track_name", title),
            ("album_name", q.album.as_str()),
            ("duration", &seconds),
        ],
    )?;
    let Some(body) = fetch(url, None).await? else {
        return Ok(None);
    };
    let record: Record =
        serde_json::from_str(&body).map_err(|e| format!("Unreadable LRCLIB answer: {e}"))?;
    Ok(Some(found(&record, q, via)))
}

/// A search on the cleaned title and first artist, and failing that on the two
/// as free text. Only records that are this song are considered.
pub async fn search(q: &Query) -> Result<Option<Found>, String> {
    let artist = primary_artist(&q.artist);
    let mut records =
        run_search(&[("track_name", &q.clean_title), ("artist_name", artist)]).await?;
    if records.is_empty() {
        records = run_search(&[("q", &format!("{artist} {}", q.clean_title))]).await?;
    }
    Ok(choose(&records, q).map(|r| found(r, q, "lrclib:search")))
}

async fn run_search(params: &[(&str, &str)]) -> Result<Vec<Record>, String> {
    let Some(body) = fetch(endpoint("search", params)?, None).await? else {
        return Ok(Vec::new());
    };
    serde_json::from_str(&body).map_err(|e| format!("Unreadable LRCLIB search: {e}"))
}

/// The search result to use: this song, nearest in length, synced preferred.
pub fn choose<'a>(records: &'a [Record], q: &Query) -> Option<&'a Record> {
    let same: Vec<&Record> = records
        .iter()
        .filter(|r| same_song(&q.title, &q.artist, &r.track_name, &r.artist_name))
        .collect();
    pick_nearest(&same, q.duration_ms, Record::duration_ms, Record::rank)
}

fn found(record: &Record, q: &Query, via: &'static str) -> Found {
    Found {
        result: result_of(record, q.duration_ms),
        track_name: record.track_name.clone(),
        artist_name: record.artist_name.clone(),
        album_name: record.album_name.clone(),
        duration_ms: record.duration_ms(),
        via,
    }
}

/// What a record holds, for a track of `duration_ms`.
///
/// Synced lyrics from a take more than a few seconds off in length are shown
/// as words to read: the timings are this other recording's, and a highlight
/// that runs ahead of the singer is worse than none.
pub fn result_of(record: &Record, duration_ms: u32) -> LyricsResult {
    if record.instrumental {
        return LyricsResult::Instrumental;
    }
    let in_step = record.duration_ms().abs_diff(duration_ms) <= SYNCED_GAP_MS;
    if let Some(synced) = record
        .synced_lyrics
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        let lines = parse_lrc(synced);
        if !lines.is_empty() {
            if in_step {
                return LyricsResult::Synced(lines);
            }
            let words = words_of(&lines);
            if !words.is_empty() {
                return LyricsResult::Plain(words);
            }
        }
    }
    match record.plain_lyrics.as_deref().map(str::trim) {
        Some(plain) if !plain.is_empty() => LyricsResult::Plain(plain.to_string()),
        _ => LyricsResult::NotFound,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query(title: &str, artist: &str, duration_ms: u32) -> Query {
        Query::new(title, artist, "", duration_ms)
    }

    fn record(title: &str, artist: &str, duration: f64, synced: bool) -> Record {
        Record {
            track_name: title.into(),
            artist_name: artist.into(),
            album_name: String::new(),
            duration,
            instrumental: false,
            plain_lyrics: Some("words".into()),
            synced_lyrics: synced.then(|| "[00:01.00]words".to_string()),
        }
    }

    #[test]
    fn chooses_this_song_nearest_in_length() {
        let q = query("Song - Remastered 2011", "Band", 180_400);
        let found = [
            record("Song", "Band", 200.0, true),
            record("Song", "Band", 181.0, true),
            record("Song", "Another Band", 180.0, true),
            record("Other Song", "Band", 180.0, true),
        ];
        let chosen = choose(&found, &q).expect("one of them is the song");
        assert_eq!(chosen.duration, 181.0);
        assert_eq!(chosen.artist_name, "Band");
    }

    #[test]
    fn prefers_synced_lyrics_among_the_close_ones() {
        let q = query("Song", "Band", 180_000);
        let found = [
            record("Song", "Band", 180.0, false),
            record("Song", "Band", 182.0, true),
        ];
        assert!(choose(&found, &q).is_some_and(Record::has_synced));
    }

    #[test]
    fn prefers_the_song_s_own_script_to_a_romanization() {
        let q = query("Song", "Band", 180_000);
        let mut romanized = record("Song", "Band", 180.0, true);
        romanized.synced_lyrics = Some(
            "[00:01.00]kimi no koe ga kikoeru
[00:02.00]zutto mae kara shitteita
[00:03.00]sora no iro mo kaze no oto mo
[00:04.00]subete ga kagayaite ita
[00:05.00]namida wo fuite aruite yuku"
                .into(),
        );
        let mut native = record("Song", "Band", 181.0, true);
        native.synced_lyrics = Some("[00:01.00]君の声が聞こえる".into());
        let found = [romanized, native];
        assert_eq!(choose(&found, &q).map(|r| r.duration), Some(181.0));
    }

    #[test]
    fn prefers_whole_lines_to_a_syllable_at_a_time() {
        let q = query("Song", "Band", 168_000);
        let mut syllables = record("Song", "Band", 168.0, true);
        syllables.synced_lyrics = Some(
            (0..30)
                .map(|i| {
                    format!(
                        "[00:{i:02}.00]문
"
                    )
                })
                .collect(),
        );
        let mut lines = record("Song", "Band", 168.0, true);
        lines.synced_lyrics = Some("[00:09.77]드러나는 My worth".into());
        let found = [syllables, lines];
        assert!(choose(&found, &q).is_some_and(|r| r
            .synced_lyrics
            .as_deref()
            .is_some_and(|s| s.contains("worth"))));
    }

    #[test]
    fn keeps_timings_only_from_a_take_of_the_same_length() {
        let r = record("Song", "Band", 180.0, true);
        assert!(matches!(result_of(&r, 180_000), LyricsResult::Synced(_)));
        assert!(matches!(
            result_of(&r, 180_000 + SYNCED_GAP_MS),
            LyricsResult::Synced(_)
        ));
        assert_eq!(
            result_of(&r, 180_000 + SYNCED_GAP_MS + 1),
            LyricsResult::Plain("words".into())
        );
    }

    #[test]
    fn maps_a_record_to_what_it_holds() {
        let mut r = record("Song", "Band", 180.0, true);
        r.synced_lyrics = Some("no stamps here".into());
        assert_eq!(result_of(&r, 180_000), LyricsResult::Plain("words".into()));
        r.plain_lyrics = None;
        assert_eq!(result_of(&r, 180_000), LyricsResult::NotFound);
        r.instrumental = true;
        assert_eq!(result_of(&r, 180_000), LyricsResult::Instrumental);
    }

    #[test]
    fn reads_lrclib_json() {
        let body = r#"{"id":1,"trackName":"T","artistName":"A","albumName":"B","duration":181.5,
            "instrumental":false,"plainLyrics":"x","syncedLyrics":null}"#;
        let r: Record = serde_json::from_str(body).unwrap();
        assert_eq!(r.duration_ms(), 181_500);
        assert!(!r.has_synced());

        // Nulls where values usually are, as LRCLIB sends for some records.
        let sparse = r#"[{"id":2,"trackName":"T","artistName":"A","albumName":null,"duration":null,
            "instrumental":null,"plainLyrics":null,"syncedLyrics":"[00:01.00]x"}]"#;
        let rs: Vec<Record> = serde_json::from_str(sparse).unwrap();
        assert_eq!(rs[0].duration_ms(), 0);
        assert!(rs[0].has_synced());
    }
}
