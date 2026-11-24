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
//! And remembering where the window was left, which is a matter of writing it
//! down at the right moments rather than of moving anything.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, State, Window};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

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

/// Waiting for the window to hold still before writing down where it is.
///
/// The state plugin writes at one moment: a clean exit. That is the one moment
/// a widget like this cannot count on. Closing it hides it to the tray, where
/// it can sit for days, and what actually ends the process is an update, a
/// shutdown, a crash, or somebody stopping a dev server — none of which is an
/// exit the plugin ever hears about. Every one of them takes the position with
/// it, so the widget opens in the middle of the screen having been dragged into
/// a corner a week ago. Which is what it did.
///
/// So it is written when it changes instead. Dragging a window is sixty moves a
/// second and not one of them is worth a file, so the write waits until the
/// window has been still for a moment: each move pushes the deadline out, and
/// the one waiter writes when it finally arrives.
#[derive(Default)]
pub struct Placekeeper {
    /// When the place becomes worth writing down, or `None` for nothing owed.
    owed: Mutex<Option<Instant>>,
    /// Whether somebody is already waiting to write it.
    waiting: AtomicBool,
}

/// How still the window has to be before its place is written down.
const HOLD_STILL: Duration = Duration::from_millis(700);

/// And how often the waiter looks. Fine enough that the wait is the wait above.
const LOOK_FOR_STILLNESS: Duration = Duration::from_millis(150);

/// What the waiter should do next.
#[derive(Debug, PartialEq, Eq)]
enum Next {
    /// The window has moved again since last time.
    Wait,
    /// It has held still. Write, then come round once more.
    Write,
    /// Nothing owed. Stop, and let the next move start a new waiter.
    Done,
}

/// Note that the window has moved. `true` when nobody is waiting to write yet.
///
/// The deadline is set before the flag is claimed and both under the one lock,
/// so a waiter deciding to stop cannot slip between the two and leave nobody
/// watching a move that has just been recorded.
fn noted(keeper: &Placekeeper, now: Instant) -> bool {
    let Ok(mut owed) = keeper.owed.lock() else {
        return false;
    };
    *owed = Some(now + HOLD_STILL);
    !keeper.waiting.swap(true, Ordering::SeqCst)
}

fn step(keeper: &Placekeeper, now: Instant) -> Next {
    let Ok(mut owed) = keeper.owed.lock() else {
        return Next::Done;
    };
    match *owed {
        Some(deadline) if now < deadline => Next::Wait,
        Some(_) => {
            // Cleared before the write rather than after, so a move arriving
            // during it is owed again and written on the next turn instead of
            // being wiped out by this one finishing.
            *owed = None;
            Next::Write
        }
        None => {
            // Released while the deadline is held, for the same reason `noted`
            // claims it while holding: the two must not interleave.
            keeper.waiting.store(false, Ordering::SeqCst);
            Next::Done
        }
    }
}

/// Write the window's place down now, saying nothing if it cannot be.
///
/// A failure here is a file the app will write again on the next move, and
/// every caller is an event handler with nobody to tell.
pub fn write_place(app: &AppHandle) {
    let _ = app.save_window_state(PLACE_FLAGS);
}

/// The window has moved; write its place down once it stops.
pub fn place_changed(app: &AppHandle) {
    if !noted(&app.state::<Placekeeper>(), Instant::now()) {
        return;
    }

    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(LOOK_FOR_STILLNESS);
        match step(&app.state::<Placekeeper>(), Instant::now()) {
            Next::Wait => {}
            // On the main thread, never this one. The plugin holds its cache
            // while it asks the window where it is, and asked from here that
            // question waits for the main thread — which, if the window moves
            // in that moment, is waiting for the cache in the plugin's own
            // move handler. Each waited for the other and the app froze; the
            // drawer on the left moves the window on every open and close.
            Next::Write => {
                let writer = app.clone();
                let _ = app.run_on_main_thread(move || write_place(&writer));
            }
            Next::Done => return,
        }
    });
}

/// The side of the window the player sits at, as the last placement left it.
/// `None` until the first one, which takes the side it is given as the one the
/// window was restored in.
static PLAYER_LEFT: Mutex<Option<bool>> = Mutex::new(None);

/// Where the window goes, and how wide, so that the player does not move.
///
/// Physical pixels throughout. `at_x` and `client_w` are the window as it is;
/// `was_left` whether the player was at its right (the drawer on the left) as
/// it is; `left` whether it will be. `webview_w` is how wide the page is laid
/// out, `reach` how much of that is past the window's left edge, and `player`
/// the player's own width.
///
/// The player is at the window's right with the drawer on the left and at its
/// left with the drawer on the right, so its place on screen is read from the
/// window as it is, and the window is put round it as it will be.
pub(crate) fn placed(
    at_x: i32,
    client_w: i32,
    was_left: bool,
    left: bool,
    webview_w: i32,
    reach: i32,
    player: i32,
) -> (i32, i32) {
    let player_x = at_x + if was_left { client_w - player } else { 0 };
    let width = (webview_w - reach).max(1);
    let x = player_x - if left { width - player } else { 0 };
    (x, width)
}

/// Size and place the window around a page laid out `width` wide, of which
/// `reach` lies past the window's left edge, keeping the player where it is.
///
/// This is how the drawer on the left is done. The page keeps the drawer's
/// width for as long as the drawer is on the left, open or shut, and never lays
/// out again for it. Shut, the window narrows to the player and the page
/// reaches past its left edge by the drawer's width; open, the window takes the
/// whole page. The window's edge and the page's place inside it change in the
/// one WM_SIZE that resizes it (the patched wry: `set_left_reach`), so on
/// screen nothing moves but the edge of the window.
///
/// The move and the resize are one `SetWindowPos`, made just after the
/// compositor has presented a frame (`DwmFlush`), so both land before the next.
/// Going from one side to the other is the same call: the player stays put and
/// the window is put round it on its new side.
///
/// Logical pixels in, already multiplied by the page's zoom. `side` is `left`
/// or `right`; `player` is the player's width.
#[tauri::command]
pub fn place_window(
    window: Window,
    width: f64,
    height: f64,
    reach: f64,
    side: String,
    player: f64,
) -> Result<(), String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let px = |v: f64| (v * scale).round() as i32;
    let left = side == "left";
    let was_left = {
        let last = PLAYER_LEFT.lock().unwrap_or_else(|e| e.into_inner());
        last.unwrap_or(left)
    };
    // Where reaching past the edge cannot be done, the window simply takes the
    // whole page, as it did before.
    let reach = if cfg!(windows) { reach.max(0.0) } else { 0.0 };
    let h = px(height).max(1);

    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{HWND, LPARAM, RECT, WPARAM};
        use windows::Win32::Graphics::Dwm::DwmFlush;
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowPlacement, GetWindowRect, IsIconic, SendMessageW, SetWindowPlacement,
            SetWindowPos, SIZE_RESTORED, SWP_NOACTIVATE, SWP_NOZORDER, WINDOWPLACEMENT, WM_SIZE,
        };
        let hwnd = HWND(window.hwnd().map_err(|e| e.to_string())?.0);

        // Minimised, the window is parked off screen and the place that counts
        // is the one it will be restored to. That is moved instead, and the
        // reach is taken up in the WM_SIZE that restoring sends.
        if unsafe { IsIconic(hwnd) }.as_bool() {
            let mut placement = WINDOWPLACEMENT {
                length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
                ..Default::default()
            };
            unsafe { GetWindowPlacement(hwnd, &mut placement) }.map_err(|e| e.to_string())?;
            let normal = placement.rcNormalPosition;
            let (x, w) = placed(
                normal.left,
                normal.right - normal.left,
                was_left,
                left,
                px(width),
                px(reach),
                px(player),
            );
            placement.rcNormalPosition = RECT {
                left: x,
                top: normal.top,
                right: x + w,
                bottom: normal.top + h,
            };
            wry::set_left_reach(reach);
            unsafe { SetWindowPlacement(hwnd, &placement) }.map_err(|e| e.to_string())?;
        } else {
            let mut now = RECT::default();
            unsafe { GetWindowRect(hwnd, &mut now) }.map_err(|e| e.to_string())?;
            let (old_w, old_h) = (now.right - now.left, now.bottom - now.top);
            let (x, w) = placed(
                now.left,
                old_w,
                was_left,
                left,
                px(width),
                px(reach),
                px(player),
            );
            let reach_before = wry::set_left_reach(reach);
            // Just after a frame, so the move and the resize land before the next.
            let _ = unsafe { DwmFlush() };
            unsafe { SetWindowPos(hwnd, None, x, now.top, w, h, SWP_NOZORDER | SWP_NOACTIVATE) }
                .map_err(|e| e.to_string())?;
            // A window that keeps its size gets no WM_SIZE, and it is in WM_SIZE
            // that the webview takes up its reach. Changing sides while shut
            // does exactly that, and so does a launch into a window already
            // narrow.
            if (w, h) == (old_w, old_h) && reach_before != reach {
                let both = ((h as u32 & 0xffff) << 16) | (w as u32 & 0xffff);
                unsafe {
                    SendMessageW(
                        hwnd,
                        WM_SIZE,
                        Some(WPARAM(SIZE_RESTORED as usize)),
                        Some(LPARAM(both as isize)),
                    )
                };
            }
        }
    }
    #[cfg(not(windows))]
    {
        use tauri::{PhysicalPosition, PhysicalSize};
        let at = window.outer_position().map_err(|e| e.to_string())?;
        let size = window.outer_size().map_err(|e| e.to_string())?;
        let (x, w) = placed(
            at.x,
            size.width as i32,
            was_left,
            left,
            px(width),
            0,
            px(player),
        );
        window
            .set_size(PhysicalSize::new(w.max(1) as u32, h as u32))
            .map_err(|e| e.to_string())?;
        window
            .set_position(PhysicalPosition::new(x, at.y))
            .map_err(|e| e.to_string())?;
    }

    *PLAYER_LEFT.lock().unwrap_or_else(|e| e.into_inner()) = Some(left);
    Ok(())
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
/// While the drawer opens or shuts on the left, the window is as wide as the
/// drawer and the shell grows or shrinks inside it (see `place_window`). For
/// the length of the animation that leaves a stretch of transparent window
/// beside the player which would otherwise swallow clicks meant for whatever is
/// behind it.
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
/// and only while part of the window is not the shell.
///
/// A rectangle in logical pixels, measured from the window's own corner.
///
/// Logical, and turned into physical ones at each look, because a window has no
/// one physical size: Windows rescales it on the way to a monitor with another
/// scale, and nothing names the part again, since in the page's own pixels it
/// has not changed. Held in physical pixels it stayed where it had been named.
/// From 100% to 150% that left the player dead and the stretch beside it taking
/// the clicks; from 150% to 100% it lay wholly past the window's right edge.
/// Either way nothing could be clicked, not even to drag the window back, until
/// the app was restarted.
type Part = (f64, f64, f64, f64);

/// The part of the window that takes clicks, or `None` for all of it.
type Named = Arc<Mutex<Option<Part>>>;

#[derive(Default)]
pub struct ClickArea {
    /// The part that takes clicks, in logical pixels from the window's corner.
    /// `None` is the whole window. Shared, because the watcher reads it from a
    /// thread of its own for as long as the app is running.
    part: Named,
    /// How many times a part has been named. The watcher compares it with the
    /// count it last acted on, so a change it did not make itself is put right
    /// on its next look rather than taken on trust; see `Watch`.
    named: Arc<AtomicU64>,
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
    let part = if width < 0.0 || height < 0.0 {
        None
    } else {
        Some((x, y, width, height))
    };

    if let Ok(mut held) = area.part.lock() {
        *held = part;
    }
    // Everything is clickable again the moment the part is gone, whether or not
    // the watcher gets there first.
    if part.is_none() {
        let _ = window.set_ignore_cursor_events(false);
    }
    // Counted after both, so a watcher that sees the new count also sees the
    // new part.
    area.named.fetch_add(1, Ordering::SeqCst);

    watch(&window, area.inner());
    Ok(())
}

/// What the watcher believes about the window, and whether to tell it again.
///
/// It used to keep only the first half: whether it had last told the window to
/// let clicks through, trusted until the cursor said otherwise. But the window
/// is told things it does not hear about — `set_click_area` makes all of it
/// clickable at once when the part is taken away, which is what every drawer
/// animation on the left does as the shell fills the window. With the cursor
/// away from the player at the time (in another app, with the drawer opening
/// or shutting by itself), the watcher still believed the window was letting
/// clicks through when the part came back, saw no change to make, and left the
/// empty stretch beside the player swallowing clicks meant for whatever was
/// behind it — until the cursor next crossed the player. Now any naming since
/// its last look sends it to the window again, whatever it believes.
#[derive(Default)]
struct Watch {
    /// Whether it last told the window to let clicks through.
    ignoring: bool,
    /// The count of namings it last acted on.
    seen: u64,
}

impl Watch {
    /// One look: whether the window should let clicks through now, and how
    /// many times a part has been named. What to tell the window, if anything.
    fn look(&mut self, wanted: bool, named: u64) -> Option<bool> {
        let renamed = named != self.seen;
        self.seen = named;
        if wanted == self.ignoring && !renamed {
            return None;
        }
        self.ignoring = wanted;
        Some(wanted)
    }
}

/// One watcher for the life of the app, started the first time it is needed.
fn watch(window: &Window, area: &ClickArea) {
    if area.watching.swap(true, Ordering::SeqCst) {
        return;
    }

    let window = window.clone();
    let part = Arc::clone(&area.part);
    let named = Arc::clone(&area.named);
    std::thread::spawn(move || {
        let mut watching = Watch::default();
        let mut every = IDLE_EVERY;
        loop {
            std::thread::sleep(every);

            // The count before the part, so a part read here is never older
            // than the count it is judged against.
            let count = named.load(Ordering::SeqCst);
            let current = part.lock().ok().and_then(|held| *held);
            every = if current.is_some() { LOOK_EVERY } else { IDLE_EVERY };

            let wanted = match current {
                // No part named: the whole window takes clicks.
                None => false,
                Some(rect) => !over(&window, rect),
            };

            if let Some(tell) = watching.look(wanted, count) {
                if window.set_ignore_cursor_events(tell).is_err() {
                    // The window has gone. So has the reason to keep looking.
                    return;
                }
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
    let Ok(scale) = window.scale_factor() else { return true };
    let mut cursor = POINT::default();
    // Safety: an out parameter this call fills in, and nothing else.
    if unsafe { GetCursorPos(&mut cursor) }.is_err() {
        // Unable to say. Taking the clicks is the safer half of being wrong:
        // the window is at worst too eager, rather than unusable.
        return true;
    }

    inside((cursor.x, cursor.y), (at.x, at.y), rect, scale)
}

/// Whether a cursor is inside `rect`, for a window at `at` drawn at `scale`.
/// The cursor and the window's corner are in physical pixels.
#[cfg(any(windows, test))]
fn inside(cursor: (i32, i32), at: (i32, i32), rect: Part, scale: f64) -> bool {
    let px = |v: f64| (v * scale).round() as i32;
    let (x, y, width, height) = rect;
    let inside_x = cursor.0 >= at.0 + px(x) && cursor.0 < at.0 + px(x) + px(width);
    let inside_y = cursor.1 >= at.1 + px(y) && cursor.1 < at.1 + px(y) + px(height);
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
    fn the_watcher_says_nothing_when_nothing_has_changed() {
        let mut watch = Watch::default();
        assert_eq!(watch.look(true, 1), Some(true), "away from the player: let clicks through");
        assert_eq!(watch.look(true, 1), None, "still away, nothing new");
        assert_eq!(watch.look(false, 1), Some(false), "over the player: take them");
    }

    #[test]
    fn a_window_made_clickable_behind_the_watchers_back_is_put_right() {
        // The fault behind clicks vanishing beside a shut drawer on the left.
        // The watcher had let clicks through; then, between two of its looks,
        // the part was taken away (the window made clickable at once) and
        // named again, with the cursor still away from the player.
        let mut watch = Watch::default();
        assert_eq!(watch.look(true, 1), Some(true));
        assert_eq!(
            watch.look(true, 3),
            Some(true),
            "the window was changed meanwhile, so it is told again"
        );
        assert_eq!(watch.look(true, 3), None);
    }

    #[test]
    fn the_part_that_takes_clicks_follows_the_window_to_another_scale() {
        // The player beside a shut drawer on the left, in a window that is
        // 1020 wide at 100% and 1530 at 150%. Measured on the demo window on
        // two real monitors: named at one scale and read at the other, the
        // player took no clicks at all.
        let player = (680.0, 0.0, 340.0, 480.0);
        let at = (100, 100);

        assert!(inside((100 + 850, 300), at, player, 1.0), "over the player at 100%");
        assert!(!inside((100 + 500, 300), at, player, 1.0), "beside it at 100%");

        assert!(inside((100 + 1275, 300), at, player, 1.5), "over the player at 150%");
        assert!(!inside((100 + 850, 300), at, player, 1.5), "beside it at 150%");
    }

    #[test]
    fn a_part_of_no_size_takes_no_clicks_at_any_scale() {
        // What the window is given while it travels between the drawer's sides.
        let nothing = (0.0, 0.0, 0.0, 0.0);
        assert!(!inside((100, 100), (100, 100), nothing, 1.0));
        assert!(!inside((100, 100), (100, 100), nothing, 1.5));
    }

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

    /// Far enough past a deadline to be past it, however the clock rounds.
    const LATER: Duration = Duration::from_millis(HOLD_STILL.as_millis() as u64 + 1);

    #[test]
    fn a_drag_puts_one_waiter_on_it_and_not_sixty() {
        // Sixty moves a second, each of them spawning a thread that writes a
        // file, is the reason the place is not simply saved on every move.
        let keeper = Placekeeper::default();
        let now = Instant::now();

        assert!(noted(&keeper, now), "the first move needs somebody to wait");
        for tick in 1..60 {
            let again = noted(&keeper, now + Duration::from_millis(tick));
            assert!(!again, "somebody already is");
        }
    }

    #[test]
    fn a_move_pushes_the_write_out_rather_than_letting_it_land() {
        // What makes this a wait for stillness rather than a delay: a drag that
        // runs for a second must not write halfway through it.
        let keeper = Placekeeper::default();
        let start = Instant::now();
        noted(&keeper, start);

        let nearly = start + LATER - Duration::from_millis(2);
        assert_eq!(step(&keeper, nearly), Next::Wait);
        noted(&keeper, nearly);
        assert_eq!(step(&keeper, start + LATER), Next::Wait, "the deadline moved with it");
        assert_eq!(step(&keeper, nearly + LATER), Next::Write);
    }

    #[test]
    fn the_waiter_stops_once_the_place_is_written_and_a_later_move_starts_another() {
        let keeper = Placekeeper::default();
        let start = Instant::now();
        noted(&keeper, start);

        assert_eq!(step(&keeper, start + LATER), Next::Write);
        assert_eq!(step(&keeper, start + LATER), Next::Done, "nothing is owed");
        assert!(noted(&keeper, start + LATER), "and the next move is somebody's job again");
    }

    #[test]
    fn a_move_during_the_write_is_owed_again_rather_than_swallowed() {
        // The write happens between two turns of the loop. A move landing in
        // that gap has to survive it, or the last thing somebody did with the
        // window is the one thing never written down.
        let keeper = Placekeeper::default();
        let start = Instant::now();
        noted(&keeper, start);
        assert_eq!(step(&keeper, start + LATER), Next::Write);

        assert!(!noted(&keeper, start + LATER), "the same waiter is still on it");
        let after = start + LATER + LATER;
        assert_eq!(step(&keeper, after), Next::Write, "and it writes again");
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

    // --- Where the window goes around the player -------------------------------

    const PLAYER: i32 = 340;
    const PAGE: i32 = 1020;
    const DRAWER: i32 = 680;

    #[test]
    fn the_drawer_shutting_on_the_left_narrows_the_window_to_the_player() {
        // Wide at 100, the player at 780..1120.
        assert_eq!(
            placed(100, PAGE, true, true, PAGE, DRAWER, PLAYER),
            (780, PLAYER)
        );
    }

    #[test]
    fn the_drawer_opening_on_the_left_widens_the_window_leftwards() {
        // Narrow at 780: the player stays at 780..1120, the window starts at 100.
        assert_eq!(
            placed(780, PLAYER, true, true, PAGE, 0, PLAYER),
            (100, PAGE)
        );
    }

    #[test]
    fn a_window_from_before_this_narrows_where_it_stands() {
        // An always-wide window on the left, restored at launch: the player is
        // at its right, and the window comes in to it.
        assert_eq!(
            placed(0, PAGE, true, true, PAGE, DRAWER, PLAYER),
            (DRAWER, PLAYER)
        );
    }

    #[test]
    fn a_narrow_window_at_launch_stays_where_it_is() {
        assert_eq!(
            placed(780, PLAYER, true, true, PAGE, DRAWER, PLAYER),
            (780, PLAYER)
        );
    }

    #[test]
    fn on_the_right_the_left_edge_stays() {
        assert_eq!(
            placed(300, PLAYER, false, false, PAGE, 0, PLAYER),
            (300, PAGE)
        );
        assert_eq!(
            placed(300, PAGE, false, false, PLAYER, 0, PLAYER),
            (300, PLAYER)
        );
    }

    #[test]
    fn changing_sides_keeps_the_player_where_it_is() {
        // Shut on the left, at 780: to the right, still at 780.
        assert_eq!(
            placed(780, PLAYER, true, false, PLAYER, 0, PLAYER),
            (780, PLAYER)
        );
        // Shut on the right at 780: to the left, the page reaching past.
        assert_eq!(
            placed(780, PLAYER, false, true, PAGE, DRAWER, PLAYER),
            (780, PLAYER)
        );
    }
}
