//! The buttons under Groovium's preview on the taskbar: like, previous,
//! play or pause, and next.
//!
//! Like the tray and the media keys (`media.rs`), they know nothing about
//! playback: a press is a command for the frontend, which already knows what
//! each one means. What they show — playing or paused, liked or not, and their
//! names in the app's language — is told to them by the frontend
//! (`taskbar_state`), which is where all of that is known.

use serde::Deserialize;
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;

use crate::media::{self, MediaCommand};

/// What the buttons show.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskbarState {
    pub playing: bool,
    pub has_track: bool,
    /// Whether the song is liked; `None` when it is not one that can be — a
    /// local file — and the heart is not shown.
    pub liked: Option<bool>,
    pub tips: Tips,
}

/// The buttons' names, in the app's language.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
pub struct Tips {
    pub like: String,
    pub unlike: String,
    pub previous: String,
    pub play: String,
    pub pause: String,
    pub next: String,
}

/// The button ids, which come back with a press.
const LIKE: u32 = 1;
const PREVIOUS: u32 = 2;
const PLAY_PAUSE: u32 = 3;
const NEXT: u32 = 4;

/// What a press of the button `id` asks for.
pub(crate) fn command_for(id: u32) -> Option<MediaCommand> {
    match id {
        LIKE => Some(MediaCommand::Like),
        PREVIOUS => Some(MediaCommand::Previous),
        PLAY_PAUSE => Some(MediaCommand::PlayPause),
        NEXT => Some(MediaCommand::Next),
        _ => None,
    }
}

static APP: OnceLock<AppHandle> = OnceLock::new();
static STATE: Mutex<Option<TaskbarState>> = Mutex::new(None);

fn current() -> TaskbarState {
    STATE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .unwrap_or_else(|| TaskbarState {
            tips: Tips {
                like: "Like".into(),
                unlike: "Unlike".into(),
                previous: "Previous".into(),
                play: "Play".into(),
                pause: "Pause".into(),
                next: "Next".into(),
            },
            ..TaskbarState::default()
        })
}

fn pressed(id: u32) {
    if let (Some(app), Some(command)) = (APP.get(), command_for(id)) {
        media::emit(app, command);
    }
}

/// Put the buttons under the main window's preview. Once, at startup.
pub fn attach(app: &AppHandle, window: &tauri::Window) {
    let _ = APP.set(app.clone());
    #[cfg(windows)]
    match window.hwnd() {
        Ok(hwnd) => imp::attach(windows::Win32::Foundation::HWND(hwnd.0)),
        Err(e) => log::warn!("[taskbar] no window to put buttons under: {e}"),
    }
    #[cfg(not(windows))]
    let _ = window;
}

/// What the buttons show now.
#[tauri::command]
pub fn taskbar_state(state: TaskbarState) {
    let changed = {
        let mut held = STATE.lock().unwrap_or_else(|e| e.into_inner());
        let changed = held.as_ref() != Some(&state);
        *held = Some(state);
        changed
    };
    #[cfg(windows)]
    if changed {
        imp::refresh();
    }
    #[cfg(not(windows))]
    let _ = changed;
}

#[cfg(windows)]
mod imp {
    use super::{current, pressed, TaskbarState, LIKE, NEXT, PLAY_PAUSE, PREVIOUS};
    use std::cell::RefCell;
    use std::sync::OnceLock;
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::Shell::{
        DefSubclassProc, ITaskbarList3, SetWindowSubclass, TaskbarList, THBF_DISABLED,
        THBF_ENABLED, THBF_HIDDEN, THBN_CLICKED, THB_FLAGS, THB_ICON, THB_TOOLTIP, THUMBBUTTON,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateIconFromResourceEx, DestroyIcon, RegisterWindowMessageW, HICON, LR_DEFAULTCOLOR,
        WM_COMMAND, WM_DPICHANGED,
    };

    const SUBCLASS_ID: usize = 0x6772_7476; // "grtv"

    /// The sizes the glyphs are drawn at: 16 px at 100 %, and each scale up to 200 %.
    const SIZES: [i32; 4] = [16, 20, 24, 32];

    macro_rules! glyphs {
        ($name:literal) => {
            [
                include_bytes!(concat!("../icons/taskbar/", $name, "-16.png")).as_slice(),
                include_bytes!(concat!("../icons/taskbar/", $name, "-20.png")).as_slice(),
                include_bytes!(concat!("../icons/taskbar/", $name, "-24.png")).as_slice(),
                include_bytes!(concat!("../icons/taskbar/", $name, "-32.png")).as_slice(),
            ]
        };
    }

    struct Icons {
        heart: HICON,
        heart_filled: HICON,
        previous: HICON,
        play: HICON,
        pause: HICON,
        next: HICON,
    }

    impl Icons {
        fn load(dpi: u32) -> Option<Icons> {
            let want = (16 * dpi.max(96) as i32 + 48) / 96;
            let at = SIZES
                .iter()
                .position(|&s| s >= want)
                .unwrap_or(SIZES.len() - 1);
            let size = SIZES[at];
            let icon = |set: [&[u8]; 4]| -> Option<HICON> {
                // A PNG is a valid icon image since Vista: no conversion needed.
                unsafe { CreateIconFromResourceEx(set[at], true, 0x0003_0000, size, size, LR_DEFAULTCOLOR) }
                    .ok()
            };
            Some(Icons {
                heart: icon(glyphs!("heart"))?,
                heart_filled: icon(glyphs!("heart-filled"))?,
                previous: icon(glyphs!("previous"))?,
                play: icon(glyphs!("play"))?,
                pause: icon(glyphs!("pause"))?,
                next: icon(glyphs!("next"))?,
            })
        }
    }

    impl Drop for Icons {
        fn drop(&mut self) {
            for icon in [self.heart, self.heart_filled, self.previous, self.play, self.pause, self.next] {
                let _ = unsafe { DestroyIcon(icon) };
            }
        }
    }

    struct Bar {
        hwnd: HWND,
        list: Option<ITaskbarList3>,
        icons: Option<Icons>,
        /// Whether the buttons are on the taskbar button that exists now.
        added: bool,
    }

    thread_local! {
        /// The main thread's: the taskbar is asked from the thread that owns the window.
        static BAR: RefCell<Option<Bar>> = const { RefCell::new(None) };
    }

    fn button_created() -> u32 {
        static ID: OnceLock<u32> = OnceLock::new();
        *ID.get_or_init(|| unsafe { RegisterWindowMessageW(w!("TaskbarButtonCreated")) })
    }

    pub fn attach(hwnd: HWND) {
        BAR.with(|bar| {
            *bar.borrow_mut() = Some(Bar {
                hwnd,
                list: None,
                icons: Icons::load(unsafe { GetDpiForWindow(hwnd) }),
                added: false,
            })
        });
        let _ = button_created();
        if !unsafe { SetWindowSubclass(hwnd, Some(listen), SUBCLASS_ID, 0) }.as_bool() {
            log::warn!("[taskbar] could not listen for presses on the preview's buttons");
            return;
        }
        // The taskbar button may already be there; if not, its arrival adds them.
        add();
    }

    /// The buttons on the taskbar, once per taskbar button: after Explorer
    /// restarts there is a new one, and they go on again.
    fn add() {
        let Some((hwnd, list)) = BAR.with(|bar| {
            let mut held = bar.borrow_mut();
            let bar = held.as_mut()?;
            if bar.list.is_none() {
                bar.list = match unsafe { CoCreateInstance::<_, ITaskbarList3>(&TaskbarList, None, CLSCTX_INPROC_SERVER) } {
                    Ok(list) => unsafe { list.HrInit() }.ok().map(|()| list),
                    Err(e) => {
                        log::warn!("[taskbar] no taskbar to talk to: {e}");
                        None
                    }
                };
            }
            Some((bar.hwnd, bar.list.clone()?))
        }) else {
            return;
        };
        let Some(buttons) = buttons(&current()) else { return };
        // Outside the borrow: a call to Explorer can bring a message here first.
        match unsafe { list.ThumbBarAddButtons(hwnd, &buttons) } {
            Ok(()) => {
                log::info!("[taskbar] buttons under the preview");
                BAR.with(|bar| {
                    if let Some(bar) = bar.borrow_mut().as_mut() {
                        bar.added = true;
                    }
                });
            }
            // Before the taskbar button exists; its arrival brings us back.
            Err(e) => log::debug!("[taskbar] buttons not added yet: {e}"),
        }
    }

    pub fn refresh() {
        let Some((hwnd, list, added)) = BAR.with(|bar| {
            let held = bar.borrow();
            let bar = held.as_ref()?;
            Some((bar.hwnd, bar.list.clone()?, bar.added))
        }) else {
            return;
        };
        if !added {
            add();
            return;
        }
        let Some(buttons) = buttons(&current()) else { return };
        if let Err(e) = unsafe { list.ThumbBarUpdateButtons(hwnd, &buttons) } {
            log::warn!("[taskbar] could not update the preview's buttons: {e}");
        }
    }

    fn buttons(state: &TaskbarState) -> Option<[THUMBBUTTON; 4]> {
        BAR.with(|bar| {
            let held = bar.borrow();
            let icons = held.as_ref()?.icons.as_ref()?;
            let tips = &state.tips;
            let on = if state.has_track { THBF_ENABLED } else { THBF_DISABLED };
            let heart = match state.liked {
                Some(true) => (icons.heart_filled, tips.unlike.as_str(), THBF_ENABLED),
                Some(false) => (icons.heart, tips.like.as_str(), THBF_ENABLED),
                None => (icons.heart, tips.like.as_str(), THBF_HIDDEN),
            };
            let play = if state.playing {
                (icons.pause, tips.pause.as_str())
            } else {
                (icons.play, tips.play.as_str())
            };
            Some([
                button(LIKE, heart.0, heart.1, heart.2),
                button(PREVIOUS, icons.previous, &tips.previous, on),
                button(PLAY_PAUSE, play.0, play.1, on),
                button(NEXT, icons.next, &tips.next, on),
            ])
        })
    }

    fn button(id: u32, icon: HICON, tip: &str, flags: windows::Win32::UI::Shell::THUMBBUTTONFLAGS) -> THUMBBUTTON {
        let mut sz_tip = [0u16; 260];
        for (slot, unit) in sz_tip.iter_mut().take(259).zip(tip.encode_utf16()) {
            *slot = unit;
        }
        THUMBBUTTON {
            dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
            iId: id,
            iBitmap: 0,
            hIcon: icon,
            szTip: sz_tip,
            dwFlags: flags,
        }
    }

    unsafe extern "system" fn listen(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        if msg == button_created() {
            BAR.with(|bar| {
                if let Some(bar) = bar.borrow_mut().as_mut() {
                    bar.added = false;
                }
            });
            add();
        } else if msg == WM_COMMAND && ((wparam.0 >> 16) & 0xffff) as u32 == THBN_CLICKED {
            pressed((wparam.0 & 0xffff) as u32);
            return LRESULT(0);
        } else if msg == WM_DPICHANGED {
            // Sharp at the new scale: drawn again at the size that matches it.
            let dpi = (wparam.0 & 0xffff) as u32;
            BAR.with(|bar| {
                if let Some(bar) = bar.borrow_mut().as_mut() {
                    bar.icons = Icons::load(dpi);
                }
            });
            refresh();
        }
        unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_button_asks_for_its_own_command() {
        assert_eq!(command_for(LIKE), Some(MediaCommand::Like));
        assert_eq!(command_for(PREVIOUS), Some(MediaCommand::Previous));
        assert_eq!(command_for(PLAY_PAUSE), Some(MediaCommand::PlayPause));
        assert_eq!(command_for(NEXT), Some(MediaCommand::Next));
        assert_eq!(command_for(0), None);
        assert_eq!(command_for(5), None);
    }

    #[test]
    fn reads_the_state_the_frontend_sends() {
        let state: TaskbarState = serde_json::from_str(
            r#"{"playing":true,"hasTrack":true,"liked":null,
                "tips":{"like":"Beğen","unlike":"Vazgeç","previous":"Önceki","play":"Oynat","pause":"Duraklat","next":"Sonraki"}}"#,
        )
        .expect("parses");
        assert!(state.playing && state.has_track);
        assert_eq!(state.liked, None);
        assert_eq!(state.tips.pause, "Duraklat");
    }
}
