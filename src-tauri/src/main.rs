// Keep the console window from appearing alongside the widget on Windows
// release builds. Debug builds keep it so `println!` and panics stay visible.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod files;
mod keyring;
mod metadata;
mod session;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(files::PickedPaths::default())
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
