//! The authorization-code + PKCE flow.
//!
//! Runs entirely in Rust, for the same reason the file picker does: the piece
//! that talks to the OS and the network is the piece that should hold the
//! secrets. The webview never sees the authorization code, the verifier, or the
//! refresh token — it calls `spotify_begin_auth` and gets back an account name.
//!
//! Shape of the round trip:
//!   1. bind a loopback listener on the port Spotify has registered
//!   2. open the system browser at Spotify's consent page
//!   3. Spotify redirects back to the listener with `code` and `state`
//!   4. verify `state`, exchange `code` + `verifier` for tokens

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use tiny_http::{Header, Response, Server};

use crate::spotify::config::{self, CALLBACK_PORT, REDIRECT_URI};
use crate::spotify::error::AuthError;
use crate::spotify::pkce;
use crate::spotify::tokens::{self, AccessTokenCache};

const AUTHORIZE_ENDPOINT: &str = "https://accounts.spotify.com/authorize";
const PROFILE_ENDPOINT: &str = "https://api.spotify.com/v1/me";

/// Least privilege. `streaming` is what the Web Playback SDK needs; the two
/// `user-read-*` identity scopes are its prerequisites; the playback-state pair
/// is for transport control. No playlist or library scopes are requested.
const SCOPES: &str = "streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state";

/// How long to leave the listener open. Long enough to log in and approve,
/// short enough that an abandoned attempt does not hold the port forever.
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub display_name: String,
    /// "premium" | "free" | "open". Playback needs premium, and knowing this
    /// lets the UI say so plainly instead of failing later inside the SDK.
    pub product: String,
}

#[derive(Deserialize)]
struct Profile {
    display_name: Option<String>,
    id: String,
    product: Option<String>,
}

pub async fn begin(app: &AppHandle, cache: &AccessTokenCache) -> Result<Account, AuthError> {
    let client_id = config::client_id(app)
        .ok_or_else(|| AuthError::new("no_client_id", "No Spotify Client ID configured."))?;
    config::validate(&client_id)
        .map_err(|e| AuthError::new("invalid_client_id", format!("Client ID is {e}.")))?;

    let pkce = pkce::generate();

    // Bind before opening the browser: if the port is taken there is no point
    // sending the user off to authorise something we cannot receive.
    let server = Server::http(("127.0.0.1", CALLBACK_PORT)).map_err(|e| {
        AuthError::new(
            "port_busy",
            format!("Could not listen on 127.0.0.1:{CALLBACK_PORT}: {e}"),
        )
    })?;

    let authorize_url = build_authorize_url(&client_id, &pkce.challenge, &pkce.state);
    app.opener()
        .open_url(authorize_url, None::<&str>)
        .map_err(|e| AuthError::new("network", format!("Could not open the browser: {e}")))?;

    // tiny_http blocks, so it waits on the blocking pool rather than stalling
    // the async runtime for up to three minutes.
    let expected_state = pkce.state.clone();
    let code = tauri::async_runtime::spawn_blocking(move || wait_for_callback(server, &expected_state))
        .await
        .map_err(|e| AuthError::new("timeout", format!("Callback task failed: {e}")))??;

    let response = tokens::exchange(&[
        ("grant_type", "authorization_code"),
        ("code", &code),
        ("redirect_uri", REDIRECT_URI),
        ("client_id", &client_id),
        ("code_verifier", &pkce.verifier),
    ])
    .await?;

    let refresh = response.refresh_token.as_deref().ok_or_else(|| {
        AuthError::new(
            "token_exchange_failed",
            "Spotify did not return a refresh token.",
        )
    })?;
    tokens::store_refresh_token(refresh)?;

    let account = fetch_profile(&response.access_token).await?;
    // Keep the token we were just handed rather than refreshing on the next call.
    cache.put(&response.access_token, response.expires_in);
    Ok(account)
}

fn build_authorize_url(client_id: &str, challenge: &str, state: &str) -> String {
    let query = [
        ("client_id", client_id),
        ("response_type", "code"),
        ("redirect_uri", REDIRECT_URI),
        ("code_challenge_method", "S256"),
        ("code_challenge", challenge),
        ("state", state),
        ("scope", SCOPES),
    ]
    .iter()
    .map(|(k, v)| format!("{k}={}", urlencode(v)))
    .collect::<Vec<_>>()
    .join("&");

    format!("{AUTHORIZE_ENDPOINT}?{query}")
}

/// Block until Spotify redirects back, then hand over the authorization code.
fn wait_for_callback(server: Server, expected_state: &str) -> Result<String, AuthError> {
    let deadline = Instant::now() + CALLBACK_TIMEOUT;

    while Instant::now() < deadline {
        let request = match server.recv_timeout(Duration::from_millis(250)) {
            Ok(Some(request)) => request,
            Ok(None) => continue,
            Err(e) => return Err(AuthError::new("network", e.to_string())),
        };

        let url = request.url().to_owned();

        // Browsers ask for /favicon.ico on the way through; only the callback
        // path carries the result.
        if !url.starts_with("/callback") {
            let _ = request.respond(Response::empty(404));
            continue;
        }

        let params = parse_query(&url);
        let outcome = interpret_callback(&params, expected_state);

        let body = match &outcome {
            Ok(_) => page("Groovium is connected", "You can close this window and return to the app."),
            Err(e) => page("Could not connect", &e.detail),
        };
        let _ = request.respond(Response::from_string(body).with_header(html_header()));

        return outcome;
    }

    Err(AuthError::new(
        "timeout",
        "Timed out waiting for Spotify to redirect back.",
    ))
}

fn interpret_callback(
    params: &[(String, String)],
    expected_state: &str,
) -> Result<String, AuthError> {
    let get = |key: &str| {
        params
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    };

    if let Some(error) = get("error") {
        // Spotify sends `access_denied` both when the user declines and when the
        // account is not on a development-mode app's user list.
        return Err(AuthError::new("access_denied", error.to_owned()));
    }

    // Check state before touching the code: a callback we did not initiate must
    // not have its code exchanged.
    let received_state = get("state").unwrap_or_default();
    if !pkce::state_matches(expected_state, received_state) {
        return Err(AuthError::new(
            "state_mismatch",
            "The redirect did not match the request that started it.",
        ));
    }

    get("code")
        .map(str::to_owned)
        .ok_or_else(|| AuthError::new("token_exchange_failed", "Redirect carried no code."))
}

async fn fetch_profile(access_token: &str) -> Result<Account, AuthError> {
    let response = reqwest::Client::new()
        .get(PROFILE_ENDPOINT)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| AuthError::new("network", e.to_string()))?;

    if !response.status().is_success() {
        return Err(AuthError::new(
            "token_exchange_failed",
            format!("Profile request failed: {}", response.status()),
        ));
    }

    let profile: Profile = response
        .json()
        .await
        .map_err(|e| AuthError::new("network", e.to_string()))?;

    Ok(Account {
        display_name: profile.display_name.unwrap_or(profile.id),
        product: profile.product.unwrap_or_else(|| "unknown".into()),
    })
}

// --- small URL helpers ------------------------------------------------------
// A full URL crate would be overkill for one query string we control the shape of.

fn parse_query(url: &str) -> Vec<(String, String)> {
    let Some((_, query)) = url.split_once('?') else {
        return Vec::new();
    };

    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .map(|(k, v)| (urldecode(k), urldecode(v)))
        .collect()
}

fn urldecode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;

    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(byte) => {
                        out.push(byte);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            other => {
                out.push(other);
                i += 1;
            }
        }
    }

    String::from_utf8_lossy(&out).into_owned()
}

fn urlencode(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (b as char).to_string()
            }
            b' ' => "%20".to_string(),
            other => format!("%{other:02X}"),
        })
        .collect()
}

fn html_header() -> Header {
    Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
        .expect("static header is valid")
}

/// The page Spotify's redirect lands on. Shown in the user's browser, so the
/// copy is English like the rest of the interface.
fn page(title: &str, message: &str) -> String {
    format!(
        "<!doctype html><meta charset=\"utf-8\"><title>{title}</title>\
         <body style=\"background:#211913;color:#f6efe4;font:15px/1.6 system-ui,sans-serif;\
         display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0\">\
         <h1 style=\"font-size:18px;letter-spacing:.02em\">{title}</h1>\
         <p style=\"color:#a9977e;max-width:40ch;text-align:center\">{message}</p></body>"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_callback_query() {
        let params = parse_query("/callback?code=abc123&state=xyz");
        assert_eq!(params.len(), 2);
        assert_eq!(params[0], ("code".into(), "abc123".into()));
        assert_eq!(params[1], ("state".into(), "xyz".into()));
    }

    #[test]
    fn decodes_percent_escapes_in_the_code() {
        let params = parse_query("/callback?code=a%2Fb%2Bc&state=s");
        assert_eq!(params[0].1, "a/b+c");
    }

    #[test]
    fn rejects_a_callback_whose_state_does_not_match() {
        let params = parse_query("/callback?code=abc&state=wrong");
        let err = interpret_callback(&params, "right").expect_err("must reject");
        assert_eq!(err.code, "state_mismatch");
    }

    #[test]
    fn reports_a_denied_authorisation() {
        let params = parse_query("/callback?error=access_denied&state=right");
        let err = interpret_callback(&params, "right").expect_err("must reject");
        assert_eq!(err.code, "access_denied");
    }

    #[test]
    fn returns_the_code_when_state_matches() {
        let params = parse_query("/callback?code=abc123&state=right");
        assert_eq!(interpret_callback(&params, "right").unwrap(), "abc123");
    }

    #[test]
    fn authorize_url_carries_pkce_and_the_exact_redirect_uri() {
        let url = build_authorize_url("cid", "chal", "st");
        assert!(url.starts_with(AUTHORIZE_ENDPOINT));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("code_challenge=chal"));
        assert!(url.contains("state=st"));
        assert!(url.contains("response_type=code"));
        // The redirect URI must survive encoding intact, since Spotify matches
        // it character for character against the dashboard entry.
        assert!(url.contains(&urlencode(REDIRECT_URI)));
    }

    #[test]
    fn requests_only_the_scopes_playback_needs() {
        let scopes: Vec<&str> = SCOPES.split(' ').collect();
        assert!(scopes.contains(&"streaming"));
        // Nothing here should be reaching for the user's library or playlists.
        assert!(!scopes.iter().any(|s| s.contains("playlist")));
        assert!(!scopes.iter().any(|s| s.contains("library")));
    }
}
