//! Track similarity from Last.fm.
//!
//! This is what the station is built on. Spotify removed `/recommendations` for
//! new apps in November 2024 and `audio-features` with it, so there is no
//! similarity data left inside Spotify to use.
//!
//! Last.fm's `track.getSimilar` fills that gap, and its shape happens to suit
//! this app better than Spotify's ever did: it is queried by **artist and title**
//! rather than by a platform id. One lookup therefore works for a local mp3 and
//! for a Spotify track alike, which is the only way a station could span both.
//!
//! The call lives in Rust for two reasons. Last.fm requires an identifying
//! `User-Agent`, and browsers refuse to let JavaScript set that header. And
//! keeping it here means the API key never enters the webview.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::config;

const API_ROOT: &str = "https://ws.audioscrobbler.com/2.0/";

/// Last.fm asks for an identifiable agent and suspends accounts that hammer it.
const USER_AGENT: &str = concat!("Groovium/", env!("CARGO_PKG_VERSION"), " (desktop music player)");

/// Overrides the stored value. Convenient for development; the app never writes it.
const API_KEY_ENV: &str = "GROOVIUM_LASTFM_API_KEY";

/// Where a user creates their own key. Free and immediate.
pub const API_ACCOUNT_URL: &str = "https://www.last.fm/api/account/create";

/// How many candidates to ask for.
///
/// Deliberately generous: every extra candidate is another chance to find a
/// match already in the user's library, which needs no second network call at
/// all, and so another chance to skip a Spotify search entirely.
///
/// Raised from fifty when the picking became a weighted shuffle rather than a
/// sort. Under a sort the tail was unreachable and asking for it was waste;
/// now every candidate can come up, so the width of the pool is the width of
/// the station. It costs nothing — one request either way.
const SIMILAR_LIMIT: u32 = 100;

/// Give up rather than hang.
///
/// This used to be background work nobody was waiting on. Pressing Next now
/// runs the same lookup on demand, so a stalled connection would leave the
/// button looking ignored with the indicator pulsing indefinitely.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);

/// One suggestion. Names only — resolving it to something playable is the
/// frontend's job, and it deliberately tries the local library first.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimilarTrack {
    pub title: String,
    pub artist: String,
    /// Last.fm's similarity score, 0..1. Results arrive already sorted.
    pub match_score: f64,
}

// --- Response shapes --------------------------------------------------------

#[derive(Deserialize)]
struct SimilarResponse {
    #[serde(rename = "similartracks")]
    similar_tracks: Option<SimilarTracks>,
    message: Option<String>,
}

#[derive(Deserialize)]
struct SimilarTracks {
    #[serde(default)]
    track: Vec<RawTrack>,
}

#[derive(Deserialize)]
struct RawTrack {
    name: String,
    artist: RawArtist,
    /// Sometimes a number, sometimes a string, sometimes absent.
    #[serde(rename = "match")]
    match_score: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct RawArtist {
    name: String,
}

// --- The artist fallback ----------------------------------------------------

/// How many similar artists to ask for.
const SIMILAR_ARTIST_LIMIT: u32 = 10;

/// How many of those artists actually have their top tracks fetched.
///
/// Each one is a request. This whole path runs only when the track lookup came
/// back empty, so four is a handful spent rarely rather than a burst spent
/// every song.
const ARTISTS_TO_MINE: usize = 4;

/// Top tracks taken from each artist.
const TOP_TRACKS_LIMIT: u32 = 10;

/// How much a track's rank within its artist discounts that artist's score.
///
/// Small on purpose: which artist it is matters far more than whether this was
/// their third or their eighth most played song.
const RANK_PENALTY: f64 = 0.05;

#[derive(Deserialize)]
struct SimilarArtistsResponse {
    #[serde(rename = "similarartists")]
    similar_artists: Option<SimilarArtists>,
    message: Option<String>,
}

#[derive(Deserialize)]
struct SimilarArtists {
    #[serde(default)]
    artist: Vec<RawSimilarArtist>,
}

#[derive(Deserialize)]
struct RawSimilarArtist {
    name: String,
    #[serde(rename = "match")]
    match_score: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct TopTracksResponse {
    #[serde(rename = "toptracks")]
    top_tracks: Option<TopTracks>,
}

#[derive(Deserialize)]
struct TopTracks {
    #[serde(default)]
    track: Vec<RawTopTrack>,
}

#[derive(Deserialize)]
struct RawTopTrack {
    name: String,
}

fn score_of(value: &Option<serde_json::Value>) -> f64 {
    match value {
        Some(serde_json::Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(serde_json::Value::String(s)) => s.parse().unwrap_or(0.0),
        _ => 0.0,
    }
}

// --- Configuration ----------------------------------------------------------

pub fn api_key(app: &AppHandle) -> Option<String> {
    if let Ok(from_env) = std::env::var(API_KEY_ENV) {
        let trimmed = from_env.trim().to_owned();
        if !trimmed.is_empty() {
            return Some(trimmed);
        }
    }
    config::read(app).lastfm_api_key.filter(|k| !k.is_empty())
}

/// Catch an obviously wrong value before it becomes an opaque API error.
///
/// Last.fm keys are 32 hex characters — the same shape as a Spotify Client ID,
/// which is exactly why someone will eventually paste one into the other. The
/// shape check cannot tell them apart, so the error message names both.
pub fn validate(key: &str) -> Result<(), String> {
    if key.is_empty() {
        return Err("empty".into());
    }
    if key.len() != 32 || !key.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("malformed".into());
    }
    Ok(())
}

#[tauri::command(async)]
pub fn lastfm_has_api_key(app: AppHandle) -> bool {
    api_key(&app).is_some()
}

#[tauri::command(async)]
pub fn lastfm_set_api_key(app: AppHandle, api_key: String) -> Result<(), String> {
    let key = api_key.trim();
    validate(key).map_err(|e| {
        format!("That key is {e}. A Last.fm key is 32 hex characters — check you did not paste your Spotify Client ID.")
    })?;
    config::update(&app, |c| c.lastfm_api_key = Some(key.to_owned()))
}

#[tauri::command(async)]
pub fn lastfm_clear_api_key(app: AppHandle) -> Result<(), String> {
    config::update(&app, |c| c.lastfm_api_key = None)
}

#[tauri::command(async)]
pub fn lastfm_open_account(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    app.opener()
        .open_url(API_ACCOUNT_URL, None::<&str>)
        .map_err(|e| format!("Could not open the browser: {e}"))
}

// --- Transport --------------------------------------------------------------

/// Build a request URL, adding the two parameters every call needs.
fn endpoint(key: &str, params: &[(&str, &str)]) -> Result<reqwest::Url, String> {
    let mut all = params.to_vec();
    all.push(("api_key", key));
    all.push(("format", "json"));
    reqwest::Url::parse_with_params(API_ROOT, &all)
        .map_err(|e| format!("Could not build the Last.fm request: {e}"))
}

/// One GET, returning the raw body.
///
/// Shared by the track lookup and the artist fallback, which is worth the
/// indirection: the identifying `User-Agent` and the timeout are both things
/// that would eventually be set on one call and forgotten on the other.
async fn fetch(url: reqwest::Url) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| format!("Could not create the HTTP client: {e}"))?;

    let response = client
        .get(url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Could not reach Last.fm: {e}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Could not read the Last.fm response: {e}"))?;

    if !status.is_success() {
        return Err(format!("Last.fm returned {status}."));
    }
    Ok(body)
}

// --- The lookup -------------------------------------------------------------

/// Tracks similar to the given one, most similar first.
///
/// Returns an empty list rather than an error when Last.fm simply knows nothing
/// about the track — that is an ordinary outcome for obscure or local-only
/// music, and the station should fall quiet rather than show a failure.
#[tauri::command(async)]
pub async fn lastfm_similar_tracks(
    app: AppHandle,
    artist: String,
    title: String,
) -> Result<Vec<SimilarTrack>, String> {
    let key = api_key(&app).ok_or_else(|| "No Last.fm API key configured.".to_string())?;
    if artist.trim().is_empty() || title.trim().is_empty() {
        return Ok(Vec::new());
    }

    let url = endpoint(
        &key,
        &[
            ("method", "track.getsimilar"),
            ("artist", artist.trim()),
            ("track", title.trim()),
            // Let Last.fm fix small spelling differences; local tags are messy.
            ("autocorrect", "1"),
            ("limit", &SIMILAR_LIMIT.to_string()),
        ],
    )?;
    let body = fetch(url).await?;

    let parsed: SimilarResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Unexpected response from Last.fm: {e}"))?;

    // Last.fm reports errors with HTTP 200 and a `message` field.
    if let Some(message) = parsed.message {
        return Err(format!("Last.fm: {message}"));
    }

    Ok(parsed
        .similar_tracks
        .map(|s| s.track)
        .unwrap_or_default()
        .into_iter()
        .map(|t| SimilarTrack {
            title: t.name,
            artist: t.artist.name,
            match_score: score_of(&t.match_score),
        })
        .collect())
}

// --- The artist fallback ----------------------------------------------------

/// One artist's best-known songs, by name.
async fn top_tracks(key: &str, artist: &str) -> Result<Vec<String>, String> {
    let url = endpoint(
        key,
        &[
            ("method", "artist.gettoptracks"),
            ("artist", artist),
            ("autocorrect", "1"),
            ("limit", &TOP_TRACKS_LIMIT.to_string()),
        ],
    )?;
    let body = fetch(url).await?;

    let parsed: TopTracksResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Unexpected response from Last.fm: {e}"))?;

    Ok(parsed
        .top_tracks
        .map(|t| t.track)
        .unwrap_or_default()
        .into_iter()
        .map(|t| t.name)
        .collect())
}

/// Candidates drawn from artists similar to this one.
///
/// What `lastfm_similar_tracks` falls back to. Last.fm's track database is
/// thinner than its artist database by a wide margin — plenty of album tracks
/// by perfectly well-known bands return nothing at all — and a station that
/// stops dead on one of those loses a run that was going fine. The artist is
/// almost always known even when the song is not.
///
/// Answers in exactly the shape the track lookup does, so everything that
/// consumes it is unchanged. The score is the similar artist's own `match`,
/// discounted slightly by where the track sits among their top ten: which
/// artist it is carries far more information than which of their songs.
///
/// Costs one request plus one per artist mined, and runs only on a dead end.
#[tauri::command(async)]
pub async fn lastfm_artist_candidates(
    app: AppHandle,
    artist: String,
) -> Result<Vec<SimilarTrack>, String> {
    let key = api_key(&app).ok_or_else(|| "No Last.fm API key configured.".to_string())?;
    let seed = artist.trim();
    if seed.is_empty() {
        return Ok(Vec::new());
    }

    let url = endpoint(
        &key,
        &[
            ("method", "artist.getsimilar"),
            ("artist", seed),
            ("autocorrect", "1"),
            ("limit", &SIMILAR_ARTIST_LIMIT.to_string()),
        ],
    )?;
    let body = fetch(url).await?;

    let parsed: SimilarArtistsResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Unexpected response from Last.fm: {e}"))?;

    // Last.fm reports errors with HTTP 200 and a `message` field.
    if let Some(message) = parsed.message {
        return Err(format!("Last.fm: {message}"));
    }

    let artists = parsed.similar_artists.map(|s| s.artist).unwrap_or_default();

    let mut candidates = Vec::new();
    for entry in artists.into_iter().take(ARTISTS_TO_MINE) {
        let score = score_of(&entry.match_score);
        // One artist failing costs that artist's suggestions, not the answer.
        // Giving up here would put back the dead end this exists to remove.
        let Ok(tracks) = top_tracks(&key, &entry.name).await else {
            continue;
        };
        for (rank, title) in tracks.into_iter().enumerate() {
            candidates.push(SimilarTrack {
                title,
                artist: entry.name.clone(),
                match_score: score * rank_factor(rank),
            });
        }
    }
    Ok(candidates)
}

/// How much of an artist's score a track keeps, given its rank among their top.
fn rank_factor(rank: usize) -> f64 {
    (1.0 - RANK_PENALTY * rank as f64).max(0.1)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Placeholder with the right shape, not anyone's key.
    const EXAMPLE_KEY: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn accepts_a_correctly_shaped_key() {
        assert!(validate(EXAMPLE_KEY).is_ok());
    }

    #[test]
    fn rejects_the_usual_mistakes() {
        for bad in ["", "0123", "0123456789abcdef0123456789abcdefaa", "https://www.last.fm/api"] {
            assert!(validate(bad).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn parses_a_real_shaped_response() {
        let body = r#"{"similartracks":{"track":[
            {"name":"Trans-Europe Express","artist":{"name":"Kraftwerk"},"match":1.0},
            {"name":"Oxygene, Pt. 4","artist":{"name":"Jean-Michel Jarre"},"match":"0.62"}
        ]}}"#;
        let parsed: SimilarResponse = serde_json::from_str(body).expect("parses");
        let tracks = parsed.similar_tracks.unwrap().track;

        assert_eq!(tracks.len(), 2);
        assert_eq!(tracks[0].name, "Trans-Europe Express");
        // The score arrives as a number sometimes and a string other times.
        assert_eq!(score_of(&tracks[0].match_score), 1.0);
        assert_eq!(score_of(&tracks[1].match_score), 0.62);
    }

    #[test]
    fn a_track_last_fm_knows_nothing_about_yields_an_empty_list() {
        // Not an error: plenty of local music is unknown to Last.fm, and the
        // station should go quiet rather than show a failure.
        let parsed: SimilarResponse =
            serde_json::from_str(r#"{"similartracks":{"track":[]}}"#).expect("parses");
        assert!(parsed.similar_tracks.unwrap().track.is_empty());
    }

    #[test]
    fn an_error_payload_is_recognised() {
        // Last.fm reports failures with HTTP 200 and a message field, so the
        // status code alone would say everything is fine.
        let parsed: SimilarResponse =
            serde_json::from_str(r#"{"error":6,"message":"Track not found"}"#).expect("parses");
        assert_eq!(parsed.message.as_deref(), Some("Track not found"));
        assert!(parsed.similar_tracks.is_none());
    }

    #[test]
    fn a_missing_score_does_not_break_parsing() {
        let parsed: SimilarResponse =
            serde_json::from_str(r#"{"similartracks":{"track":[{"name":"X","artist":{"name":"Y"}}]}}"#)
                .expect("parses");
        assert_eq!(score_of(&parsed.similar_tracks.unwrap().track[0].match_score), 0.0);
    }

    #[test]
    fn parses_a_similar_artists_response() {
        // The fallback's first hop. Note `match` arrives as a string here even
        // though the track endpoint sends a number for the same idea.
        let body = r#"{"similarartists":{"artist":[
            {"name":"Neu!","match":"1"},
            {"name":"Harmonia","match":"0.83"}
        ]}}"#;
        let parsed: SimilarArtistsResponse = serde_json::from_str(body).expect("parses");
        let artists = parsed.similar_artists.unwrap().artist;

        assert_eq!(artists.len(), 2);
        assert_eq!(artists[0].name, "Neu!");
        assert_eq!(score_of(&artists[0].match_score), 1.0);
        assert_eq!(score_of(&artists[1].match_score), 0.83);
    }

    #[test]
    fn parses_a_top_tracks_response() {
        let body = r#"{"toptracks":{"track":[
            {"name":"Hallogallo","artist":{"name":"Neu!"}},
            {"name":"Für Immer","artist":{"name":"Neu!"}}
        ]}}"#;
        let parsed: TopTracksResponse = serde_json::from_str(body).expect("parses");
        let tracks = parsed.top_tracks.unwrap().track;

        assert_eq!(tracks.len(), 2);
        assert_eq!(tracks[0].name, "Hallogallo");
    }

    #[test]
    fn an_artist_last_fm_knows_nothing_about_yields_an_empty_list() {
        // Same contract the track lookup has: silence, not a failure.
        let parsed: SimilarArtistsResponse =
            serde_json::from_str(r#"{"similarartists":{"artist":[]}}"#).expect("parses");
        assert!(parsed.similar_artists.unwrap().artist.is_empty());
    }

    #[test]
    fn rank_discounts_gently_and_never_to_nothing() {
        // Which artist it is matters more than which of their songs, so the
        // spread across one artist's top ten stays narrow.
        assert_eq!(rank_factor(0), 1.0);
        assert!(rank_factor(9) > 0.5, "the tenth song is still a real candidate");
        assert!(rank_factor(0) > rank_factor(9), "but the best-known one leads");
        // A floor, so a longer list could never produce a zero or negative
        // weight — which the picker reads as "never", not "unlikely".
        assert!(rank_factor(1000) >= 0.1);
    }

    #[test]
    fn the_artist_fallback_is_bounded() {
        // The reason this is a fallback and not the main path: it spends one
        // request per artist mined, on top of the one that finds them.
        assert!(ARTISTS_TO_MINE <= 5, "a handful, not a burst");
        assert!(ARTISTS_TO_MINE as u32 <= SIMILAR_ARTIST_LIMIT);
    }

    #[test]
    fn the_user_agent_identifies_the_app() {
        // Last.fm suspends anonymous or misbehaving clients.
        assert!(USER_AGENT.starts_with("Groovium/"));
    }
}
