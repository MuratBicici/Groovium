// Keep the console window from appearing alongside the widget on Windows
// release builds. Debug builds keep it so `println!` and panics stay visible.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod files;
mod keyring;
mod library;
mod media;
mod metadata;
mod playlists;
mod session;
mod shortcuts;
mod spotify;
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
        .plugin(tauri_plugin_opener::init())
        .manage(files::PickedPaths::default())
        .manage(library::ImportControl::default())
        .manage(spotify::tokens::AccessTokenCache::default())
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
        // No credential-store commands here on purpose. Reading a stored secret
        // by name used to be callable from the webview; it is now Rust-internal
        // (`keyring.rs`), so a refresh token has no path out of this process.
        .invoke_handler(tauri::generate_handler![
            files::pick_audio_files,
            files::pick_music_folder,
            files::read_cover_art,
            library::library_load,
            library::library_pick_files,
            library::library_pick_folder,
            library::library_import,
            library::library_cancel_import,
            library::library_remove,
            library::library_store_dir,
            playlists::playlists_load,
            playlists::playlist_create,
            playlists::playlist_rename,
            playlists::playlist_delete,
            playlists::playlist_add_item,
            playlists::playlist_remove_item,
            session::load_session,
            session::save_session,
            spotify::spotify_begin_auth,
            spotify::spotify_access_token,
            spotify::spotify_is_authenticated,
            spotify::spotify_sign_out,
            spotify::spotify_has_client_id,
            spotify::spotify_set_client_id,
            spotify::spotify_clear_client_id,
            spotify::spotify_redirect_uri,
            spotify::spotify_open_dashboard,
            audio::audio_backend_available,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Groovium");
}
