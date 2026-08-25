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

    let url = reqwest::Url::parse_with_params(
        API_ROOT,
        &[
            ("method", "track.getsimilar"),
            ("artist", artist.trim()),
            ("track", title.trim()),
            // Let Last.fm fix small spelling differences; local tags are messy.
            ("autocorrect", "1"),
            ("limit", &SIMILAR_LIMIT.to_string()),
            ("api_key", &key),
            ("format", "json"),
        ],
    )
    .map_err(|e| format!("Could not build the Last.fm request: {e}"))?;

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
    fn the_user_agent_identifies_the_app() {
        // Last.fm suspends anonymous or misbehaving clients.
        assert!(USER_AGENT.starts_with("Groovium/"));
    }
}
