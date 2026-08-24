//! The window's frosting.
//!
//! CSS was the obvious place for this and cannot do it. `backdrop-filter`
//! samples the page behind an element, and for a transparent, undecorated
//! window there is no page behind it — the desktop belongs to the compositor,
//! not to the webview. It frosts perfectly in a browser and does nothing at all
//! in the app, which is exactly how it was found.
//!
//! What is left is a small set of whole-window effects, none of which takes a
//! blur radius, and each with its own floor:
//!
//! - `blur` — **Windows 7/10/11 22H1 only.** Gone from every build after that,
//!   so on a current Windows 11 this one is expected to do nothing.
//! - `acrylic` — Windows 10/11. Lags while dragging on Windows 10 v1903+ and
//!   Windows 11 build 22000.
//! - `mica` — Windows 11 only. Samples the wallpaper rather than the windows
//!   behind, and is the one with no documented cost while the window moves.
//!
//! An adjustable radius does exist in `Windows.UI.Composition`, and cannot be
//! reached from here: sampling the desktop needs `CreateHostBackdropBrush`,
//! which returns a black visual outside UWP. So this is a choice of effect and
//! not a slider, and the amount of *colour* over it stays with the surface
//! opacity in CSS.
//!
//! Tauri's own API rather than the `window-vibrancy` crate it is built on: the
//! same effects, one dependency fewer, and errors that come back with the
//! platform's own words in them. No tint is passed — Windows 11 ignores it
//! outright, and on Windows 10 it applies to acrylic alone, which is not enough
//! to justify a colour arriving from two places at once.

use tauri::utils::config::WindowEffectsConfig;
use tauri::window::{Effect, EffectsBuilder};
use tauri::{AppHandle, Manager};

/// Wear one of the platform's window effects, or none.
#[tauri::command]
pub fn set_surface_effect(app: AppHandle, effect: String) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("No main window to apply an effect to.".into());
    };

    let config: Option<WindowEffectsConfig> = match effect.as_str() {
        "blur" => Some(EffectsBuilder::new().effect(Effect::Blur).build()),
        "acrylic" => Some(EffectsBuilder::new().effect(Effect::Acrylic).build()),
        "mica" => Some(EffectsBuilder::new().effect(Effect::Mica).build()),
        // Anything else, "none" included, clears whatever is on the window.
        _ => None,
    };

    // Reported rather than swallowed, and the caller puts it on screen. An
    // effect that silently does nothing is the thing this whole change exists
    // to stop happening — it is how the CSS attempt survived as long as it did.
    window.set_effects(config).map_err(|e| e.to_string())
}
