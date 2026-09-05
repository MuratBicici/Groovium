//! Moving and resizing the window as one operation.
//!
//! Tauri offers `set_position` and `set_size` and nothing that does both, which
//! is fine until the two have to agree. Opening the drawer on the left keeps
//! the window's *right* edge still, so its width and its x change together and
//! by the same amount — and either order leaves an instant where one has landed
//! and the other has not. On Windows that instant is a presented frame, and a
//! frame with the player six hundred and eighty pixels from where it was is
//! precisely the flicker this exists to remove.
//!
//! `SetWindowPos` takes both and is one call. Everywhere else falls back to the
//! two, which is what the platform offers.

use tauri::Window;

/// Resize the window and move its left edge by `dx`, together.
///
/// `dx` is how far the left edge travels, in logical pixels. Zero is an
/// ordinary resize. Minus the width gained is the drawer opening leftwards: the
/// right edge stays where it is, so the player underneath does not move. And a
/// `dx` with no change of width at all is the drawer swapping sides while it is
/// open, which is a pure translation and belongs to neither anchor.
///
/// The frontend supplies it rather than this working it out, because the
/// frontend is where the widths come from — it knows what the window is
/// changing from as well as to, and a second opinion here could only disagree.
///
/// Where the window is *now* is read here, which keeps the frontend from
/// needing a position permission it has no other use for.
#[tauri::command]
pub fn set_window_box(window: Window, width: f64, height: f64, dx: f64) -> Result<(), String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let at = window.outer_position().map_err(|e| e.to_string())?;

    place(
        &window,
        at.x + (dx * scale).round() as i32,
        at.y,
        (width * scale).round() as i32,
        (height * scale).round() as i32,
    )
}

#[cfg(windows)]
fn place(window: &Window, x: i32, y: i32, width: i32, height: i32) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER,
    };

    let handle = window.hwnd().map_err(|e| e.to_string())?;
    // Safety: the handle comes from the window this call is about, and it is
    // alive for the duration — the command holds it.
    unsafe {
        SetWindowPos(
            HWND(handle.0 as *mut _),
            None,
            x,
            y,
            width,
            height,
            SWP_NOZORDER | SWP_NOACTIVATE,
        )
        .map_err(|e| e.to_string())
    }
}

#[cfg(not(windows))]
fn place(window: &Window, x: i32, y: i32, width: i32, height: i32) -> Result<(), String> {
    use tauri::{PhysicalPosition, PhysicalSize};

    // Size first, then position. Growing to the right and then sliding left
    // shows a frame of window that was going to be there anyway; the other
    // order shows a frame of the window somewhere it never belongs.
    window
        .set_size(PhysicalSize::new(width.max(1) as u32, height.max(1) as u32))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}
