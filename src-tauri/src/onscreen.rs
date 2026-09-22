//! Whether the window can actually be seen, which the webview cannot tell us.
//!
//! The webview knows when it has been hidden or minimised and says so, and that
//! is what stops the drawing in the app. It does not know about being buried:
//! a browser tab behind another tab is hidden, but a window behind another
//! window is, as far as the page inside it is concerned, on screen and being
//! looked at. So it goes on drawing sixty times a second underneath a
//! full-screen something-else.
//!
//! Windows can be asked. Walk the windows above this one in the stacking order
//! and see whether any single one of them swallows it whole; that is the case
//! this is for — a maximised or full-screen window in front, with this one not
//! pinned above it. Two windows that between them happen to cover it are not
//! worth the arithmetic: the answer only decides whether an ornament draws.
//!
//! Asked a few times a second rather than hooked. A window event hook needs a
//! message loop of its own on a thread of its own, and what it would buy is
//! finding out half a second sooner that a light nobody can see may stop.

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

/// What the webview listens for: true while the window is buried.
const EVENT: &str = "window:covered";

/// How often to look.
const LOOK_EVERY: Duration = Duration::from_millis(700);

/// How far up the stacking order to walk before giving up on an answer.
const AT_MOST: usize = 64;

/// A window's corners, as Windows gives them: left, top, right, bottom.
type Box = (i32, i32, i32, i32);

/// Whether `over` swallows `under` whole.
fn covers(over: Box, under: Box) -> bool {
    // A window of no size covers nothing, however its corners compare.
    if over.2 <= over.0 || over.3 <= over.1 {
        return false;
    }
    over.0 <= under.0 && over.1 <= under.1 && over.2 >= under.2 && over.3 >= under.3
}

/// Watch for as long as the app runs, and say so when the answer changes.
pub fn watch(app: AppHandle) {
    std::thread::spawn(move || {
        let mut said: Option<bool> = None;
        loop {
            std::thread::sleep(LOOK_EVERY);
            let Some(window) = app.get_webview_window("main") else {
                continue;
            };
            let buried = buried(&window);
            // Only when it changes. This is a few bytes every three quarters of
            // a second otherwise, for an answer that is the same every time.
            if said != Some(buried) {
                said = Some(buried);
                let _ = app.emit(EVENT, buried);
            }
        }
    });
}

#[cfg(not(windows))]
fn buried(_window: &tauri::WebviewWindow) -> bool {
    false
}

#[cfg(windows)]
fn buried(window: &tauri::WebviewWindow) -> bool {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindow, GetWindowRect, IsIconic, IsWindowVisible, GW_HWNDPREV,
    };

    let Ok(handle) = window.hwnd() else { return false };
    let ours = HWND(handle.0 as *mut _);

    /// A window's corners, or nothing if it will not say.
    ///
    /// Safety: each call takes a handle that came from the system a moment ago
    /// and an out parameter it fills in; neither is held afterwards.
    fn corners(hwnd: HWND) -> Option<Box> {
        let mut rect = RECT::default();
        unsafe { GetWindowRect(hwnd, &mut rect) }.ok()?;
        Some((rect.left, rect.top, rect.right, rect.bottom))
    }

    /// Whether the desktop is holding a window that is not on screen at all.
    ///
    /// Every app from the store keeps windows like this — visible by every
    /// other measure, sitting where a real window would, and drawn nowhere.
    /// Without this they are found above ours and read as burying it.
    fn cloaked(hwnd: HWND) -> bool {
        let mut state: u32 = 0;
        let asked = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                std::ptr::from_mut(&mut state).cast(),
                std::mem::size_of::<u32>() as u32,
            )
        };
        asked.is_ok() && state != 0
    }

    // Hidden to the tray, or minimised: the webview has said so itself, and
    // agreeing costs nothing.
    if unsafe { !IsWindowVisible(ours).as_bool() || IsIconic(ours).as_bool() } {
        return true;
    }

    let Some(mine) = corners(ours) else { return false };

    let mut above = ours;
    for _ in 0..AT_MOST {
        // `GW_HWNDPREV` is the window one place *above* this one.
        let Ok(next) = (unsafe { GetWindow(above, GW_HWNDPREV) }) else {
            return false;
        };
        if next.0.is_null() {
            return false;
        }
        above = next;

        let seen = unsafe { IsWindowVisible(above).as_bool() && !IsIconic(above).as_bool() };
        if !seen || cloaked(above) {
            continue;
        }
        if corners(above).is_some_and(|theirs| covers(theirs, mine)) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::covers;

    #[test]
    fn a_window_over_the_whole_of_another_buries_it() {
        assert!(covers((0, 0, 1920, 1080), (100, 100, 500, 400)));
        assert!(covers((100, 100, 500, 400), (100, 100, 500, 400)));
    }

    #[test]
    fn a_window_that_leaves_any_of_it_showing_does_not() {
        let ours = (100, 100, 500, 400);
        assert!(!covers((0, 0, 499, 1080), ours));
        assert!(!covers((0, 101, 1920, 1080), ours));
        assert!(!covers((101, 0, 1920, 1080), ours));
        assert!(!covers((0, 0, 1920, 399), ours));
    }

    #[test]
    fn a_window_of_no_size_covers_nothing() {
        assert!(!covers((0, 0, 0, 0), (100, 100, 500, 400)));
        assert!(!covers((200, 200, 200, 900), (100, 100, 500, 400)));
    }
}
