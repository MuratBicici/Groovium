//! Choosing an image for a playlist's cover.
//!
//! The file dialog runs here rather than in the webview, as every file dialog in
//! this app does: the webview has no dialog permission at all. What comes back is
//! the image as a `data:` URL, which the crop screen can draw without any file
//! access of its own and which the page's `img-src` already allows.
//!
//! Nothing is resized or re-encoded here. Spotify wants a JPEG of at most 256 KB,
//! and getting there means cropping first — which is the webview's job, because
//! that is where somebody decides what the square is.
//!
//! Failures come back as codes, not sentences, so the window can say them in the
//! language it is in.

use std::fs;
use std::path::Path;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// The formats a webview can decode and a canvas can draw.
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp"];

/// The largest picture read in.
///
/// A phone photo is a few megabytes. Past twenty is not a cover somebody chose,
/// and it would be held in memory twice over — the file and its base64 — before
/// being shrunk to a quarter of a megabyte anyway.
pub const COVER_SOURCE_MAX_BYTES: u64 = 20 * 1024 * 1024;

/// The MIME type for a file this accepts, by its extension.
pub fn mime_for(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

/// Ask for an image. `Ok(None)` when the dialog was closed without one.
///
/// Errors are `unsupported` for a file of another kind, `too_large` past the
/// limit, and `unreadable` when the file could not be read.
#[tauri::command(async)]
pub fn spotify_pick_cover_image(app: AppHandle) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Choose a cover")
        .add_filter("Images", IMAGE_EXTENSIONS)
        .blocking_pick_file();
    let Some(file) = picked else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|_| "unreadable".to_string())?;

    let mime = mime_for(&path).ok_or_else(|| "unsupported".to_string())?;
    let size = fs::metadata(&path).map_err(|_| "unreadable".to_string())?.len();
    if size > COVER_SOURCE_MAX_BYTES {
        return Err("too_large".into());
    }
    let bytes = fs::read(&path).map_err(|e| {
        log::warn!("could not read a cover image: {e}");
        "unreadable".to_string()
    })?;
    Ok(Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn knows_the_formats_a_canvas_can_draw_whatever_their_case() {
        assert_eq!(mime_for(&PathBuf::from("a.JPG")), Some("image/jpeg"));
        assert_eq!(mime_for(&PathBuf::from("a.jpeg")), Some("image/jpeg"));
        assert_eq!(mime_for(&PathBuf::from("a.png")), Some("image/png"));
        assert_eq!(mime_for(&PathBuf::from("a.WebP")), Some("image/webp"));
    }

    #[test]
    fn refuses_anything_else() {
        assert_eq!(mime_for(&PathBuf::from("a.gif")), None);
        assert_eq!(mime_for(&PathBuf::from("a.heic")), None);
        assert_eq!(mime_for(&PathBuf::from("no-extension")), None);
    }
}
