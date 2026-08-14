// Keep the console window from appearing alongside the widget on Windows
// release builds. Debug builds keep it so `println!` and panics stay visible.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod files;
mod keyring;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            keyring::vault_set_token,
            keyring::vault_get_token,
            keyring::vault_delete_token,
            files::pick_audio_files,
            audio::audio_backend_available,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Groovium");
}
