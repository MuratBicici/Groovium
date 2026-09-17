//! What the drawer last read from Spotify, kept between launches.
//!
//! The shelf of playlists and the records inside the crates somebody has
//! opened or played. Without it every launch started from nothing: the drawer
//! opened on a spinner, and a playlist played yesterday was read again in full
//! before it could be played today.
//!
//! This side does not understand the contents. The webview owns the shape —
//! it is Spotify's data, mapped by the webview, and checked on the way back in
//! by `src/core/spotify/cache.ts` — so here it is a string that goes to a file
//! and comes back, with a ceiling on its size and a write that cannot leave a
//! half-written file behind.
//!
//! In the local app data folder rather than the roaming one beside settings: a
//! cache is not something to carry to another machine, and it is the folder the
//! uninstaller's "delete app data" option empties.

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

const CACHE_FILE: &str = "spotify-cache.json";

/// The most the file may hold.
///
/// Twelve crates of three hundred records is about a megabyte and a half.
/// Several times that is room to spare; anything past it is not a cache that
/// grew but something that went wrong, and is refused rather than written.
const MAX_BYTES: usize = 8 * 1024 * 1024;

fn cache_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|dir| dir.join(CACHE_FILE))
}

/// Whether contents of this length may be written or trusted when read.
pub fn fits(len: usize) -> bool {
    len <= MAX_BYTES
}

/// The file, or nothing — missing, unreadable and oversized are all nothing.
///
/// Never an error. A cache that cannot be read is a cache that is empty, and
/// the drawer asks Spotify as it always did.
#[tauri::command(async)]
pub fn spotify_cache_read(app: AppHandle) -> Option<String> {
    let path = cache_path(&app)?;
    let contents = fs::read_to_string(&path).ok()?;
    if !fits(contents.len()) {
        log::warn!("ignoring an oversized Spotify cache ({} bytes)", contents.len());
        return None;
    }
    Some(contents)
}

#[tauri::command(async)]
pub fn spotify_cache_write(app: AppHandle, contents: String) -> Result<(), String> {
    if !fits(contents.len()) {
        return Err(format!("Spotify cache too large to write ({} bytes).", contents.len()));
    }
    let path = cache_path(&app).ok_or_else(|| "No local app data directory available.".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
    }
    // Written beside and swapped in, so a crash mid-write leaves the old file
    // rather than half of a new one.
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, contents).map_err(|e| format!("Could not write the Spotify cache: {e}"))?;
    fs::rename(&temp, &path).map_err(|e| format!("Could not replace the Spotify cache: {e}"))?;
    Ok(())
}

/// Delete it. Signing out, or a different account signing in.
#[tauri::command(async)]
pub fn spotify_cache_clear(app: AppHandle) -> Result<(), String> {
    let Some(path) = cache_path(&app) else {
        return Ok(());
    };
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not delete the Spotify cache: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cache_of_a_normal_size_fits() {
        assert!(fits(0));
        assert!(fits(1_500_000));
        assert!(fits(MAX_BYTES));
    }

    #[test]
    fn a_cache_past_the_ceiling_does_not() {
        assert!(!fits(MAX_BYTES + 1));
    }
}
