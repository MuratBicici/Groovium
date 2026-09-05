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

use tauri::{PhysicalPosition, PhysicalSize, Window};

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
