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

use log::LevelFilter;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

/// Rotate at about a megabyte.
///
/// A month of ordinary listening is a few hundred lines. A megabyte is room for
/// a bad afternoon without the file ever becoming something that is awkward to
/// open or attach.
const MAX_FILE_BYTES: u128 = 1_000_000;

pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let mut targets = vec![Target::new(TargetKind::LogDir {
        file_name: Some("groovium".into()),
    })];
    // The console as well while developing, where there is one.
    if cfg!(debug_assertions) {
        targets.push(Target::new(TargetKind::Stdout));
    }

    tauri_plugin_log::Builder::new()
        .clear_targets()
        .targets(targets)
        .level(if cfg!(debug_assertions) {
            LevelFilter::Debug
        } else {
            LevelFilter::Info
        })
        // The libraries underneath talk a great deal at info, and some of what
        // they say is a URL with a key in its query string. Only their
        // warnings are worth a line.
        .level_for("reqwest", LevelFilter::Warn)
        .level_for("hyper", LevelFilter::Warn)
        .level_for("hyper_util", LevelFilter::Warn)
        .level_for("tao", LevelFilter::Warn)
        .level_for("wry", LevelFilter::Warn)
        .level_for("tiny_http", LevelFilter::Warn)
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
