//! Moving and resizing the window together.
//!
//! Opening the drawer on the left keeps the window's *right* edge still, so its
//! width and its x change by the same amount and have to agree. Tauri offers
//! `set_position` and `set_size` and nothing that does both, so this does them
//! back to back inside one command — microseconds apart, and well inside the
//! frame the compositor is going to present.
//!
//! It was one `SetWindowPos` before that, which is genuinely atomic and looked
//! like the better answer. It was not: moving the top-level window that way
//! leaves the WebView2 child where it was until Tauri hears about it, and the
//! window blinked out for a frame on every open and close. Going through Tauri
//! means the webview is moved with the window rather than after it.
//!
//! And, at the two ends of a session, remembering where the window was left.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, State, Window};
use tauri_plugin_window_state::StateFlags;

/// What is remembered about where the window was left.
///
/// Position and size both — though nothing restored from the size outlives the
/// first second, because the frontend sets the window to whatever the drawer
/// and the collapsed state call for the moment it has laid out. It is saved
/// because **the position cannot be restored without it.**
///
/// The state plugin only puts a window back where its saved *rectangle* meets a
/// monitor, and a rectangle with no size beside it is a single point: the
/// window's top left corner. With the drawer on the left that corner is the
/// worst possible thing to test. The window there is permanently as wide as the
/// drawer needs and the player sits at its right edge — that is what lets the
/// drawer open without the window moving — so the corner is the drawer's whole
/// width away from anything anyone can see. Leave the widget in the left third
/// of the screen and the corner is off the edge of it: the position was thrown
/// away without a word and the window came back in the middle.
///
/// Given a real size the same test asks the question it was meant to ask — is
/// any part of this window on a monitor — and answers yes everywhere the widget
/// can actually be put.
pub const PLACE_FLAGS: StateFlags = StateFlags::POSITION.union(StateFlags::SIZE);

/// Where the window's place is kept, beside the app's other files.
pub const PLACE_FILE: &str = "window.json";

/// The file the position-only scheme wrote, which holds nothing worth keeping.
const OLD_PLACE_FILE: &str = ".window-state.json";

/// Throw away the place file written before a size was saved alongside.
///
/// Not converted, because there is nothing in it to convert: what it holds is a
/// position and a zero size, which is exactly the pair that could not be
/// restored — and read as it stands it would ask for a window no pixels wide.
/// So the window's place is learned again from the next quit onwards, once, and
/// the file goes rather than staying in the app's directory being wrong.
pub fn forget_old_place(app: &AppHandle) {
    if let Ok(dir) = app.path().app_config_dir() {
        forget_old_place_in(&dir);
    }
}

fn forget_old_place_in(dir: &Path) {
    // Missing is the ordinary case: every launch after the first, and every
    // install that never ran an older build.
    let _ = std::fs::remove_file(dir.join(OLD_PLACE_FILE));
}

/// Resize the window and move its left edge by `dx`, in that order.
///
/// `dx` is how far the left edge travels, in logical pixels. Zero is an
/// ordinary resize. Minus the width gained is the drawer opening leftwards: the
/// right edge stays where it is, so the player underneath does not move.
///
/// The frontend supplies the distance rather than this working it out, because
/// the frontend is where the widths come from — it knows what the window is
/// changing from as well as to, and a second opinion here could only disagree.
///
/// Where the window is *now* is read here, which keeps the frontend from
/// needing a position permission it has no other use for.
#[tauri::command]
pub fn set_window_box(window: Window, width: f64, height: f64, dx: f64) -> Result<(), String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let at = window.outer_position().map_err(|e| e.to_string())?;
    let px = |v: f64| (v * scale).round() as i32;

    // Size first. Growing to the right briefly covers ground the window is
    // about to occupy anyway; moving first would put it somewhere it never
    // belongs. Neither is normally seen — the webview lays out on the next
    // frame, by which time both have landed.
    window
        .set_size(PhysicalSize::new(
            px(width).max(1) as u32,
            px(height).max(1) as u32,
        ))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(at.x + px(dx), at.y))
        .map_err(|e| e.to_string())
}

/// Take away the frame Windows draws around this window.
///
/// The shell inside is rounded to eighteen pixels and painted by the webview.
/// Windows 11 has its own ideas: a rounded corner of a different radius, and a
/// one-pixel border in the system accent colour. Neither is hidden by the
/// shell, because they are drawn outside it — so what shows is a square-ish
/// corner in somebody's accent colour, poking out past the corner this app
/// drew. Most visibly when focus leaves for another window, because that is
/// when the border is repainted in its inactive shade.
///
/// Both are one call each. A window that draws its whole self, transparency
/// and corners included, is telling the truth by asking for neither.
///
/// Failure is ignored on purpose. These attributes arrived in Windows 11, and
/// on anything older the call is refused — which is the correct outcome there
/// rather than a problem: nothing draws that border on Windows 10 either.
pub fn undress(window: &Window) {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE,
            DWMWCP_DONOTROUND,
        };

        let Ok(handle) = window.hwnd() else { return };
        let hwnd = HWND(handle.0 as *mut _);

        /// `DWMWA_COLOR_NONE`: no border at all, as against a colour to draw it in.
        const NO_BORDER: u32 = 0xFFFF_FFFE;
        let corners = DWMWCP_DONOTROUND;

        // Safety: the handle belongs to the window this is about and is alive
        // for the call; both attributes are the size the API documents for them.
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_BORDER_COLOR,
                std::ptr::from_ref(&NO_BORDER).cast(),
                std::mem::size_of::<u32>() as u32,
            );
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                std::ptr::from_ref(&corners).cast(),
                std::mem::size_of::<i32>() as u32,
            );
        }
    }
    #[cfg(not(windows))]
    let _ = window;
}

/// Which part of the window takes clicks, and the watcher that enforces it.
///
/// The drawer opening leftwards needs the window to be wider than what it shows
/// — that is what lets the window stay still, and a window that stays still
/// cannot flicker. It leaves a stretch of transparent window beside the player
/// which would otherwise swallow clicks meant for whatever is behind it.
///
/// A window region was the obvious answer and was the wrong one. Cutting the
/// shape of a window that composes with per-pixel alpha turns that alpha off:
/// the corners outside the rounded shell, which had been transparent, started
/// being painted — a square corner sitting past the rounded one, most visible
/// when focus moved elsewhere and it was repainted. Rounding the cut and
/// holding it a couple of pixels clear both failed, because the shape was never
/// what was drawing there.
///
/// So the shape is left alone and the cursor is watched instead. Over the
/// player the window takes its clicks; anywhere else it is transparent to the
/// mouse and they land on whatever is behind. `GetCursorPos` is a call into the
/// window manager with no allocation and no round trip, thirty times a second,
/// and only while the drawer is shut on the left.
/// A rectangle in physical pixels, measured from the window's own corner.
type Part = (i32, i32, i32, i32);

/// The part of the window that takes clicks, or `None` for all of it.
type Named = Arc<Mutex<Option<Part>>>;

#[derive(Default)]
pub struct ClickArea {
    /// The part that takes clicks, in physical pixels from the window's corner.
    /// `None` is the whole window. Shared, because the watcher reads it from a
    /// thread of its own for as long as the app is running.
    part: Named,
    watching: AtomicBool,
}

/// How often the cursor is looked for while part of the window is being let
/// through. Fast enough that nobody arrives at the player and finds it dead,
/// cheap enough not to be worth measuring.
const LOOK_EVERY: Duration = Duration::from_millis(33);

/// And how often when the whole window takes clicks, which is most of the time.
///
/// There is nothing to watch then. The thread stays alive rather than being
/// started and stopped — the drawer can be opened and shut all evening — but a
/// thread with nothing to do should not be waking up thirty times a second on
/// somebody's battery.
const IDLE_EVERY: Duration = Duration::from_millis(400);

/// Say which part of the window takes clicks; a negative width means all of it.
#[tauri::command]
pub fn set_click_area(
    window: Window,
    area: State<'_, ClickArea>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let px = |v: f64| (v * scale).round() as i32;

    let part = if width < 0.0 || height < 0.0 {
        None
    } else {
        Some((px(x), px(y), px(width), px(height)))
    };

    if let Ok(mut held) = area.part.lock() {
        *held = part;
    }
    // Everything is clickable again the moment the part is gone, whether or not
    // the watcher gets there first.
    if part.is_none() {
        let _ = window.set_ignore_cursor_events(false);
    }

    watch(&window, area.inner());
    Ok(())
}

/// One watcher for the life of the app, started the first time it is needed.
fn watch(window: &Window, area: &ClickArea) {
    if area.watching.swap(true, Ordering::SeqCst) {
        return;
    }

    let window = window.clone();
    let part = Arc::clone(&area.part);
    std::thread::spawn(move || {
        let mut ignoring = false;
        let mut every = IDLE_EVERY;
        loop {
            std::thread::sleep(every);

            let named = part.lock().ok().and_then(|held| *held);
            every = if named.is_some() { LOOK_EVERY } else { IDLE_EVERY };

            let wanted = match named {
                // No part named: the whole window takes clicks.
                None => false,
                Some(rect) => !over(&window, rect),
            };

            if wanted != ignoring {
                if window.set_ignore_cursor_events(wanted).is_err() {
                    // The window has gone. So has the reason to keep looking.
                    return;
                }
                ignoring = wanted;
            }
        }
    });
}

/// Whether the cursor is inside `rect`, which is relative to the window.
#[cfg(windows)]
fn over(window: &Window, rect: Part) -> bool {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let Ok(at) = window.outer_position() else { return true };
    let mut cursor = POINT::default();
    // Safety: an out parameter this call fills in, and nothing else.
    if unsafe { GetCursorPos(&mut cursor) }.is_err() {
        // Unable to say. Taking the clicks is the safer half of being wrong:
        // the window is at worst too eager, rather than unusable.
        return true;
    }

    let (x, y, width, height) = rect;
    let inside_x = cursor.x >= at.x + x && cursor.x < at.x + x + width;
    let inside_y = cursor.y >= at.y + y && cursor.y < at.y + y + height;
    inside_x && inside_y
}

#[cfg(not(windows))]
fn over(_window: &Window, _rect: Part) -> bool {
    true
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_place_is_remembered_with_a_size_beside_it() {
        // Not a formality. The size is overwritten by the frontend a moment
        // after it is restored, which makes it read like something to drop —
        // and dropping it is what quietly stopped the window coming back where
        // it was left. The plugin tests the saved rectangle against the
        // monitors, and with no size that rectangle is one corner.
        assert!(PLACE_FLAGS.contains(StateFlags::SIZE));
        assert!(PLACE_FLAGS.contains(StateFlags::POSITION));
    }

    #[test]
    fn the_file_with_no_size_in_it_goes_and_the_one_in_use_stays() {
        let dir = std::env::temp_dir().join(format!("groovium-place-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("a directory to work in");
        let old = dir.join(OLD_PLACE_FILE);
        let current = dir.join(PLACE_FILE);
        std::fs::write(&old, "{}").expect("the old file");
        std::fs::write(&current, "{}").expect("the current one");

        forget_old_place_in(&dir);
        assert!(!old.exists(), "the position with no size beside it is gone");
        assert!(current.exists(), "the file the window is remembered in is not");

        // And again on a directory that has already had it taken away, which is
        // every launch but one.
        forget_old_place_in(&dir);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
