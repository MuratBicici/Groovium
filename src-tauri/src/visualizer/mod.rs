//! Listening to this app's own audio, and nothing else's.
//!
//! The visualiser behind the deck needs a spectrum, and there is no way to get
//! one from inside the webview. What this app mostly plays comes out of
//! Spotify's Web Playback SDK, which is DRM-protected media: it cannot be
//! routed through a Web Audio graph, so a browser-side `AnalyserNode` reads
//! silence from it forever. Asking Spotify to describe the track instead is
//! closed too — `/audio-features` and `/audio-analysis` answer 403 to this
//! app, measured against a real track id rather than assumed.
//!
//! Reading the machine's output device would work and is what a first attempt
//! did, but it is far more than an ornament in this app has any business
//! hearing: every other window on the computer goes through it.
//!
//! Windows can narrow that to one process tree. `ActivateAudioInterfaceAsync`
//! against the virtual `VAD\Process_Loopback` device, given our own process id
//! and `INCLUDE_TARGET_PROCESS_TREE`, hands over exactly what this app and its
//! children render — and the WebView2 processes that play Spotify's audio are
//! our children. Nothing else on the machine is in it.
//!
//! Two things about that are unknown until it is run on a real machine, which
//! is what `visualizer_probe` is for: whether the interface activates at all
//! (it needs Windows 10 build 20348 or later), and whether DRM-protected audio
//! reaches a loopback client or is excluded from one. Neither is worth
//! guessing at, and a visualiser was built on a guess once already.

#[cfg(windows)]
mod capture;

/// What a listen found, or why it could not listen.
#[derive(serde::Serialize, Default)]
pub struct Probe {
    /// Whether the interface activated and delivered any buffer at all.
    pub captured: bool,
    /// The loudest sample seen, 0..=1. Zero with `captured` true means the
    /// stream is there and silent — which is the answer that matters for DRM.
    pub peak: f32,
    /// How many audio frames arrived. Zero means nothing was rendering.
    pub frames: u64,
    /// How many buffers those frames came in.
    pub packets: u64,
    /// How many of those Windows marked as holding nothing.
    ///
    /// All of them means the stream is running and no one is rendering into it,
    /// which is not the same as audio arriving quiet — and only the first is
    /// evidence about which process tree the sound is actually in.
    pub silent_packets: u64,
    pub sample_rate: u32,
    pub channels: u16,
    /// Present only when something went wrong, and then it says what.
    pub error: Option<String>,
}

/// Listen to this app's own audio for a moment and report what came through.
///
/// Deliberately a one-shot question rather than the visualiser itself. The two
/// unknowns above decide whether a visualiser is possible at all, and the
/// honest order is to find out first.
#[tauri::command]
pub fn visualizer_probe(millis: u64, ours: bool, target: Option<u32>) -> Probe {
    #[cfg(windows)]
    {
        match capture::listen(millis.clamp(200, 5_000), ours, target) {
            Ok(probe) => probe,
            Err(error) => Probe { error: Some(error), ..Probe::default() },
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (millis, ours, target);
        Probe {
            error: Some("per-process capture is a Windows interface".into()),
            ..Probe::default()
        }
    }
}

/// This app's own process id and every WebView2 process on the machine.
///
/// Which of them is playing the music is the question the readings left open:
/// this app's tree renders nothing while everything outside it renders the
/// track, so the process doing it is a WebView2 one that is not under us. This
/// says which ones exist and who their parents are, so the right one can be
/// aimed at rather than guessed.
#[tauri::command]
pub fn visualizer_processes() -> ProcessList {
    #[cfg(windows)]
    {
        let all = capture::processes().unwrap_or_default();
        let mine = capture::me();
        let parent = all.iter().find(|(pid, _, _)| *pid == mine).map(|&(_, p, _)| p);
        ProcessList {
            me: mine,
            parent,
            webviews: all
                .iter()
                .filter(|(_, _, name)| name.to_ascii_lowercase().contains("webview"))
                .map(|&(pid, parent, ref name)| (pid, parent, name.clone()))
                .collect(),
        }
    }
    #[cfg(not(windows))]
    {
        ProcessList::default()
    }
}

#[derive(serde::Serialize, Default)]
pub struct ProcessList {
    pub me: u32,
    pub parent: Option<u32>,
    /// Every process whose name mentions a webview, as id, parent and name.
    pub webviews: Vec<(u32, u32, String)>,
}
