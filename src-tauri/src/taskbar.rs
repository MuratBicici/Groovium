//! Groovium on the taskbar: the preview drawn for it, and the buttons under
//! that preview — like, previous, play or pause, and next.
//!
//! The preview is the song: its cover, its name and how far it has got, or a
//! plain square with a note when nothing is on. Left to Windows it would be a
//! picture of the window, which is mostly transparent, and on the left with the
//! drawer shut is a page reaching past its own edge. Windows asks for it at the
//! size it wants (`WM_DWMSENDICONICTHUMBNAIL`); this asks the frontend, which
//! draws it with everything it already knows (`taskbarPreview.ts`) and hands it
//! back (`taskbar_thumbnail`).
//!
//! Like the tray and the media keys (`media.rs`), they know nothing about
//! playback: a press is a command for the frontend, which already knows what
//! each one means. What they show — playing or paused, liked or not, and their
//! names in the app's language — is told to them by the frontend
//! (`taskbar_state`), which is where all of that is known.

use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

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

/// Event the frontend draws the preview on. Must match `PREVIEW_EVENT` in
/// `src/platform/taskbarPreview.ts`.
pub const PREVIEW_EVENT: &str = "taskbar:preview";

/// The size Windows asked for the preview at, in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct PreviewSize {
    pub width: u32,
    pub height: u32,
}

/// When Windows last asked for the preview, and at what size. A preview asked
/// for within this long is taken to be on screen still, and is drawn again when
/// something in it changes; one not asked for since is not drawn at all.
const PREVIEW_SHOWN_FOR: Duration = Duration::from_secs(3);
static LAST_ASK: Mutex<Option<(Instant, PreviewSize)>> = Mutex::new(None);

/// Windows wants the preview at `size`: the frontend draws it.
fn preview_asked(size: PreviewSize) {
    *LAST_ASK.lock().unwrap_or_else(|e| e.into_inner()) = Some((Instant::now(), size));
    if let Some(app) = APP.get() {
        if let Err(e) = app.emit(PREVIEW_EVENT, size) {
            log::warn!("[taskbar] could not ask for the preview: {e}");
        }
    }
}

/// Whether the preview is likely on screen: asked for a moment ago.
fn preview_shown(now: Instant) -> bool {
    LAST_ASK
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some_and(|(at, _)| now.duration_since(at) < PREVIEW_SHOWN_FOR)
}

/// The preview, drawn: RGBA, `width` by `height`, in the request's body.
#[tauri::command]
pub fn taskbar_thumbnail(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(rgba) = request.body() else {
        return Err("the preview comes as raw bytes".into());
    };
    let number = |name: &str| -> Result<u32, String> {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse().ok())
            .ok_or_else(|| format!("no {name} for the preview"))
    };
    let (width, height) = (number("width")?, number("height")?);
    if width == 0 || height == 0 || rgba.len() != (width * height * 4) as usize {
        return Err("the preview is not the size it says".into());
    }
    #[cfg(windows)]
    imp::show_preview(rgba, width, height);
    Ok(())
}

/// Something in the preview changed: if it is on screen, have Windows ask again.
#[tauri::command]
pub fn taskbar_preview_changed() {
    if !preview_shown(Instant::now()) {
        return;
    }
    #[cfg(windows)]
    imp::invalidate_preview();
}

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
    use std::sync::atomic::{AtomicIsize, Ordering};
    use std::sync::OnceLock;
    use windows::core::w;
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Dwm::{
        DwmInvalidateIconicBitmaps, DwmSetIconicThumbnail, DwmSetWindowAttribute,
        DWMWA_FORCE_ICONIC_REPRESENTATION, DWMWA_HAS_ICONIC_BITMAP,
    };
    use windows::Win32::Graphics::Gdi::{
        CreateDIBSection, DeleteObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::Shell::{
        DefSubclassProc, ITaskbarList3, SetWindowSubclass, TaskbarList, THBF_DISABLED,
        THBF_ENABLED, THBF_HIDDEN, THBN_CLICKED, THB_FLAGS, THB_ICON, THB_TOOLTIP, THUMBBUTTON,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateIconFromResourceEx, DestroyIcon, IsWindowVisible, RegisterWindowMessageW, HICON,
        LR_DEFAULTCOLOR, WM_COMMAND, WM_DPICHANGED,
    };

    const WM_DWMSENDICONICTHUMBNAIL: u32 = 0x0323;

    /// The main window, for the preview's calls, which come from a command.
    static WINDOW: AtomicIsize = AtomicIsize::new(0);

    fn window() -> Option<HWND> {
        let raw = WINDOW.load(Ordering::SeqCst);
        (raw != 0).then_some(HWND(raw as *mut _))
    }

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
                unsafe {
                    CreateIconFromResourceEx(
                        set[at],
                        true,
                        0x0003_0000,
                        size,
                        size,
                        LR_DEFAULTCOLOR,
                    )
                }
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
            for icon in [
                self.heart,
                self.heart_filled,
                self.previous,
                self.play,
                self.pause,
                self.next,
            ] {
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
        WINDOW.store(hwnd.0 as isize, Ordering::SeqCst);
        // The preview is drawn here rather than taken from the window.
        let on = BOOL::from(true);
        for attribute in [DWMWA_FORCE_ICONIC_REPRESENTATION, DWMWA_HAS_ICONIC_BITMAP] {
            let set = unsafe {
                DwmSetWindowAttribute(
                    hwnd,
                    attribute,
                    &on as *const BOOL as *const _,
                    size_of::<BOOL>() as u32,
                )
            };
            if let Err(e) = set {
                log::warn!("[taskbar] the preview stays Windows' own: {e}");
            }
        }
        if !unsafe { SetWindowSubclass(hwnd, Some(listen), SUBCLASS_ID, 0) }.as_bool() {
            log::warn!("[taskbar] could not listen for presses on the preview's buttons");
        }
        // The buttons themselves wait for the first word from the frontend.
        // Windows wants them added once the window's taskbar button exists, and
        // the announcement of that came before anything here was listening; by
        // the time the page speaks, the window is up and has one.
    }

    /// The buttons on the taskbar, once per taskbar button: after Explorer
    /// restarts there is a new one, and they go on again.
    fn add() {
        // Only onto a window that is showing: one that is not has no taskbar
        // button for them to go on, and they would be taken and lost.
        let showing = BAR.with(|bar| {
            bar.borrow()
                .as_ref()
                .is_some_and(|bar| unsafe { IsWindowVisible(bar.hwnd) }.as_bool())
        });
        if !showing {
            return;
        }
        let Some((hwnd, list)) = BAR.with(|bar| {
            let mut held = bar.borrow_mut();
            let bar = held.as_mut()?;
            if bar.list.is_none() {
                bar.list = match unsafe {
                    CoCreateInstance::<_, ITaskbarList3>(&TaskbarList, None, CLSCTX_INPROC_SERVER)
                } {
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
        let Some(buttons) = buttons(&current()) else {
            return;
        };
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
            Err(e) => log::info!("[taskbar] buttons not added yet: {e}"),
        }
    }

    pub fn refresh() {
        match BAR.with(|bar| bar.borrow().as_ref().map(|bar| bar.added)) {
            None => return,
            Some(false) => {
                add();
                return;
            }
            Some(true) => {}
        }
        let Some((hwnd, list)) = BAR.with(|bar| {
            let held = bar.borrow();
            let bar = held.as_ref()?;
            Some((bar.hwnd, bar.list.clone()?))
        }) else {
            return;
        };
        let Some(buttons) = buttons(&current()) else {
            return;
        };
        if let Err(e) = unsafe { list.ThumbBarUpdateButtons(hwnd, &buttons) } {
            log::warn!("[taskbar] could not update the preview's buttons: {e}");
        }
    }

    fn buttons(state: &TaskbarState) -> Option<[THUMBBUTTON; 4]> {
        BAR.with(|bar| {
            let held = bar.borrow();
            let icons = held.as_ref()?.icons.as_ref()?;
            let tips = &state.tips;
            let on = if state.has_track {
                THBF_ENABLED
            } else {
                THBF_DISABLED
            };
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

    fn button(
        id: u32,
        icon: HICON,
        tip: &str,
        flags: windows::Win32::UI::Shell::THUMBBUTTONFLAGS,
    ) -> THUMBBUTTON {
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

    /// Hand Windows the preview the frontend drew. It keeps a copy.
    pub fn show_preview(rgba: &[u8], width: u32, height: u32) {
        let Some(hwnd) = window() else { return };
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                // Negative: top row first, as the canvas has it.
                biHeight: -(height as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
        let bitmap =
            match unsafe { CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0) } {
                Ok(bitmap) if !bits.is_null() => bitmap,
                Ok(bitmap) => {
                    let _ = unsafe { DeleteObject(bitmap.into()) };
                    return;
                }
                Err(e) => {
                    log::warn!("[taskbar] no bitmap for the preview: {e}");
                    return;
                }
            };
        // RGBA to the premultiplied BGRA Windows reads.
        let out = unsafe { std::slice::from_raw_parts_mut(bits as *mut u8, rgba.len()) };
        for (to, from) in out.chunks_exact_mut(4).zip(rgba.chunks_exact(4)) {
            let a = u16::from(from[3]);
            let pre = |c: u8| ((u16::from(c) * a + 127) / 255) as u8;
            to[0] = pre(from[2]);
            to[1] = pre(from[1]);
            to[2] = pre(from[0]);
            to[3] = from[3];
        }
        match unsafe { DwmSetIconicThumbnail(hwnd, bitmap, 0) } {
            Ok(()) => {
                static SAID: std::sync::atomic::AtomicBool =
                    std::sync::atomic::AtomicBool::new(false);
                if !SAID.swap(true, Ordering::SeqCst) {
                    log::info!(
                        "[taskbar] the preview is drawn here, {width}x{height} the first time"
                    );
                }
            }
            Err(e) => log::warn!("[taskbar] Windows did not take the preview: {e}"),
        }
        let _ = unsafe { DeleteObject(bitmap.into()) };
    }

    /// Have Windows ask for the preview again.
    pub fn invalidate_preview() {
        if let Some(hwnd) = window() {
            let _ = unsafe { DwmInvalidateIconicBitmaps(hwnd) };
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
            log::info!("[taskbar] the taskbar button is there");
            BAR.with(|bar| {
                if let Some(bar) = bar.borrow_mut().as_mut() {
                    bar.added = false;
                }
            });
            add();
        } else if msg == WM_COMMAND && ((wparam.0 >> 16) & 0xffff) as u32 == THBN_CLICKED {
            pressed((wparam.0 & 0xffff) as u32);
            return LRESULT(0);
        } else if msg == WM_DWMSENDICONICTHUMBNAIL {
            let size = super::PreviewSize {
                width: ((lparam.0 >> 16) & 0xffff) as u32,
                height: (lparam.0 & 0xffff) as u32,
            };
            super::preview_asked(size);
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
