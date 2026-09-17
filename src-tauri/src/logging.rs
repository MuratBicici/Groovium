//! A file somebody can read after something has gone wrong.
//!
//! A release build has no console. `windows_subsystem = "windows"` keeps the
//! black window from opening beside the widget, and it also means every
//! `eprintln!` and every `console.warn` in the webview goes nowhere at all. The
//! station swallowed a refusal into an empty list and wrote a line about it to
//! a console that did not exist, and the only way to learn what had happened
//! was to guess.
//!
//! So there is a file. Not in the window — there is nothing to look at and
//! nothing to press — but in the app's own log folder, which on Windows is
//! `%LOCALAPPDATA%\com.groovium.desktop\logs`. That is the folder the WebView
//! already keeps its data in, and the one the uninstaller's "delete app data"
//! option removes. Not the install folder: that belongs to the installer, and
//! every update runs the installer over it.
//!
//! What goes in is what explains a fault: refusals and their status codes, the
//! stall watchdog's decisions, panics. What does not go in is anything that
//! would matter if the file were pasted into an issue — tokens, the Client ID,
//! the Last.fm key, what somebody searched for. The frontend redacts before it
//! writes (`src/platform/log.ts`), and nothing on this side logs a URL.

use log::{Level, LevelFilter, Metadata};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy, WEBVIEW_TARGET};

/// Rotate at about a megabyte.
///
/// A month of ordinary listening is a few hundred lines. A megabyte is room for
/// a bad afternoon without the file ever becoming something that is awkward to
/// open or attach.
const MAX_FILE_BYTES: u128 = 1_000_000;

/// Whether a line belongs in the file.
///
/// This app's own lines at whatever level they were written, and everybody
/// else's only when something is wrong.
///
/// It was the other way round: every library let through, and the noisy ones
/// named and turned down one at a time. That is a list that is never finished.
/// The first run of a development build wrote the updater's entire release
/// manifest into the file twice — every paragraph of the release notes — and
/// four lines from the credential store every time a token was read, from two
/// crates nobody had thought to put on the list. A file somebody has to scroll
/// past that to read is a file nobody reads.
///
/// So it is a list of who may speak rather than who may not, and it has two
/// entries. This crate, by module path. And the webview, which the log plugin
/// files under `webview` or `webview:<source location>` — one colon, so a
/// module-style prefix match would miss it, which is why this is a filter on
/// the target rather than the builder's `level_for`.
pub fn worth_writing(metadata: &Metadata) -> bool {
    let target = metadata.target();
    let ours = target == env!("CARGO_CRATE_NAME")
        || target.starts_with(concat!(env!("CARGO_CRATE_NAME"), "::"))
        || target
            .strip_prefix(WEBVIEW_TARGET)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with(':'));
    ours || metadata.level() <= Level::Warn
}

pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let mut targets = vec![Target::new(TargetKind::LogDir {
        file_name: Some("groovium".into()),
    })
    .filter(worth_writing)];
    // The console as well while developing, where there is one.
    if cfg!(debug_assertions) {
        targets.push(Target::new(TargetKind::Stdout).filter(worth_writing));
    }

    tauri_plugin_log::Builder::new()
        .clear_targets()
        .targets(targets)
        .level(if cfg!(debug_assertions) {
            LevelFilter::Debug
        } else {
            LevelFilter::Info
        })
        .max_file_size(MAX_FILE_BYTES)
        // The current file and the one before it. A fault that filled a file is
        // most likely to be explained by the start of it.
        .rotation_strategy(RotationStrategy::KeepSome(1))
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .build()
}

/// Send panics to the file too.
///
/// The default hook prints to stderr, which a release build does not have, so a
/// panic in a command handler used to leave no trace anywhere. The default hook
/// still runs afterwards, so a debug build's console is unchanged.
pub fn record_panics() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("panic: {info}");
        previous(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(target: &str, level: Level) -> bool {
        worth_writing(&Metadata::builder().target(target).level(level).build())
    }

    #[test]
    fn keeps_this_apps_own_lines_at_every_level() {
        assert!(line("groovium", Level::Info));
        assert!(line("groovium::library", Level::Debug));
    }

    #[test]
    fn keeps_the_webviews_lines_however_the_plugin_names_them() {
        // With a source location and without one. The location form has a
        // single colon, which is the case a module-path match would drop.
        assert!(line("webview", Level::Info));
        assert!(line("webview:http://tauri.localhost/assets/index.js:12:5", Level::Info));
    }

    #[test]
    fn keeps_a_librarys_warnings_and_errors() {
        assert!(line("tauri_plugin_updater::updater", Level::Warn));
        assert!(line("keyring_core", Level::Error));
    }

    #[test]
    fn drops_a_librarys_chatter() {
        // The two that filled the first development log: the updater quoting
        // its whole manifest, and the credential store narrating every read.
        assert!(!line("tauri_plugin_updater::updater", Level::Debug));
        assert!(!line("keyring_core", Level::Debug));
        assert!(!line("reqwest::connect", Level::Info));
    }

    #[test]
    fn is_not_fooled_by_a_crate_whose_name_merely_starts_the_same() {
        assert!(!line("grooviumish", Level::Debug));
        assert!(!line("webviewer", Level::Info));
    }
}
