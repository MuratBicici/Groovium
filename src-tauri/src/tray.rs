//! System tray icon and menu.
//!
//! The tray is what turns this from a small window into a widget: closing the
//! window hides it here rather than ending playback, and transport stays
//! reachable while the window is out of sight.
//!
//! The Play/Pause entry deliberately does not change its label to reflect the
//! current state. Doing so would need playback state pushed from the webview
//! back into Rust and kept in sync — real complexity for a menu label, when one
//! toggle entry already does the right thing.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::media::{self, MediaCommand};

/// Label of the widget window, matching `tauri.conf.json`.
pub const MAIN_WINDOW: &str = "main";

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Groovium", true, None::<&str>)?;
    let previous = MenuItem::with_id(app, "previous", "Previous", true, None::<&str>)?;
    let play_pause = MenuItem::with_id(app, "playpause", "Play / Pause", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Next", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Groovium", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &show,
            &PredefinedMenuItem::separator(app)?,
            &previous,
            &play_pause,
            &next,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;

    TrayIconBuilder::with_id("groovium-tray")
        .icon(icon)
        .tooltip("Groovium")
        // Left click toggles the window; the menu belongs on right click, which
        // is what people expect from a tray icon on Windows.
        .show_menu_on_left_click(false)
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_window(app),
            "playpause" => media::emit(app, MediaCommand::PlayPause),
            "next" => media::emit(app, MediaCommand::Next),
            "previous" => media::emit(app, MediaCommand::Previous),
            "quit" => app.exit(0),
            other => eprintln!("[tray] unhandled menu item: {other}"),
        })
        .on_tray_icon_event(|tray, event| {
            // Only act on button release, or the window toggles twice per click.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Bring the widget back, whether it was hidden or merely behind something.
pub fn show_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

fn toggle_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };

    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        show_window(app);
    }
}
