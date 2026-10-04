//! Reporting a problem, with the log.
//!
//! The log never leaves this computer on its own: there is no telemetry and
//! there is not going to be. What these do is make sending it easy for someone
//! who wants to — the folder it is in, opened, and a new GitHub issue with the
//! version and the system already filled in and a line asking for the file.
//! What goes with the issue is what they drag into it, and nothing else.

use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// Where problems are reported.
const NEW_ISSUE_URL: &str = "https://github.com/MuratBicici/Groovium/issues/new";

/// Open the folder the log is written to.
#[tauri::command(async)]
pub fn logs_open_folder(app: AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Could not find the log folder: {e}"))?;
    // Made if it is not there yet, so the folder opens rather than an error.
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not open the log folder: {e}"))?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("Could not open the log folder: {e}"))
}

/// Open a new GitHub issue with the version and the system filled in.
#[tauri::command(async)]
pub fn report_problem(app: AppHandle) -> Result<(), String> {
    let version = app.package_info().version.to_string();
    let url = issue_url(&version, std::env::consts::OS, std::env::consts::ARCH)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("Could not open the browser: {e}"))
}

/// The address of a new issue, its body ready to be written into.
fn issue_url(version: &str, os: &str, arch: &str) -> Result<String, String> {
    let body = format!(
        "**What happened**\n\n\n\
         **What you expected**\n\n\n\
         **When** (roughly what time, so it can be found in the log)\n\n\n\
         ---\n\
         Groovium {version} · {os} {arch}\n\n\
         Please attach `groovium.log` — Settings → Report a problem → Open the log folder. \
         It stays on your computer unless you attach it here, and it never contains your \
         account keys."
    );
    reqwest::Url::parse_with_params(NEW_ISSUE_URL, &[("body", body.as_str())])
        .map(String::from)
        .map_err(|e| format!("Could not build the report: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_report_carries_the_version_and_the_system() {
        let url = issue_url("1.2.2", "windows", "x86_64").unwrap();
        assert!(url.starts_with(NEW_ISSUE_URL));
        let parsed = reqwest::Url::parse(&url).unwrap();
        let body: String = parsed
            .query_pairs()
            .find(|(k, _)| k == "body")
            .map(|(_, v)| v.into_owned())
            .unwrap();
        assert!(body.contains("Groovium 1.2.2 · windows x86_64"));
        assert!(body.contains("groovium.log"));
    }
}
