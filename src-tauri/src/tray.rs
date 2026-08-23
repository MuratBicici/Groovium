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

use serde::Deserialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::media::{self, MediaCommand};

/// Label of the widget window, matching `tauri.conf.json`.
pub const MAIN_WINDOW: &str = "main";

const TRAY_ID: &str = "groovium-tray";

/// The menu's text, handed over by the webview.
///
/// Rust holds no dictionary. Every string the app shows lives in one place —
/// `src/core/i18n` — and this menu is the only part of the interface Rust
/// draws, so it is told what to say rather than told which language to say it
/// in. A second dictionary here is a second thing to keep in step.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayLabels {
    pub show: String,
    pub previous: String,
    pub play_pause: String,
    pub next: String,
    pub quit: String,
}

impl Default for TrayLabels {
    /// English, for the moment before the webview has loaded and reported in.
    fn default() -> Self {
        Self {
            show: "Show Groovium".into(),
            previous: "Previous".into(),
            play_pause: "Play / Pause".into(),
            next: "Next".into(),
            quit: "Quit Groovium".into(),
        }
    }
}

fn build_menu(app: &AppHandle, labels: &TrayLabels) -> tauri::Result<Menu<tauri::Wry>> {
    let show = MenuItem::with_id(app, "show", &labels.show, true, None::<&str>)?;
    let previous = MenuItem::with_id(app, "previous", &labels.previous, true, None::<&str>)?;
    let play_pause = MenuItem::with_id(app, "playpause", &labels.play_pause, true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", &labels.next, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", &labels.quit, true, None::<&str>)?;

    Menu::with_items(
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
    )
}

/// Replace the menu's text.
///
/// The whole menu is rebuilt rather than each item's text being set in place.
/// The ids are what the click handler matches on and they are rebuilt
/// identically, so nothing about behaviour depends on the labels — which is the
/// property that makes translating them safe.
#[tauri::command]
pub fn set_tray_labels(app: AppHandle, labels: TrayLabels) -> Result<(), String> {
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "No tray icon to relabel.".to_string())?;
    let menu = build_menu(&app, &labels).map_err(|e| e.to_string())?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app, &TrayLabels::default())?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;

    TrayIconBuilder::with_id(TRAY_ID)
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
