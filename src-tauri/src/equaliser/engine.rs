//! Taking in the sound the webview sends over, filtering it, and playing it.
//!
//! See the module's own notes for why. Two threads while it runs: one takes the
//! sound off a socket on this machine, and one feeds the sound card. The webview
//! holds the capture and the switch that silences its own output, so everything
//! that ends a run here also tells it to let go: the way this fails must be into
//! the sound as it always was.

use std::collections::VecDeque;
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::Ordering::SeqCst;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use windows::core::Interface;
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioClient, IAudioRenderClient, IAudioSessionControl2, IAudioSessionManager2,
    IMMDevice, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator, AUDCLNT_SHAREMODE_SHARED,
    WAVEFORMATEX,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED};

use tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tungstenite::Message;

use super::dsp::{Chain, Gate, Pacer};
use super::Shared;
use crate::visualizer::{self, capture};

/// The level an earlier version held the webview's session at while the sound
/// came through here, by turning it down and capturing it after the fact. That
/// put a sound card's effects on the music twice, and is gone; but Windows keeps
/// a session's level, so a machine may still have this one to be put right.
const QUIET: f32 = 0.0001;

/// How much is kept between the capture and the sound card.
///
/// The webview sends ten milliseconds at a time and now and then two together,
/// so less than a few of them runs dry.
const RING_MS: usize = 40;
/// And how much is handed to the sound card ahead of time.
const RENDER_MS: u32 = 20;

/// Frames per millisecond at the rate everything runs at.
const PER_MS: usize = 48;

/// How often the threads waiting on something look up to see if it is still wanted.
const LOOK_EVERY: Duration = Duration::from_millis(100);
/// How often the sound card in use is checked against the current default.
const DEVICE_EVERY: Duration = Duration::from_secs(1);

/// `AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY`:
/// Windows converts from this rate to whatever the sound card runs at.
const CONVERT: u32 = 0x8000_0000 | 0x0800_0000;

fn com() {
    // Ignored on purpose, as in the capture: already set up is fine.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

fn default_device() -> Result<IMMDevice, String> {
    unsafe {
        let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("no device list: {e}"))?;
        devices
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("no sound card: {e}"))
    }
}

fn id_of(device: &IMMDevice) -> Option<String> {
    unsafe {
        let id = device.GetId().ok()?;
        let text = id.to_string().ok();
        CoTaskMemFree(Some(id.0.cast()));
        text
    }
}

/// The webview and everything under it, where the sound is played.
fn webview_tree(webview: u32) -> Vec<u32> {
    let Ok(all) = capture::processes() else { return vec![webview] };
    let mut tree = vec![webview];
    let mut at = 0;
    while at < tree.len() {
        let parent = tree[at];
        for (pid, of, _) in &all {
            if *of == parent && !tree.contains(pid) {
                tree.push(*pid);
            }
        }
        at += 1;
    }
    tree
}

/// Do something to each of the sessions of these processes.
fn each_session(pids: &[u32], mut act: impl FnMut(&ISimpleAudioVolume)) -> Result<(), String> {
    unsafe {
        let manager: IAudioSessionManager2 = default_device()?
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("no session manager: {e}"))?;
        let list = manager.GetSessionEnumerator().map_err(|e| format!("no session list: {e}"))?;
        for at in 0..list.GetCount().unwrap_or(0) {
            let Ok(session) = list.GetSession(at) else { continue };
            let Ok(control) = session.cast::<IAudioSessionControl2>() else { continue };
            if !pids.contains(&control.GetProcessId().unwrap_or(0)) {
                continue;
            }
            if let Ok(volume) = session.cast::<ISimpleAudioVolume>() {
                act(&volume);
            }
        }
        Ok(())
    }
}

fn levels_of(pids: &[u32]) -> Vec<f32> {
    let mut found = vec![];
    let _ = each_session(pids, |volume| {
        if let Ok(level) = unsafe { volume.GetMasterVolume() } {
            found.push(level);
        }
    });
    found
}

fn set_level(pids: &[u32], level: f32) {
    let _ = each_session(pids, |volume| unsafe {
        let _ = volume.SetMasterVolume(level, std::ptr::null());
    });
}

/// Whether a level is the one this module holds a session at, and no choice of
/// anybody's. Windows remembers a session's level, so a run ended by a crash or
/// a power cut leaves it there, and without this the app would come back silent.
fn is_ours(level: f32) -> bool {
    (level - QUIET).abs() < QUIET / 4.0
}

/// Put back a level this module left behind, the first time there is a session
/// to look at. They only exist once something has played.
pub fn give_back_what_was_left(shared: Arc<Shared>) {
    std::thread::spawn(move || {
        com();
        loop {
            std::thread::sleep(Duration::from_secs(2));
            if shared.wanted.load(SeqCst) {
                return;
            }
            // Looked for each time: this starts with the app, and the webview may
            // not be there yet. Looked for once, it gave up without a word, and
            // the app stayed silent with the level left behind.
            let Some(webview) = capture::webview_of(capture::me()) else { continue };
            let pids = webview_tree(webview);
            let levels = levels_of(&pids);
            if levels.is_empty() {
                continue;
            }
            if levels.iter().any(|level| is_ours(*level)) {
                log::info!("[equaliser] found the session left quiet, and gave its level back");
                set_level(&pids, 1.0);
            }
            return;
        }
    });
}

/// Whether a handshake is the webview's: it says the word it was given, from a
/// page of this app. Anything else on the machine can reach this port, and has no
/// business playing through it.
fn is_ours_to_hear(query: Option<&str>, origin: Option<&str>, word: &str) -> bool {
    let said = query.is_some_and(|query| query.split('&').any(|pair| pair.strip_prefix("word=") == Some(word)));
    let from_here = origin.is_some_and(|origin| {
        origin == "http://tauri.localhost"
            || origin == "https://tauri.localhost"
            || origin == "tauri://localhost"
            || origin.starts_with("http://localhost:")
    });
    said && from_here
}

/// One connection's sound, into the ring, until it closes or is no longer wanted.
// The refusal's size is tungstenite's, and it is only ever built once, to say no.
#[allow(clippy::result_large_err)]
fn hear(stream: TcpStream, word: &str, shared: &Shared, ring: &Mutex<VecDeque<[f32; 2]>>) -> Result<(), String> {
    stream.set_nonblocking(false).map_err(|e| e.to_string())?;
    stream.set_nodelay(true).map_err(|e| e.to_string())?;
    stream.set_read_timeout(Some(LOOK_EVERY)).map_err(|e| e.to_string())?;
    let mut socket = tungstenite::accept_hdr(stream, |request: &Request, response: Response| {
        let origin = request.headers().get("origin").and_then(|value| value.to_str().ok());
        if is_ours_to_hear(request.uri().query(), origin, word) {
            Ok(response)
        } else {
            let mut refused = ErrorResponse::new(None);
            *refused.status_mut() = tungstenite::http::StatusCode::FORBIDDEN;
            Err(refused)
        }
    })
    .map_err(|e| format!("handshake: {e}"))?;

    if let Ok(mut held) = ring.lock() {
        held.clear();
    }
    let mut opened = false;
    while shared.running.load(SeqCst) {
        match socket.read() {
            Ok(Message::Binary(bytes)) => {
                let Ok(mut held) = ring.lock() else { break };
                for frame in bytes.chunks_exact(8) {
                    let sample = |at: usize| f32::from_le_bytes([frame[at], frame[at + 1], frame[at + 2], frame[at + 3]]);
                    held.push_back([sample(0), sample(4)]);
                }
                drop(held);
                if !opened {
                    opened = true;
                    shared.gain.store(1_f32.to_bits(), SeqCst);
                }
            }
            Ok(Message::Close(_)) => break,
            Ok(_) => {}
            Err(tungstenite::Error::Io(err))
                if matches!(err.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
            Err(_) => break,
        }
    }
    shared.gain.store(0_f32.to_bits(), SeqCst);
    Ok(())
}

/// The socket: one listener for the run, one connection at a time.
fn listen_for_sound(
    listener: TcpListener,
    word: String,
    shared: &Arc<Shared>,
    ring: &Arc<Mutex<VecDeque<[f32; 2]>>>,
) -> Result<(), String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    while shared.running.load(SeqCst) {
        match listener.accept() {
            Ok((stream, _)) => {
                if let Err(err) = hear(stream, &word, shared, ring) {
                    log::warn!("[equaliser] {err}");
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(LOOK_EVERY),
            Err(err) => return Err(err.to_string()),
        }
    }
    Ok(())
}

/// A word nobody else could guess, for the webview to say.
fn new_word() -> Result<String, String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// One run: until it is no longer wanted, or something fails.
pub fn run(shared: &Arc<Shared>) -> Result<(), String> {
    com();
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| format!("no socket: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let word = new_word()?;
    if let Ok(mut feed) = shared.feed.lock() {
        *feed = Some(super::Feed { port, word: word.clone() });
    }

    let ring = Arc::new(Mutex::new(VecDeque::<[f32; 2]>::with_capacity(RATE_FRAMES)));
    shared.gain.store(0_f32.to_bits(), SeqCst);
    shared.running.store(true, SeqCst);
    shared.failed.store(false, SeqCst);

    let reader = {
        let (shared, ring) = (shared.clone(), ring.clone());
        std::thread::spawn(move || {
            if let Err(err) = listen_for_sound(listener, word, &shared, &ring) {
                log::warn!("[equaliser] the socket stopped: {err}");
                shared.failed.store(true, SeqCst);
            }
        })
    };

    let feeder = {
        let (shared, ring) = (shared.clone(), ring.clone());
        std::thread::spawn(move || {
            if let Err(err) = feed(&shared, &ring) {
                log::warn!("[equaliser] the sound card stopped: {err}");
                shared.failed.store(true, SeqCst);
            }
        })
    };

    while shared.wanted.load(SeqCst) && !shared.failed.load(SeqCst) {
        std::thread::sleep(LOOK_EVERY);
    }

    // Down first and out after, so it goes rather than stops.
    shared.gain.store(0_f32.to_bits(), SeqCst);
    std::thread::sleep(Duration::from_millis(130));
    shared.running.store(false, SeqCst);
    if let Ok(mut feed) = shared.feed.lock() {
        *feed = None;
    }
    let _ = reader.join();
    let _ = feeder.join();

    if shared.failed.load(SeqCst) {
        return Err("it stopped by itself".into());
    }
    Ok(())
}

/// A second of frames, as a buffer's first size.
const RATE_FRAMES: usize = 48_000;

/// The sound card thread, opening it again whenever it goes away.
fn feed(shared: &Arc<Shared>, ring: &Arc<Mutex<VecDeque<[f32; 2]>>>) -> Result<(), String> {
    com();
    let mut failures = 0;
    while shared.running.load(SeqCst) {
        match feed_one_device(shared, ring) {
            Ok(()) => failures = 0,
            Err(err) => {
                failures += 1;
                log::warn!("[equaliser] {err}");
                // A plug being pulled is one failure or two. Many in a row is a
                // machine that cannot do this, and the sound belongs back where
                // it came from.
                if failures >= 5 {
                    return Err(err);
                }
                std::thread::sleep(Duration::from_millis(200));
            }
        }
    }
    Ok(())
}

/// Feed the current sound card until it is not the default any more, or fails.
fn feed_one_device(shared: &Arc<Shared>, ring: &Arc<Mutex<VecDeque<[f32; 2]>>>) -> Result<(), String> {
    unsafe {
        let device = default_device()?;
        let device_id = id_of(&device);
        let client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(|e| format!("no client: {e}"))?;
        let format = WAVEFORMATEX {
            wFormatTag: 3,
            nChannels: capture::CHANNELS,
            nSamplesPerSec: capture::RATE,
            wBitsPerSample: 32,
            nBlockAlign: capture::CHANNELS * 4,
            nAvgBytesPerSec: capture::RATE * u32::from(capture::CHANNELS) * 4,
            cbSize: 0,
        };
        // A tenth of a second of room; `RENDER_MS` is how much of it is used.
        client
            .Initialize(AUDCLNT_SHAREMODE_SHARED, CONVERT, 1_000_000, 0, &format, None)
            .map_err(|e| format!("could not open the sound card: {e}"))?;
        let size = client.GetBufferSize().map_err(|e| e.to_string())?;
        let render: IAudioRenderClient = client.GetService().map_err(|e| e.to_string())?;
        client.Start().map_err(|e| format!("could not start: {e}"))?;

        let mut gate = Gate::default();
        let mut pacer = Pacer::new(RING_MS * PER_MS);
        let mut chain = Chain::new(*shared.curve.lock().map_err(|_| "curve lock")?);
        let ahead = RENDER_MS * PER_MS as u32;
        let mut checked = Instant::now();
        let mut heard = Vec::with_capacity(ahead as usize);

        while shared.running.load(SeqCst) {
            std::thread::sleep(Duration::from_millis(1));
            if checked.elapsed() >= DEVICE_EVERY {
                checked = Instant::now();
                let now = default_device().ok().and_then(|device| id_of(&device));
                if now.is_some() && now != device_id {
                    log::info!("[equaliser] following the default sound card");
                    break;
                }
            }

            let padding = client.GetCurrentPadding().map_err(|e| format!("the sound card went away: {e}"))?;
            if padding >= ahead {
                continue;
            }
            let wanted = (ahead - padding).min(size - padding) as usize;
            if wanted == 0 {
                continue;
            }

            if let Ok(curve) = shared.curve.lock() {
                chain.want(*curve);
            }
            chain.steer();

            let target = f64::from(f32::from_bits(shared.gain.load(SeqCst)));
            let silent = shared.dry.load(SeqCst);
            let buffer = render.GetBuffer(wanted as u32).map_err(|e| format!("no buffer: {e}"))?;
            let out = std::slice::from_raw_parts_mut(buffer.cast::<f32>(), wanted * 2);

            let stats = &shared.stats;
            let mut written = 0;
            let mut peak = f32::from_bits(stats.peak.load(SeqCst));
            heard.clear();
            {
                let mut held = ring.lock().map_err(|_| "ring lock")?;
                let fill = held.len() as u64;
                stats.fill_low.fetch_min(fill, SeqCst);
                stats.fill_high.fetch_max(fill, SeqCst);
                pacer.read(&mut held, wanted, |frame| {
                    let opened = gate.run(target, frame);
                    let [left, right] = chain.run(opened);
                    peak = peak.max(left.abs()).max(right.abs());
                    heard.push((left + right) / 2.0);
                    let keep = if silent { 0.0 } else { 1.0 };
                    out[written] = left * keep;
                    out[written + 1] = right * keep;
                    written += 2;
                });
            }
            // Nothing else can tell the visualiser: the webview's own output is
            // silent while this runs, which is also what the player's check that
            // sound is coming out goes by.
            visualizer::hear(&heard);
            stats.peak.store(peak.to_bits(), SeqCst);
            stats.frames.fetch_add(wanted as u64, SeqCst);
            stats.underruns.fetch_add(std::mem::take(&mut pacer.underruns), SeqCst);
            stats.dropped.fetch_add(std::mem::take(&mut pacer.dropped), SeqCst);
            stats.trips.fetch_add(std::mem::take(&mut gate.trips), SeqCst);
            stats.limited.fetch_add(std::mem::take(&mut chain.limited), SeqCst);

            render.ReleaseBuffer(wanted as u32, 0).map_err(|e| format!("could not hand it over: {e}"))?;
        }

        let _ = client.Stop();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_level_an_earlier_version_held_counts_as_left_behind() {
        assert!(is_ours(QUIET));
        assert!(!is_ours(0.0), "somebody turning it right down is their choice");
        assert!(!is_ours(0.01));
        assert!(!is_ours(1.0));
    }

    #[test]
    fn only_this_apps_page_with_the_right_word_is_heard() {
        let page = Some("http://tauri.localhost");
        assert!(is_ours_to_hear(Some("word=abc"), page, "abc"));
        assert!(is_ours_to_hear(Some("x=1&word=abc"), Some("http://localhost:1420"), "abc"));
        assert!(!is_ours_to_hear(Some("word=abd"), page, "abc"), "the wrong word");
        assert!(!is_ours_to_hear(None, page, "abc"), "no word");
        assert!(!is_ours_to_hear(Some("word=abc"), Some("https://example.com"), "abc"), "somebody else's page");
        assert!(!is_ours_to_hear(Some("word=abc"), None, "abc"), "no page at all");
    }

    #[test]
    fn a_word_is_new_each_time() {
        let word = new_word().expect("a word");
        assert_eq!(word.len(), 32);
        assert_ne!(word, new_word().expect("another"));
    }
}
