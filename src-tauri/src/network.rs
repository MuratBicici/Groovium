//! Whether this computer can reach the internet, as Windows sees it.
//!
//! The webview's own answer is `navigator.onLine`, and on a great many
//! machines it never says no. It is true while any network adapter is up, and
//! virtual ones always are: VMware's, Hyper-V's, WSL's, Docker's, a VPN's. On
//! one of those, switching the Wi-Fi off left the app sure it was online, and
//! the Spotify side went on offering shelves that could not play.
//!
//! Windows knows better — it is what puts "No internet" on the taskbar — and
//! the Network List Manager will say so to anyone who asks, without sending
//! anything anywhere. Asked every couple of seconds on a thread of its own, the
//! way `onscreen` asks about the window: a change takes a moment to arrive,
//! and an answer that goes missing is said again shortly.
//!
//! What it says is only ever a reason to look harder, not the last word. The
//! webview checks for itself whenever this says there is no internet — see
//! `src/platform/online.ts` — because the test Windows runs can be blocked on
//! a network that reaches everything else.

use std::sync::atomic::{AtomicU8, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter};

/// What the webview listens for: true while Windows says there is internet.
const EVENT: &str = "network:internet";

/// How often to ask.
const ASK_EVERY: Duration = Duration::from_secs(2);

/// How many asks between saying the same thing again; see `onscreen`.
const SAY_AGAIN_EVERY: u32 = 8;

/// The last answer: nought for none yet, one for internet, two for none.
static LAST: AtomicU8 = AtomicU8::new(0);

/// What Windows last said, for the webview to start from: `None` until it has
/// said anything, and always on a system that cannot be asked.
#[tauri::command]
pub fn network_internet() -> Option<bool> {
    match LAST.load(Ordering::Relaxed) {
        1 => Some(true),
        2 => Some(false),
        _ => None,
    }
}

/// Watch for as long as the app runs, and say so when the answer changes.
pub fn watch(app: AppHandle) {
    std::thread::spawn(move || {
        let Some(ask) = asker() else {
            log::info!("Windows cannot be asked about the internet; going by the webview");
            return;
        };
        let mut said: Option<bool> = None;
        let mut asks: u32 = 0;
        loop {
            if let Some(internet) = ask() {
                LAST.store(if internet { 1 } else { 2 }, Ordering::Relaxed);
                asks = asks.wrapping_add(1);
                if said != Some(internet) {
                    let what = if internet { "there is" } else { "there is no" };
                    log::info!("Windows says {what} internet");
                }
                if said != Some(internet) || asks % SAY_AGAIN_EVERY == 0 {
                    said = Some(internet);
                    let _ = app.emit(EVENT, internet);
                }
            }
            std::thread::sleep(ASK_EVERY);
        }
    });
}

/// Something to ask with, made once on the watching thread.
#[cfg(windows)]
fn asker() -> Option<impl Fn() -> Option<bool>> {
    use windows::Win32::Networking::NetworkListManager::{
        INetworkListManager, NetworkListManager, NLM_CONNECTIVITY_IPV4_INTERNET,
        NLM_CONNECTIVITY_IPV6_INTERNET,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    // Safety: this thread is ours and lives as long as the app; joining the
    // multithreaded apartment once at its start is all COM asks of it, and the
    // manager made here is only ever used from this same thread.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let manager: INetworkListManager =
            CoCreateInstance(&NetworkListManager, None, CLSCTX_ALL).ok()?;
        Some(move || {
            let connectivity = manager.GetConnectivity().ok()?;
            let internet = NLM_CONNECTIVITY_IPV4_INTERNET.0 | NLM_CONNECTIVITY_IPV6_INTERNET.0;
            Some(connectivity.0 & internet != 0)
        })
    }
}

#[cfg(not(windows))]
fn asker() -> Option<fn() -> Option<bool>> {
    None
}

#[cfg(test)]
mod tests {
    /// Asks the real Windows of the machine it runs on, so it is not part of
    /// the ordinary run: `cargo test -- --ignored windows_can_be_asked`.
    #[test]
    #[ignore = "asks this machine's Windows"]
    #[cfg(windows)]
    fn windows_can_be_asked() {
        let ask = super::asker().expect("the Network List Manager is there");
        let said = ask().expect("it answers");
        println!("Windows says internet: {said}");
    }
}
