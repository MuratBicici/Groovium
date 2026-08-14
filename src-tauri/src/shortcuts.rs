//! Global media-key shortcuts.
//!
//! Registered here rather than from JavaScript so the webview needs no
//! `global-shortcut` permission at all.
//!
//! Registration is expected to fail sometimes: media keys are first-come,
//! first-served, and Spotify or a browser may already hold them. A failure is
//! logged and the remaining keys are still attempted — losing one key should not
//! cost the others, and it must never prevent startup.

use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

use crate::media::{self, MediaCommand};

/// Which key drives which command.
const MEDIA_KEYS: &[(Code, MediaCommand)] = &[
    (Code::MediaPlayPause, MediaCommand::PlayPause),
    (Code::MediaTrackNext, MediaCommand::Next),
    (Code::MediaTrackPrevious, MediaCommand::Previous),
];

pub fn register(app: &tauri::AppHandle) {
    for &(code, command) in MEDIA_KEYS {
        // No modifiers: these are the dedicated media keys, not a chord.
        let shortcut = Shortcut::new(None, code);

        let result = app.global_shortcut().on_shortcut(shortcut, move |app, _, event| {
            // Each key press reports both Pressed and Released; acting on both
            // would toggle playback twice per tap.
            if event.state == ShortcutState::Pressed {
                media::emit(app, command);
            }
        });

        if let Err(e) = result {
            eprintln!(
                "[shortcuts] could not register {code:?} ({}): {e} — another application probably holds this key",
                command.as_str()
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_transport_command_has_a_key() {
        let commands: Vec<MediaCommand> = MEDIA_KEYS.iter().map(|&(_, c)| c).collect();
        assert!(commands.contains(&MediaCommand::PlayPause));
        assert!(commands.contains(&MediaCommand::Next));
        assert!(commands.contains(&MediaCommand::Previous));
        assert_eq!(commands.len(), 3, "no duplicate or stray bindings");
    }

    #[test]
    fn no_key_is_bound_twice() {
        // A key bound twice would register once and silently drop the other.
        let mut codes: Vec<String> = MEDIA_KEYS.iter().map(|&(c, _)| format!("{c:?}")).collect();
        codes.sort();
        let before = codes.len();
        codes.dedup();
        assert_eq!(codes.len(), before);
    }
}
