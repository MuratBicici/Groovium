//! Playback commands originating outside the webview.
//!
//! The tray menu and the global media keys both live on this side, because
//! registering either from JavaScript would mean widening the webview's
//! permissions for something the OS layer should own — the same reasoning that
//! keeps the file picker in `files.rs`.
//!
//! Neither knows anything about playback. They emit a command, the frontend
//! listens and calls the store actions that already exist
//! (`src/platform/commandBridge.ts`). No playback logic is duplicated here.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Event name the frontend subscribes to. Must match `MEDIA_COMMAND_EVENT` in
/// `src/platform/commandBridge.ts`.
pub const MEDIA_COMMAND_EVENT: &str = "media:command";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaCommand {
    PlayPause,
    Next,
    Previous,
}

impl MediaCommand {
    /// Wire format. The frontend switches on these exact strings, so a typo here
    /// fails silently rather than loudly — hence the test below.
    pub fn as_str(self) -> &'static str {
        match self {
            MediaCommand::PlayPause => "playpause",
            MediaCommand::Next => "next",
            MediaCommand::Previous => "previous",
        }
    }
}

/// Send a command to the frontend. Best-effort: a missing webview is not fatal,
/// since the tray can be clicked while the window is hidden.
pub fn emit(app: &AppHandle, command: MediaCommand) {
    if let Err(e) = app.emit(MEDIA_COMMAND_EVENT, command) {
        eprintln!("[media] could not emit {}: {e}", command.as_str());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_format_matches_the_frontend_union() {
        // These three strings are the contract with commandBridge.ts.
        assert_eq!(MediaCommand::PlayPause.as_str(), "playpause");
        assert_eq!(MediaCommand::Next.as_str(), "next");
        assert_eq!(MediaCommand::Previous.as_str(), "previous");
    }

    #[test]
    fn serializes_to_the_same_strings_as_as_str() {
        // `as_str` is used for logging while serde does the actual emitting;
        // if the two ever disagree the logs would lie about what was sent.
        for command in [
            MediaCommand::PlayPause,
            MediaCommand::Next,
            MediaCommand::Previous,
        ] {
            let json = serde_json::to_string(&command).expect("serializes");
            assert_eq!(json, format!("\"{}\"", command.as_str()));
        }
    }

    #[test]
    fn event_name_is_stable() {
        assert_eq!(MEDIA_COMMAND_EVENT, "media:command");
    }
}
