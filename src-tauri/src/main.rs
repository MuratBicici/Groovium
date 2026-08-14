// Keep the console window from appearing alongside the widget on Windows
// release builds. Debug builds keep it so `println!` and panics stay visible.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod files;
mod keyring;
mod media;
mod metadata;
mod session;
mod shortcuts;
mod tray;

use tauri::WindowEvent;
use tauri_plugin_window_state::StateFlags;

fn main() {
    tauri::Builder::default()
        // Must be registered first so a second launch is intercepted before it
        // does any other setup work.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // The widget is already running — surface it instead of starting
            // a second copy that would fight over the media keys.
            tray::show_window(app);
        }))
        // Remember where the user put the widget. Position only: the window is
        // a fixed size, and restoring a size would fight `resizable: false`.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::POSITION)
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(files::PickedPaths::default())
        .setup(|app| {
            tray::create(app.handle())?;
            // Never fatal: media keys may already be held by another app.
            shortcuts::register(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing hides to the tray rather than quitting, so playback
            // survives dismissing the window. Quit lives in the tray menu.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            keyring::vault_set_token,
            keyring::vault_get_token,
            keyring::vault_delete_token,
            files::pick_audio_files,
            files::pick_music_folder,
            files::read_cover_art,
            session::load_session,
            session::save_session,
            audio::audio_backend_available,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Groovium");
}
