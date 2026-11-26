//! Groovium as Windows' media player: the System Media Transport Controls.
//!
//! What Windows shows for "the music that is playing" — the box over the
//! volume keys, the lock screen, the media section of the quick settings —
//! comes from here: the song's name, artist, album and cover, whether it is
//! playing, how long it is and how far it has got. Its buttons (play, pause,
//! previous, next) and a move on its timeline come back as the same commands
//! the tray and the media keys send (`media.rs`), plus a seek.
//!
//! Like those, this knows nothing about playback. The frontend says what is
//! playing (`smtc_state`, `smtc_cover`), which is where all of that is known.

use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

use crate::media::{self, MediaCommand};

/// Event a move on Windows' timeline arrives as, in milliseconds. Must match
/// `SEEK_EVENT` in `src/platform/mediaControls.ts`.
pub const SEEK_EVENT: &str = "media:seek";

/// What is playing, as the frontend tells it.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SmtcState {
    /// `playing`, `paused`, `loading` or `none`.
    pub status: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: u64,
    pub position_ms: u64,
}

static APP: OnceLock<AppHandle> = OnceLock::new();
/// Whether something is playing, so that Play and Pause from Windows can each
/// mean only themselves even though the app has one button for both.
static PLAYING: AtomicBool = AtomicBool::new(false);

/// What Windows' Play or Pause should do, given whether something is playing.
pub(crate) fn toggle_for(pressed_play: bool, playing: bool) -> Option<MediaCommand> {
    (pressed_play != playing).then_some(MediaCommand::PlayPause)
}

fn command(command: MediaCommand) {
    if let Some(app) = APP.get() {
        media::emit(app, command);
    }
}

fn seek_to(ms: u64) {
    if let Some(app) = APP.get() {
        if let Err(e) = app.emit(SEEK_EVENT, ms) {
            log::warn!("[smtc] could not pass on a move on the timeline: {e}");
        }
    }
}

/// Become the window's media session. Once, at startup.
pub fn attach(app: &AppHandle, window: &tauri::Window) {
    let _ = APP.set(app.clone());
    #[cfg(windows)]
    match window.hwnd() {
        Ok(hwnd) => {
            if let Err(e) = imp::attach(windows::Win32::Foundation::HWND(hwnd.0)) {
                log::warn!("[smtc] Windows' media controls are not ours: {e}");
            }
        }
        Err(e) => log::warn!("[smtc] no window for Windows' media controls: {e}"),
    }
    #[cfg(not(windows))]
    let _ = window;
}

/// What is playing now.
#[tauri::command]
pub fn smtc_state(state: SmtcState) {
    PLAYING.store(
        state.status == "playing" || state.status == "loading",
        Ordering::SeqCst,
    );
    #[cfg(windows)]
    if let Err(e) = imp::show(&state) {
        log::warn!("[smtc] could not tell Windows what is playing: {e}");
    }
    #[cfg(not(windows))]
    let _ = state;
}

/// The song's cover, as image bytes (JPEG or PNG) in the request's body; an
/// empty body for none.
#[tauri::command]
pub fn smtc_cover(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("the cover comes as raw bytes".into());
    };
    #[cfg(windows)]
    {
        // Off the window's thread: writing a stream is asynchronous in WinRT,
        // and waiting for it there would hold up the window.
        let bytes = bytes.clone();
        std::thread::spawn(move || {
            if let Err(e) = imp::cover(&bytes) {
                log::warn!("[smtc] could not give Windows the cover: {e}");
            }
        });
    }
    #[cfg(not(windows))]
    let _ = bytes;
    Ok(())
}

#[cfg(windows)]
mod imp {
    use super::{command, seek_to, toggle_for, SmtcState, PLAYING};
    use crate::media::MediaCommand;
    use std::sync::atomic::Ordering;
    use std::sync::OnceLock;
    use windows::core::{Ref, HSTRING};
    use windows::Foundation::{TimeSpan, TypedEventHandler};
    use windows::Media::{
        MediaPlaybackStatus, MediaPlaybackType, PlaybackPositionChangeRequestedEventArgs,
        SystemMediaTransportControls, SystemMediaTransportControlsButton,
        SystemMediaTransportControlsButtonPressedEventArgs,
        SystemMediaTransportControlsTimelineProperties,
    };
    use windows::Storage::Streams::{
        DataWriter, InMemoryRandomAccessStream, RandomAccessStreamReference,
    };
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;

    static CONTROLS: OnceLock<SystemMediaTransportControls> = OnceLock::new();

    /// 100 ns ticks, WinRT's unit of time.
    fn ticks(ms: u64) -> TimeSpan {
        TimeSpan {
            Duration: (ms as i64).saturating_mul(10_000),
        }
    }

    pub fn attach(hwnd: HWND) -> windows::core::Result<()> {
        let interop = windows::core::factory::<
            SystemMediaTransportControls,
            ISystemMediaTransportControlsInterop,
        >()?;
        let controls: SystemMediaTransportControls = unsafe { interop.GetForWindow(hwnd) }?;
        controls.SetIsEnabled(true)?;
        controls.SetIsPlayEnabled(true)?;
        controls.SetIsPauseEnabled(true)?;
        controls.SetIsNextEnabled(true)?;
        controls.SetIsPreviousEnabled(true)?;
        controls.SetPlaybackStatus(MediaPlaybackStatus::Closed)?;
        controls.ButtonPressed(&TypedEventHandler::new(
            |_: Ref<SystemMediaTransportControls>,
             args: Ref<SystemMediaTransportControlsButtonPressedEventArgs>| {
                let Some(args) = args.as_ref() else {
                    return Ok(());
                };
                let playing = PLAYING.load(Ordering::SeqCst);
                let pressed = args.Button()?;
                let wanted = match pressed {
                    SystemMediaTransportControlsButton::Play => toggle_for(true, playing),
                    SystemMediaTransportControlsButton::Pause => toggle_for(false, playing),
                    SystemMediaTransportControlsButton::Next => Some(MediaCommand::Next),
                    SystemMediaTransportControlsButton::Previous => Some(MediaCommand::Previous),
                    _ => None,
                };
                if let Some(wanted) = wanted {
                    command(wanted);
                }
                Ok(())
            },
        ))?;
        controls.PlaybackPositionChangeRequested(&TypedEventHandler::new(
            |_: Ref<SystemMediaTransportControls>,
             args: Ref<PlaybackPositionChangeRequestedEventArgs>| {
                if let Some(args) = args.as_ref() {
                    let at = args.RequestedPlaybackPosition()?.Duration.max(0) / 10_000;
                    seek_to(at as u64);
                }
                Ok(())
            },
        ))?;
        let _ = CONTROLS.set(controls);
        log::info!("[smtc] Groovium is Windows' media session");
        Ok(())
    }

    pub fn show(state: &SmtcState) -> windows::core::Result<()> {
        let Some(controls) = CONTROLS.get() else {
            return Ok(());
        };
        let updater = controls.DisplayUpdater()?;
        if state.status == "none" {
            controls.SetPlaybackStatus(MediaPlaybackStatus::Closed)?;
            updater.ClearAll()?;
            return updater.Update();
        }
        controls.SetPlaybackStatus(match state.status.as_str() {
            "playing" => MediaPlaybackStatus::Playing,
            "loading" => MediaPlaybackStatus::Changing,
            _ => MediaPlaybackStatus::Paused,
        })?;
        updater.SetType(MediaPlaybackType::Music)?;
        let music = updater.MusicProperties()?;
        music.SetTitle(&HSTRING::from(&state.title))?;
        music.SetArtist(&HSTRING::from(&state.artist))?;
        music.SetAlbumTitle(&HSTRING::from(&state.album))?;
        updater.Update()?;

        let timeline = SystemMediaTransportControlsTimelineProperties::new()?;
        timeline.SetStartTime(ticks(0))?;
        timeline.SetMinSeekTime(ticks(0))?;
        timeline.SetEndTime(ticks(state.duration_ms))?;
        timeline.SetMaxSeekTime(ticks(state.duration_ms))?;
        timeline.SetPosition(ticks(state.position_ms.min(state.duration_ms)))?;
        controls.UpdateTimelineProperties(&timeline)
    }

    pub fn cover(bytes: &[u8]) -> windows::core::Result<()> {
        let Some(controls) = CONTROLS.get() else {
            return Ok(());
        };
        let updater = controls.DisplayUpdater()?;
        if bytes.is_empty() {
            updater.SetThumbnail(None)?;
            return updater.Update();
        }
        let stream = InMemoryRandomAccessStream::new()?;
        let writer = DataWriter::CreateDataWriter(&stream)?;
        writer.WriteBytes(bytes)?;
        writer.StoreAsync()?.get()?;
        writer.FlushAsync()?.get()?;
        writer.DetachStream()?;
        stream.Seek(0)?;
        updater.SetThumbnail(&RandomAccessStreamReference::CreateFromStream(&stream)?)?;
        updater.Update()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn play_and_pause_each_mean_only_themselves() {
        assert_eq!(toggle_for(true, false), Some(MediaCommand::PlayPause));
        assert_eq!(toggle_for(true, true), None);
        assert_eq!(toggle_for(false, true), Some(MediaCommand::PlayPause));
        assert_eq!(toggle_for(false, false), None);
    }

    #[test]
    fn reads_the_state_the_frontend_sends() {
        let state: SmtcState = serde_json::from_str(
            r#"{"status":"playing","title":"Night Ferry","artist":"Sable Harbour","album":"Blue Hour","durationMs":214000,"positionMs":61000}"#,
        )
        .expect("parses");
        assert_eq!(state.status, "playing");
        assert_eq!(state.duration_ms, 214_000);
    }
}
