//! The window's frosting.
//!
//! CSS was the obvious place for this and cannot do it. `backdrop-filter`
//! samples the page behind an element, and for a transparent, undecorated
//! window there is no page behind it — the desktop belongs to the compositor,
//! not to the webview. It frosts perfectly in a browser and does nothing at all
//! in the app, which is exactly how it was found.
//!
//! What Windows offers instead is a small set of whole-window effects, none of
//! which takes a blur radius:
//!
//! - `blur` — the DWM blur-behind, tinted. Lags on Windows 11 22621+.
//! - `acrylic` — Windows 10 1809+, a stronger frost with noise. Lags while
//!   dragging on Windows 10 1903+ and Windows 11 22000.
//! - `mica` — Windows 11 only. Samples the wallpaper rather than the windows
//!   behind, and is the one with no documented performance cost, which for a
//!   widget that gets dragged around is worth something.
//!
//! An adjustable radius does exist in `Windows.UI.Composition`, and cannot be
//! reached from here: sampling the desktop needs `CreateHostBackdropBrush`,
//! which returns a black visual outside UWP. So the setting is a choice of
//! effect and not a slider, and the amount of *colour* over it stays with the
//! surface opacity in CSS.

use tauri::{AppHandle, Manager};
use window_vibrancy::{
    apply_acrylic, apply_blur, apply_mica, clear_acrylic, clear_blur, clear_mica,
};

/// Apply one of the window effects, or none.
///
/// The tint is the app's own surface colour, passed with **zero alpha**. The
/// effect supplies the blur; the colour over it is the shell's gradient at
/// whatever the opacity setting says, which is the one place a palette is
/// allowed to decide what this window looks like. Letting the effect tint as
/// well would paint the surface twice, once flat and once with a gradient.
#[tauri::command]
pub fn set_surface_effect(app: AppHandle, effect: String, tint: (u8, u8, u8)) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("No main window to apply an effect to.".into());
    };

    // Cleared first, and unconditionally. Switching between two effects without
    // this leaves both attached, and what the compositor then does is not
    // something any of these APIs promise.
    let _ = clear_blur(&window);
    let _ = clear_acrylic(&window);
    let _ = clear_mica(&window);

    let colour = Some((tint.0, tint.1, tint.2, 0));
    let applied = match effect.as_str() {
        "blur" => apply_blur(&window, colour),
        "acrylic" => apply_acrylic(&window, colour),
        "mica" => apply_mica(&window, None),
        // Anything else, including "none", is the cleared state above.
        _ => return Ok(()),
    };

    // Reported rather than swallowed. These fail on the Windows versions that
    // do not have the effect, and a frosting setting that silently does nothing
    // is the thing this whole change exists to stop happening.
    applied.map_err(|e| e.to_string())
}
