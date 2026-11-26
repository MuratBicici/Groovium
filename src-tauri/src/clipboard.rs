//! The clipboard's text, for Paste in the app's right-click menu.
//!
//! The page can ask for it itself (`navigator.clipboard.readText`), and the
//! webview answers that with a permission prompt — "localhost wants to see text
//! and images copied to the clipboard" — over a music player, every time
//! someone pastes into the search. Read from here it is the same text, asked of
//! Windows by the app the person is using.

/// The text on the clipboard, or an empty string when there is none.
#[tauri::command]
pub fn clipboard_text() -> Result<String, String> {
    read()
}

#[cfg(windows)]
fn read() -> Result<String, String> {
    use windows::Win32::Foundation::{HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};
    use windows::Win32::System::Ole::CF_UNICODETEXT;

    let format = u32::from(CF_UNICODETEXT.0);
    // Somebody else can be holding it for a moment: another app writing to it.
    let mut open = false;
    for _ in 0..5 {
        if unsafe { OpenClipboard(None) }.is_ok() {
            open = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    if !open {
        return Err("the clipboard is busy".into());
    }

    let text = (|| {
        if unsafe { IsClipboardFormatAvailable(format) }.is_err() {
            return Ok(String::new());
        }
        let handle: HANDLE = unsafe { GetClipboardData(format) }.map_err(|e| e.to_string())?;
        let memory = HGLOBAL(handle.0);
        let at = unsafe { GlobalLock(memory) } as *const u16;
        if at.is_null() {
            return Err("could not read the clipboard".to_string());
        }
        // Safety: CF_UNICODETEXT is a NUL-terminated UTF-16 string, and the
        // memory stays locked until it has been copied out.
        let text = unsafe {
            let mut len = 0;
            while *at.add(len) != 0 {
                len += 1;
            }
            String::from_utf16_lossy(std::slice::from_raw_parts(at, len))
        };
        let _ = unsafe { GlobalUnlock(memory) };
        Ok(text)
    })();

    let _ = unsafe { CloseClipboard() };
    text
}

#[cfg(not(windows))]
fn read() -> Result<String, String> {
    // The page reads it itself there.
    Err("unsupported".into())
}
