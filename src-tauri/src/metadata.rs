//! Audio tag reading.
//!
//! Everything the frontend knows about a local track originates here. Reading
//! tags on this side means one round trip per file at pick time, and it means
//! the webview never needs a second look at the file — the asset protocol stays
//! reserved for the audio stream itself.
//!
//! Duration comes from the file header rather than from loading the file into an
//! `<audio>` element and waiting for `loadedmetadata`. That old approach was slow
//! and, worse, failed silently to `0:00`, which looked identical to a file the
//! app simply could not read.

use std::path::Path;

use base64::Engine;
use lofty::prelude::*;
use lofty::probe::read_from_path;
use serde::{Deserialize, Serialize};

/// Embedded artwork larger than this is skipped rather than pushed through IPC.
/// Real covers are well under it; anything bigger is usually a scan of the
/// booklet and not worth the transfer for a 168px platter label.
const MAX_COVER_ART_BYTES: usize = 8 * 1024 * 1024;

/// Round-trips through the session file, so it deserializes as well.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScannedTrack {
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: u64,
    /// Whether artwork is embedded. The bytes are fetched separately, only for
    /// the track actually being played — see `read_picture`.
    pub has_cover_art: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverArt {
    pub mime_type: String,
    /// Base64 payload, ready to drop into a `data:` URL.
    pub base64: String,
}

/// Read a track's tags, falling back to the filename when they are missing.
///
/// Never fails on a readable file: an untagged or unparseable file still yields
/// a usable entry rather than dropping out of the library.
pub fn read_track(path: &Path) -> ScannedTrack {
    read_track_named(path, path)
}

/// Read tags from one file but derive the filename fallback from another.
///
/// The library stores its copies under a generated id, so reading tags from the
/// copy is right — the bytes are guaranteed to be there — while naming an
/// untagged track after it is not: the user would see a random string where the
/// song title should be. `name_source` is the path the user recognises.
pub fn read_track_named(path: &Path, name_source: &Path) -> ScannedTrack {
    let fallback = fallback_metadata(name_source);
    let path_string = path.to_string_lossy().into_owned();

    let Ok(tagged) = read_from_path(path) else {
        return ScannedTrack {
            path: path_string,
            title: fallback.title,
            artist: fallback.artist,
            album: fallback.album,
            duration_ms: 0,
            has_cover_art: false,
        };
    };

    let duration_ms = tagged.properties().duration().as_millis() as u64;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());

    let (title, artist, album, has_cover_art) = match tag {
        Some(tag) => (
            non_empty(tag.title().as_deref()).unwrap_or(fallback.title),
            non_empty(tag.artist().as_deref()).unwrap_or(fallback.artist),
            non_empty(tag.album().as_deref()).unwrap_or(fallback.album),
            tag.picture_count() > 0,
        ),
        None => (fallback.title, fallback.artist, fallback.album, false),
    };

    ScannedTrack {
        path: path_string,
        title,
        artist,
        album,
        duration_ms,
        has_cover_art,
    }
}

/// Extract embedded artwork, if any is present and small enough to send.
pub fn read_picture(path: &Path) -> Option<CoverArt> {
    let tagged = read_from_path(path).ok()?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag())?;
    let picture = tag.pictures().first()?;

    let data = picture.data();
    if data.is_empty() || data.len() > MAX_COVER_ART_BYTES {
        return None;
    }

    Some(CoverArt {
        mime_type: picture
            .mime_type()
            .map(|mime| mime.to_string())
            .unwrap_or_else(|| "image/jpeg".to_owned()),
        base64: base64::engine::general_purpose::STANDARD.encode(data),
    })
}

struct FallbackMetadata {
    title: String,
    artist: String,
    album: String,
}

/// Derive something presentable from the filename.
///
/// Mirrors the browser-side fallback in `LocalAudioProvider`, so an untagged
/// file looks the same whether it arrived through Rust or through the browser
/// file input.
fn fallback_metadata(path: &Path) -> FallbackMetadata {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());

    // "Artist - Title" is the one convention common enough to be worth honoring.
    for separator in [" - ", " – ", " — "] {
        if let Some((artist, title)) = stem.split_once(separator) {
            let artist = artist.trim();
            let title = title.trim();
            if !artist.is_empty() && !title.is_empty() {
                return FallbackMetadata {
                    title: title.to_owned(),
                    artist: artist.to_owned(),
                    album: "Local Files".to_owned(),
                };
            }
        }
    }

    FallbackMetadata {
        title: stem,
        artist: "Unknown Artist".to_owned(),
        album: "Local Files".to_owned(),
    }
}

/// Treat whitespace-only tag values as absent — plenty of files carry them.
fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn splits_artist_and_title_from_filename() {
        let meta = fallback_metadata(&PathBuf::from(r"C:\Music\Kraftwerk - Autobahn.mp3"));
        assert_eq!(meta.artist, "Kraftwerk");
        assert_eq!(meta.title, "Autobahn");
    }

    #[test]
    fn honors_en_and_em_dash_separators() {
        for name in ["Boards of Canada – Roygbiv.flac", "Aphex Twin — Xtal.flac"] {
            let meta = fallback_metadata(&PathBuf::from(name));
            assert_ne!(meta.artist, "Unknown Artist", "should split {name:?}");
        }
    }

    #[test]
    fn falls_back_to_bare_filename() {
        let meta = fallback_metadata(&PathBuf::from("track01.mp3"));
        assert_eq!(meta.title, "track01");
        assert_eq!(meta.artist, "Unknown Artist");
    }

    #[test]
    fn does_not_split_on_a_dangling_separator() {
        let meta = fallback_metadata(&PathBuf::from("Untitled - .mp3"));
        assert_eq!(meta.title, "Untitled - ");
        assert_eq!(meta.artist, "Unknown Artist");
    }

    #[test]
    fn unreadable_file_still_yields_a_track() {
        let track = read_track(&PathBuf::from("does-not-exist.mp3"));
        assert_eq!(track.title, "does-not-exist");
        assert_eq!(track.duration_ms, 0);
        assert!(!track.has_cover_art);
    }

    #[test]
    fn an_untagged_file_is_named_after_the_source_not_the_stored_copy() {
        // Regression: the library stores copies as `<random-id>.mp3`, so reading
        // the fallback from the stored path showed a random string as the title
        // and wiped artist and album along with it.
        let stored = PathBuf::from(r"C:\AppData\Groovium\library\aB3xK9zQ.mp3");
        let source = PathBuf::from(r"C:\Music\Kraftwerk - Autobahn.mp3");

        let track = read_track_named(&stored, &source);
        assert_eq!(track.title, "Autobahn");
        assert_eq!(track.artist, "Kraftwerk");

        // What the bug produced, for contrast.
        let wrong = read_track_named(&stored, &stored);
        assert_eq!(wrong.title, "aB3xK9zQ");
    }

    #[test]
    fn blank_tag_values_count_as_missing() {
        assert_eq!(non_empty(Some("   ")), None);
        assert_eq!(non_empty(Some(" Kraftwerk ")), Some("Kraftwerk".to_owned()));
    }
}
