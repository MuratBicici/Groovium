//! Time-synced lyrics for the song that is playing.
//!
//! Still a proof of concept — the panel that calls this is a development
//! build's alone — but it now looks hard. Several places are asked in turn,
//! and the first synced answer that is this song ends the search:
//!
//! 1. LRCLIB's exact lookup, with the title as Spotify has it.
//! 2. The same, with the title cleaned of what describes the recording rather
//!    than the song ("2011 Remaster", "feat. …", "Radio Edit"), when cleaning
//!    changed it.
//! 3. LRCLIB's search on the cleaned title and first artist.
//! 4. NetEase, when it is switched on.
//!
//! Timings come first. Words without them never end the search: LRCLIB
//! having only the words still sends it on to NetEase for synced ones, and
//! the words are used only when no place has timings.
//!
//! Anything found is checked to be the same song — title, artist, and a
//! length close enough that its timings are this recording's. Words without
//! timings are kept from the first place that had them, and returned if
//! nothing synced turns up. A place that cannot be reached is passed over, not
//! fatal; but an answer reached while one of them was unreachable is not kept
//! in the cache, because that place might have had the timings.
//!
//! Requests go out from here rather than from the webview, so the page's
//! security policy does not have to name these hosts.

mod clean;
mod lrc;
mod lrclib;
mod netease;
mod script;

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

/// Whether NetEase is asked at all. Its endpoint is unofficial and may stop
/// answering at any time; see `netease.rs`. Off here switches it off entirely.
const NETEASE_ENABLED: bool = true;

/// Every request's limit. A place that has not answered by then is passed
/// over, so one slow source cannot hold the lyrics up for long.
const REQUEST_TIMEOUT: Duration = Duration::from_millis(4_000);

/// Sent to every source. LRCLIB asks clients to say who they are.
const USER_AGENT: &str = concat!(
    "Groovium/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/MuratBicici/Groovium)"
);

/// How far another recording's length may be from this one's for its
/// timings to be trusted. LRCLIB's own exact lookup allows two seconds.
pub const SYNCED_GAP_MS: u32 = 4_000;

/// How far it may be and still be taken for its words alone.
pub const PLAIN_GAP_MS: u32 = 10_000;

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

/// Which record an answer came from, so it can be checked by eye.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Matched {
    pub track_name: String,
    pub artist_name: String,
    pub album_name: String,
    pub duration_s: f64,
    /// `lrclib:get`, `lrclib:get-clean`, `lrclib:search` or `netease`.
    pub via: &'static str,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LyricsLookup {
    pub result: LyricsResult,
    pub matched: Option<Matched>,
}

/// What one source found for the song.
#[derive(Clone, Debug)]
pub struct Found {
    pub result: LyricsResult,
    pub track_name: String,
    pub artist_name: String,
    pub album_name: String,
    pub duration_ms: u32,
    pub via: &'static str,
}

impl From<Found> for LyricsLookup {
    fn from(found: Found) -> Self {
        LyricsLookup {
            result: found.result,
            matched: Some(Matched {
                track_name: found.track_name,
                artist_name: found.artist_name,
                album_name: found.album_name,
                duration_s: f64::from(found.duration_ms) / 1000.0,
                via: found.via,
            }),
        }
    }
}

/// The song being looked for, with its title cleaned once for every source.
#[derive(Clone, Debug)]
pub struct Query {
    pub title: String,
    pub clean_title: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: u32,
}

impl Query {
    pub fn new(title: &str, artist: &str, album: &str, duration_ms: u32) -> Self {
        Query {
            title: title.to_string(),
            clean_title: clean::clean_title(title),
            artist: artist.to_string(),
            album: album.to_string(),
            duration_ms,
        }
    }
}

/// Answers already had this session, by track id. Only answers every source
/// was reachable for, so a failed request is asked again next time.
#[derive(Default)]
pub struct LyricsCache(Mutex<HashMap<String, LyricsLookup>>);

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

    let q = Query::new(&track_name, &artist_name, &album_name, duration_ms);
    let (lookup, settled) = look_up(&q).await?;
    if settled {
        cache
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .insert(track_id, lookup.clone());
    }
    Ok(lookup)
}

async fn look_up(q: &Query) -> Result<(LyricsLookup, bool), String> {
    let mut w = Waterfall::default();
    if let Some(done) = w.offer(lrclib::exact(q, &q.title, "lrclib:get").await) {
        return Ok((done, true));
    }
    if q.clean_title != q.title {
        if let Some(done) = w.offer(lrclib::exact(q, &q.clean_title, "lrclib:get-clean").await) {
            return Ok((done, true));
        }
    }
    if let Some(done) = w.offer(lrclib::search(q).await) {
        return Ok((done, true));
    }
    if NETEASE_ENABLED {
        if let Some(done) = w.offer(netease::find(q).await) {
            return Ok((done, true));
        }
    }
    w.finish()
}

/// The search so far: the best answers that did not end it, and whether a
/// source failed.
#[derive(Default)]
struct Waterfall {
    /// Synced lyrics with a flaw — a romanization, or a syllable to a line —
    /// and how bad it is. Kept, the least flawed, and used if no place has
    /// them clean.
    flawed: Option<(u8, Found)>,
    plain: Option<Found>,
    failed: Option<String>,
}

impl Waterfall {
    /// One source's answer. `Some` when it settles the search: synced lyrics,
    /// or a piece known to have no words.
    fn offer(&mut self, answer: Result<Option<Found>, String>) -> Option<LyricsLookup> {
        match answer {
            Ok(Some(found)) => match &found.result {
                LyricsResult::Synced(lines) if flaw(lines) > 0 => {
                    let how_bad = flaw(lines);
                    if self
                        .flawed
                        .as_ref()
                        .map_or(true, |(worst, _)| how_bad < *worst)
                    {
                        self.flawed = Some((how_bad, found));
                    }
                    None
                }
                LyricsResult::Synced(_) | LyricsResult::Instrumental => Some(found.into()),
                LyricsResult::Plain(_) => {
                    if self.plain.is_none() {
                        self.plain = Some(found);
                    }
                    None
                }
                LyricsResult::NotFound => None,
            },
            Ok(None) => None,
            Err(e) => {
                log::warn!("a lyrics source failed: {e}");
                self.failed.get_or_insert(e);
                None
            }
        }
    }

    /// Nothing synced and clean anywhere: the least flawed synced lyrics if
    /// there were any, else the words if some place had them, and whether the
    /// answer may be kept.
    fn finish(self) -> Result<(LyricsLookup, bool), String> {
        let settled = self.failed.is_none();
        let best = self.flawed.map(|(_, found)| found).or(self.plain);
        match (best, self.failed) {
            (Some(plain), _) => Ok((plain.into(), settled)),
            (None, Some(e)) => Err(e),
            (None, None) => Ok((
                LyricsLookup {
                    result: LyricsResult::NotFound,
                    matched: None,
                },
                true,
            )),
        }
    }
}

/// What is wrong with synced lyrics, lower better: nothing, a romanization
/// of the song (`script.rs`), or a syllable to a line (`lrc::fragmented`).
/// The last is worst: a romanization can at least be read along with.
pub fn flaw(lines: &[LyricLine]) -> u8 {
    if lrc::fragmented(lines) {
        2
    } else if script::lines_romanized(lines) {
        1
    } else {
        0
    }
}

/// A field a source may send as `null`: read as its empty value. `default`
/// alone covers a field that is missing, not one that is there and null — and
/// one null among fifty search results failed the whole search.
pub fn or_default<'de, D, T>(d: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(d)?.unwrap_or_default())
}

/// The candidate nearest in length, within `PLAIN_GAP_MS`.
///
/// Those close enough for their timings to hold come first, and among them
/// the best by `rank` — lower is better; after them, those that are only close
/// enough to read. Within each, the nearest.
pub fn pick_nearest<'a, T>(
    items: &[&'a T],
    duration_ms: u32,
    length: impl Fn(&T) -> u32,
    rank: impl Fn(&T) -> u8,
) -> Option<&'a T> {
    items
        .iter()
        .copied()
        .filter(|item| length(item).abs_diff(duration_ms) <= PLAIN_GAP_MS)
        .min_by_key(|item| {
            let gap = length(item).abs_diff(duration_ms);
            (gap > SYNCED_GAP_MS, rank(item), gap)
        })
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

/// One GET. `None` for a 404, which is "no such track" to both sources.
async fn fetch(url: reqwest::Url, referer: Option<&str>) -> Result<Option<String>, String> {
    let host = url.host_str().unwrap_or("?").to_string();
    let mut request = client().get(url).header("User-Agent", USER_AGENT);
    if let Some(referer) = referer {
        request = request.header("Referer", referer);
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("Could not reach {host}: {e}"))?;
    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !status.is_success() {
        return Err(format!("{host} returned {status}."));
    }
    response
        .text()
        .await
        .map(Some)
        .map_err(|e| format!("Could not read the answer from {host}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn found(result: LyricsResult, via: &'static str) -> Found {
        Found {
            result,
            track_name: "Song".into(),
            artist_name: "Band".into(),
            album_name: String::new(),
            duration_ms: 180_000,
            via,
        }
    }

    fn synced() -> LyricsResult {
        LyricsResult::Synced(vec![LyricLine {
            time_ms: 0,
            text: "x".into(),
        }])
    }

    #[test]
    fn stops_at_the_first_synced_answer() {
        let mut w = Waterfall::default();
        assert!(w.offer(Ok(None)).is_none());
        let done = w.offer(Ok(Some(found(synced(), "lrclib:search"))));
        assert_eq!(
            done.and_then(|d| d.matched).map(|m| m.via),
            Some("lrclib:search")
        );
    }

    #[test]
    fn words_from_lrclib_do_not_stop_netease_being_asked_for_timings() {
        // Timings come first: LRCLIB having only the words is not an answer,
        // and NetEase's synced lyrics win over them.
        let mut w = Waterfall::default();
        assert!(w
            .offer(Ok(Some(found(
                LyricsResult::Plain("words".into()),
                "lrclib:get"
            ))))
            .is_none());
        let done = w.offer(Ok(Some(found(synced(), "netease"))));
        let done = done.expect("synced lyrics settle it");
        assert!(matches!(done.result, LyricsResult::Synced(_)));
        assert_eq!(done.matched.map(|m| m.via), Some("netease"));
    }

    fn romaji(via: &'static str) -> Found {
        let text = "kimi no koe ga kikoeru zutto mae kara shitteita sora no iro mo kaze no oto mo subete ga kagayaite ita namida wo fuite";
        found(
            LyricsResult::Synced(vec![LyricLine {
                time_ms: 0,
                text: text.into(),
            }]),
            via,
        )
    }

    #[test]
    fn a_romanization_waits_for_the_song_s_own_script() {
        let mut w = Waterfall::default();
        assert!(w.offer(Ok(Some(romaji("lrclib:get")))).is_none());
        let native = found(
            LyricsResult::Synced(vec![LyricLine {
                time_ms: 0,
                text: "君の声が聞こえる".into(),
            }]),
            "netease",
        );
        let done = w
            .offer(Ok(Some(native)))
            .expect("its own script settles it");
        assert_eq!(done.matched.map(|m| m.via), Some("netease"));
    }

    #[test]
    fn a_romanization_is_still_better_than_no_timings() {
        let mut w = Waterfall::default();
        w.offer(Ok(Some(found(
            LyricsResult::Plain("words".into()),
            "lrclib:get",
        ))));
        w.offer(Ok(Some(romaji("lrclib:search"))));
        let (lookup, _) = w.finish().unwrap();
        assert!(matches!(lookup.result, LyricsResult::Synced(_)));
    }

    fn syllables(via: &'static str) -> Found {
        let lines = (0..30)
            .map(|i| LyricLine {
                time_ms: i * 100,
                text: "문".into(),
            })
            .collect();
        found(LyricsResult::Synced(lines), via)
    }

    #[test]
    fn a_syllable_to_a_line_waits_for_whole_lines() {
        let mut w = Waterfall::default();
        assert!(w.offer(Ok(Some(syllables("lrclib:get")))).is_none());
        let done = w.offer(Ok(Some(found(synced(), "lrclib:search"))));
        assert_eq!(
            done.and_then(|d| d.matched).map(|m| m.via),
            Some("lrclib:search")
        );
    }

    #[test]
    fn the_least_flawed_is_kept_whatever_order_they_come_in() {
        let mut w = Waterfall::default();
        w.offer(Ok(Some(syllables("lrclib:get"))));
        w.offer(Ok(Some(romaji("lrclib:search"))));
        w.offer(Ok(Some(syllables("netease"))));
        let (lookup, _) = w.finish().unwrap();
        assert_eq!(lookup.matched.map(|m| m.via), Some("lrclib:search"));
    }

    #[test]
    fn keeps_the_first_words_while_it_looks_for_timings() {
        let mut w = Waterfall::default();
        assert!(w
            .offer(Ok(Some(found(
                LyricsResult::Plain("first".into()),
                "lrclib:get"
            ))))
            .is_none());
        assert!(w
            .offer(Ok(Some(found(
                LyricsResult::Plain("second".into()),
                "netease"
            ))))
            .is_none());
        let (lookup, settled) = w.finish().unwrap();
        assert_eq!(lookup.result, LyricsResult::Plain("first".into()));
        assert!(settled);
    }

    #[test]
    fn a_piece_without_words_settles_it() {
        let mut w = Waterfall::default();
        assert!(w
            .offer(Ok(Some(found(LyricsResult::Instrumental, "lrclib:get"))))
            .is_some());
    }

    #[test]
    fn does_not_keep_an_answer_reached_past_a_failure() {
        let mut w = Waterfall::default();
        w.offer(Ok(Some(found(
            LyricsResult::Plain("words".into()),
            "lrclib:get",
        ))));
        w.offer(Err("netease timed out".into()));
        let (_, settled) = w.finish().unwrap();
        assert!(!settled);
    }

    #[test]
    fn fails_only_when_nothing_was_found_and_something_failed() {
        let mut w = Waterfall::default();
        w.offer(Err("lrclib is down".into()));
        assert!(w.finish().is_err());

        let (lookup, settled) = Waterfall::default().finish().unwrap();
        assert_eq!(lookup.result, LyricsResult::NotFound);
        assert!(settled);
    }

    #[test]
    fn nearest_prefers_timings_that_hold() {
        let lengths = [
            (180_000u32, false),
            (183_000, true),
            (186_000, true),
            (191_000, true),
        ];
        let items: Vec<&(u32, bool)> = lengths.iter().collect();
        let pick = |d| pick_nearest(&items, d, |i| i.0, |i| u8::from(!i.1)).map(|i| i.0);
        // In step and synced beats in step and nearer but unsynced.
        assert_eq!(pick(180_000), Some(183_000));
        // In step without timings beats timings from another take, which
        // could only be read anyway.
        let other = [(180_000u32, false), (186_000, true)];
        let other: Vec<&(u32, bool)> = other.iter().collect();
        assert_eq!(
            pick_nearest(&other, 180_000, |i| i.0, |i| u8::from(!i.1)).map(|i| i.0),
            Some(180_000)
        );
        // Nothing in step: the nearest readable one.
        assert_eq!(pick(195_500), Some(191_000));
        // Nothing within reach at all.
        assert_eq!(pick(250_000), None);
        assert_eq!(pick(191_000 + PLAIN_GAP_MS), Some(191_000));
        assert_eq!(pick(191_000 + PLAIN_GAP_MS + 1), None);
    }

    /// Asks the real sources about real songs and prints what came back. Not
    /// run with the rest, since it needs the network: `cargo test lyrics::tests::live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live() {
        let songs = [
            (
                "Get Lucky (feat. Pharrell Williams & Nile Rodgers) - Radio Edit",
                "Daft Punk, Pharrell Williams, Nile Rodgers",
                "Get Lucky",
                248_413,
            ),
            (
                "Bohemian Rhapsody - Remastered 2011",
                "Queen",
                "A Night At The Opera (2011 Remaster)",
                354_947,
            ),
            ("Şımarık", "Tarkan", "Ölürüm Sana", 234_000),
            ("Blinding Lights", "The Weeknd", "After Hours", 200_040),
            (
                "Cry For Me - Slowed + Reverb",
                "Camila Cabello",
                "",
                170_000,
            ),
            ("Flying Theme", "John Williams", "E.T.", 240_000),
            ("iffy iffy", "LE SSERAFIM", "PUREFLOW pt.1", 129_500),
            // LRCLIB's exact match for this one is a romanization.
            (
                "Wonderland Trickery",
                "Sān-Z, HOYO-MiX",
                "Wonderland Trickery",
                199_316,
            ),
            // LRCLIB holds this one a syllable to a line as well as a line at a time.
            ("Biggest Fan", "IRENE", "Like A Flower", 168_000),
        ];
        tauri::async_runtime::block_on(async {
            for (title, artist, album, ms) in songs {
                let q = Query::new(title, artist, album, ms);
                let started = std::time::Instant::now();
                let answer = look_up(&q).await;
                let took = started.elapsed().as_millis();
                match answer {
                    Ok((lookup, settled)) => {
                        let kind = match &lookup.result {
                            LyricsResult::Synced(l) => format!("Synced ({} lines)", l.len()),
                            LyricsResult::Plain(_) => "Plain".into(),
                            LyricsResult::Instrumental => "Instrumental".into(),
                            LyricsResult::NotFound => "NotFound".into(),
                        };
                        let via = lookup
                            .matched
                            .map(|m| {
                                format!(
                                    "{} — {} [{}] {:.1}s",
                                    m.track_name, m.artist_name, m.via, m.duration_s
                                )
                            })
                            .unwrap_or_default();
                        println!("{took:>5} ms  {title} | clean: {} | {kind} | {via} | settled {settled}", q.clean_title);
                    }
                    Err(e) => println!("{took:>5} ms  {title} | error {e}"),
                }
            }
        });
    }

    /// NetEase on its own, so it is known to work even when LRCLIB answers
    /// first: `cargo test lyrics::tests::live_netease -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_netease() {
        let q = Query::new(
            "Get Lucky (feat. Pharrell Williams & Nile Rodgers)",
            "Daft Punk, Pharrell Williams, Nile Rodgers",
            "",
            369_626,
        );
        let found = tauri::async_runtime::block_on(netease::find(&q));
        match found {
            Ok(Some(f)) => {
                let kind = match &f.result {
                    LyricsResult::Synced(l) => {
                        format!("Synced ({} lines), first: {:?}", l.len(), l.first())
                    }
                    other => format!("{other:?}"),
                };
                println!(
                    "{} — {} {}ms | {kind}",
                    f.track_name, f.artist_name, f.duration_ms
                );
            }
            other => println!("{other:?}"),
        }
    }
}
