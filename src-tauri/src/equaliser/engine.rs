//! Taking this app's sound out of the webview, filtering it, and playing it.
//!
//! See the module's own notes for why. Three threads while it runs: one reads
//! the capture, one feeds the sound card, and one holds the session quiet and
//! notices when something has gone wrong. Everything that ends a run ends here,
//! with the session given back its level, because the way this fails must be
//! into the sound as it always was.

use std::collections::VecDeque;
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

use super::dsp::{Chain, Gate, Pacer};
use super::{set_capture_scale, Shared};
use crate::visualizer::capture;

/// How quiet the webview's session is held while the sound comes through here.
///
/// Eighty decibels down. It cannot be muted instead: that was measured, and a
/// muted session captures nothing at all. Turned down, the capture comes back
/// exactly in proportion, in floating point, so bringing it up again loses
/// nothing, and what still reaches the sound card directly is too quiet to hear.
pub const QUIET: f32 = 0.0001;

/// How much is kept between the capture and the sound card.
///
/// The capture arrives in packets of ten milliseconds and now and then two
/// together, so less than a few of them runs dry. All of it is added to the
/// delay of about eighty milliseconds that Windows's own route already has.
const RING_MS: usize = 40;
/// And how much is handed to the sound card ahead of time.
const RENDER_MS: u32 = 20;

/// Frames per millisecond at the rate everything runs at.
const PER_MS: usize = 48;

/// How often the sessions and the running threads are looked at.
const LOOK_EVERY: Duration = Duration::from_millis(250);
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
        let Some(webview) = capture::webview_of(capture::me()) else { return };
        loop {
            std::thread::sleep(Duration::from_secs(2));
            if shared.wanted.load(SeqCst) {
                return;
            }
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

/// From the sound as it comes, down to the session quiet, and the gain open.
///
/// In this order and with these waits because getting it wrong hurts. The gain
/// is shut first. The session goes down in steps rather than at once, so there
/// is a dip and not a cut. Then a wait, for what was captured before it was
/// quiet to have arrived, and `open` does the rest.
fn enter(shared: &Shared, ring: &Mutex<VecDeque<[f32; 2]>>, pids: &[u32], prior: f32) {
    shared.gain.store(0_f32.to_bits(), SeqCst);
    set_capture_scale(1.0);
    for step in 1..=6 {
        set_level(pids, prior * (1.0 - step as f32 / 6.0));
        std::thread::sleep(Duration::from_millis(25));
    }
    set_level(pids, QUIET);
    std::thread::sleep(Duration::from_millis(200));
    open(shared, ring, prior);
}

/// With the session known to be quiet: the buffer emptied of anything from
/// before, and the gain opened, gradually, with the gate watching every frame.
fn open(shared: &Shared, ring: &Mutex<VecDeque<[f32; 2]>>, prior: f32) {
    if let Ok(mut held) = ring.lock() {
        held.clear();
    }
    set_capture_scale(1.0 / QUIET);
    shared.gain.store((prior / QUIET).to_bits(), SeqCst);
}

/// What to do about the sessions found, given whether the gain is open.
#[derive(Debug, PartialEq, Eq)]
enum Look {
    /// All quiet and the gain open: nothing.
    Carry,
    /// Nobody to be sure of: a session appearing now would appear at full level
    /// under an open gain, and the start of a song fading in would come through
    /// the guard at full scale. So it stays shut until there is one to look at.
    Shut,
    /// All quiet, with the gain shut: open it.
    Open,
    /// One is not quiet: it has just appeared, or somebody moved the mixer.
    TurnDown,
}

fn look(levels: &[f32], opened: bool) -> Look {
    if levels.is_empty() {
        return if opened { Look::Shut } else { Look::Carry };
    }
    if levels.iter().any(|level| !is_ours(*level)) {
        return Look::TurnDown;
    }
    if opened {
        Look::Carry
    } else {
        Look::Open
    }
}

/// Back to the sound as it comes: the gain all the way down first, and only
/// then the session up. The other way round is what `enter` is careful about.
fn leave(shared: &Shared, pids: &[u32], prior: f32) {
    shared.gain.store(0_f32.to_bits(), SeqCst);
    set_capture_scale(1.0);
    std::thread::sleep(Duration::from_millis(130));
    for step in 1..=6 {
        set_level(pids, prior * step as f32 / 6.0);
        std::thread::sleep(Duration::from_millis(25));
    }
}

/// Gives the session its level back however the run ends, panics included.
struct GiveBack {
    webview: u32,
    prior: Arc<Mutex<f32>>,
}

impl Drop for GiveBack {
    fn drop(&mut self) {
        set_capture_scale(1.0);
        let level = self.prior.lock().map_or(1.0, |held| *held);
        set_level(&webview_tree(self.webview), level);
    }
}

/// One run: until it is no longer wanted, or something fails.
pub fn run(shared: &Arc<Shared>) -> Result<(), String> {
    com();
    let webview = capture::webview_of(capture::me()).ok_or("no webview to listen to")?;
    let mut pids = webview_tree(webview);

    let found = levels_of(&pids);
    // A level left behind is not one to go back to.
    let mut prior = found.iter().copied().find(|level| !is_ours(*level)).unwrap_or(1.0);
    let held_prior = Arc::new(Mutex::new(prior));
    let give_back = GiveBack { webview, prior: held_prior.clone() };

    let ring = Arc::new(Mutex::new(VecDeque::<[f32; 2]>::with_capacity(RATE_FRAMES)));
    shared.running.store(true, SeqCst);
    shared.failed.store(false, SeqCst);

    let reader = {
        let (shared, ring) = (shared.clone(), ring.clone());
        std::thread::spawn(move || {
            let result = capture::listen(webview, &|| shared.running.load(SeqCst), &mut |samples| {
                let Ok(mut held) = ring.lock() else { return };
                for frame in samples.chunks(capture::CHANNELS as usize) {
                    if let [left, right] = frame {
                        held.push_back([*left, *right]);
                    }
                }
            });
            if let Err(err) = result {
                log::warn!("[equaliser] the capture stopped: {err}");
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

    let mut opened = false;
    let mut first = true;
    while shared.wanted.load(SeqCst) && !shared.failed.load(SeqCst) {
        if !first {
            std::thread::sleep(LOOK_EVERY);
        }
        first = false;
        pids = webview_tree(webview);
        let levels = levels_of(&pids);
        match look(&levels, opened) {
            Look::Carry => {}
            Look::Shut => {
                shared.gain.store(0_f32.to_bits(), SeqCst);
                set_capture_scale(1.0);
                opened = false;
            }
            Look::Open => {
                open(shared, &ring, prior);
                opened = true;
            }
            Look::TurnDown => {
                // The level they are to hear, unless it is the one left behind.
                if let Some(level) = levels.iter().copied().find(|level| !is_ours(*level)) {
                    prior = level;
                    if let Ok(mut held) = held_prior.lock() {
                        *held = level;
                    }
                }
                enter(shared, &ring, &pids, prior);
                opened = true;
            }
        }
    }

    leave(shared, &pids, prior);
    shared.running.store(false, SeqCst);
    let _ = reader.join();
    let _ = feeder.join();
    drop(give_back);

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
            {
                let mut held = ring.lock().map_err(|_| "ring lock")?;
                let fill = held.len() as u64;
                stats.fill_low.fetch_min(fill, SeqCst);
                stats.fill_high.fetch_max(fill, SeqCst);
                pacer.read(&mut held, wanted, |frame| {
                    let opened = gate.run(target, frame);
                    let [left, right] = chain.run(opened);
                    peak = peak.max(left.abs()).max(right.abs());
                    let keep = if silent { 0.0 } else { 1.0 };
                    out[written] = left * keep;
                    out[written + 1] = right * keep;
                    written += 2;
                });
            }
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
    fn the_gain_is_never_open_with_no_session_to_be_sure_of() {
        // With nothing played yet there is no session. Open then, the first one
        // to appear would come through ten thousand times too loud.
        assert_eq!(look(&[], false), Look::Carry, "stays shut");
        assert_eq!(look(&[], true), Look::Shut, "and shuts if they all go");
    }

    #[test]
    fn a_session_appearing_at_full_level_is_turned_down_before_anything_opens() {
        assert_eq!(look(&[1.0], false), Look::TurnDown);
        assert_eq!(look(&[QUIET, 1.0], true), Look::TurnDown);
    }

    #[test]
    fn a_session_already_quiet_needs_only_the_gain() {
        assert_eq!(look(&[QUIET], false), Look::Open);
        assert_eq!(look(&[QUIET], true), Look::Carry);
    }

    #[test]
    fn only_the_level_this_holds_counts_as_its_own() {
        assert!(is_ours(QUIET));
        assert!(!is_ours(0.0), "somebody turning it right down is their choice");
        assert!(!is_ours(0.01));
        assert!(!is_ours(1.0));
    }
}
