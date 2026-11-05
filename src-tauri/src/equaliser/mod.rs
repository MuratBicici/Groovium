//! The equaliser, for everything this app plays, Spotify included.
//!
//! Spotify's Web Playback SDK is DRM-protected media: it cannot go through a Web
//! Audio graph, and it has no equaliser of its own. But the webview can capture
//! its own tab, DRM or not, and that capture is taken inside the browser, before
//! Windows or a sound card's effects have touched it. It can also silence the
//! tab's own output while it does. The webview sends that sound here over a
//! socket on this machine, and it is filtered and played from here, through the
//! sound card's effects once, as any other sound is. Local songs play in the same
//! tab, so one equaliser does for both.
//!
//! It used to be taken from Windows after the fact, with the webview's session
//! turned down. A sound card's effects had already been applied by then and were
//! applied again on the way out: measured on a machine with Nahimic, a tone came
//! out four decibels high from 500 Hz to 3 kHz at every setting. Over here, that
//! is gone by construction.
//!
//! Off or flat, nothing here runs and the tab is not captured, and the sound goes
//! the way it always went.
//!
//! What is captured is only ever in memory, in a buffer a fraction of a second
//! long on its way to the sound card. It is never written anywhere.

pub mod dsp;
#[cfg(windows)]
mod engine;

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering::SeqCst};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use dsp::Curve;

/// The event the webview hears when the equaliser has had to give up.
const FAILED: &str = "equaliser:failed";

/// Counted while it runs, and read by `equaliser_stats`.
pub struct Stats {
    frames: AtomicU64,
    underruns: AtomicU64,
    dropped: AtomicU64,
    trips: AtomicU64,
    limited: AtomicU64,
    peak: AtomicU32,
    fill_low: AtomicU64,
    fill_high: AtomicU64,
}

impl Default for Stats {
    fn default() -> Self {
        Stats {
            frames: AtomicU64::new(0),
            underruns: AtomicU64::new(0),
            dropped: AtomicU64::new(0),
            trips: AtomicU64::new(0),
            limited: AtomicU64::new(0),
            peak: AtomicU32::new(0),
            fill_low: AtomicU64::new(u64::MAX),
            fill_high: AtomicU64::new(0),
        }
    }
}

/// Where the webview is to send the sound, and the word it is to say.
#[derive(Serialize, Clone)]
pub struct Feed {
    port: u16,
    word: String,
}

/// What the threads of a run share with the commands.
pub struct Shared {
    curve: Mutex<Curve>,
    /// Where to send the sound, while a run is listening for it.
    feed: Mutex<Option<Feed>>,
    /// Whether the sound should be coming through here.
    wanted: AtomicBool,
    /// Whether the threads of a run should keep going.
    running: AtomicBool,
    /// Whether somebody is already looking after a run.
    attended: AtomicBool,
    failed: AtomicBool,
    /// The level to play what arrives at, as the bits of a float: nothing until
    /// sound is arriving, and one after.
    gain: AtomicU32,
    /// Everything but the sound itself: for measuring with nothing to hear.
    dry: AtomicBool,
    stats: Stats,
}

/// The app's one equaliser.
pub struct Equaliser(Arc<Shared>);

impl Default for Equaliser {
    fn default() -> Self {
        Equaliser(Arc::new(Shared {
            curve: Mutex::new(Curve::FLAT),
            feed: Mutex::new(None),
            wanted: AtomicBool::new(false),
            running: AtomicBool::new(false),
            attended: AtomicBool::new(false),
            failed: AtomicBool::new(false),
            gain: AtomicU32::new(0),
            // Debug builds only, so a measurement can never go near anybody's
            // ears, and no release can be talked into playing nothing.
            dry: AtomicBool::new(cfg!(debug_assertions) && std::env::var_os("GROOVIUM_EQ_DRY").is_some()),
            stats: Stats::default(),
        }))
    }
}

/// Whether the sound needs to come through here at all.
fn should_run(on: bool, curve: &Curve) -> bool {
    on && !curve.is_flat()
}

/// Set the equaliser. Off, or on and flat, the sound goes the way it always went.
#[tauri::command]
pub fn equaliser_set(
    app: AppHandle,
    equaliser: State<'_, Equaliser>,
    on: bool,
    preamp: f32,
    bands: Vec<f32>,
) -> Result<(), String> {
    let curve = Curve::from_page(preamp, &bands);
    let shared = &equaliser.0;
    if let Ok(mut held) = shared.curve.lock() {
        *held = curve;
    }
    let run = should_run(on, &curve);
    shared.wanted.store(run, SeqCst);
    if run {
        attend(app, shared.clone());
    }
    Ok(())
}

/// See that a run is going, on a thread of its own: commands run on the main
/// thread, and starting and stopping involve waiting on purpose.
fn attend(app: AppHandle, shared: Arc<Shared>) {
    if shared.attended.swap(true, SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        while shared.wanted.load(SeqCst) {
            #[cfg(windows)]
            let result = engine::run(&shared);
            #[cfg(not(windows))]
            let result: Result<(), String> = Err("per-process capture is a Windows interface".into());

            if let Err(err) = result {
                // The sound is back as it always was by now. Trying again
                // would be sound cutting in and out for no reason anybody knows.
                log::warn!("[equaliser] gave up: {err}");
                shared.wanted.store(false, SeqCst);
                let _ = app.emit(FAILED, err);
            }
        }
        shared.attended.store(false, SeqCst);
        // Asked for again in the moment between the loop ending and that line.
        if shared.wanted.load(SeqCst) {
            attend(app, shared);
        }
    });
}

/// Where to send the sound, once a run is listening. Nothing before that.
#[tauri::command]
pub fn equaliser_feed(equaliser: State<'_, Equaliser>) -> Option<Feed> {
    equaliser.0.feed.lock().ok().and_then(|feed| feed.clone())
}

/// What `equaliser_stats` answers. For measuring; nothing in the page reads it.
#[derive(Serialize)]
pub struct StatsNow {
    running: bool,
    frames: u64,
    underruns: u64,
    dropped: u64,
    trips: u64,
    limited: u64,
    peak: f32,
    fill_low_ms: f32,
    fill_high_ms: f32,
}

/// What has happened since last asked.
#[tauri::command]
pub fn equaliser_stats(equaliser: State<'_, Equaliser>) -> StatsNow {
    let shared = &equaliser.0;
    let stats = &shared.stats;
    let low = stats.fill_low.swap(u64::MAX, SeqCst);
    StatsNow {
        running: shared.running.load(SeqCst),
        frames: stats.frames.swap(0, SeqCst),
        underruns: stats.underruns.swap(0, SeqCst),
        dropped: stats.dropped.swap(0, SeqCst),
        trips: stats.trips.swap(0, SeqCst),
        limited: stats.limited.swap(0, SeqCst),
        peak: f32::from_bits(stats.peak.swap(0, SeqCst)),
        fill_low_ms: if low == u64::MAX { 0.0 } else { low as f32 / 48.0 },
        fill_high_ms: stats.fill_high.swap(0, SeqCst) as f32 / 48.0,
    }
}

/// Whatever a run left behind last time, put right. See `engine::is_ours`.
pub fn start(equaliser: &Equaliser) {
    #[cfg(windows)]
    engine::give_back_what_was_left(equaliser.0.clone());
    #[cfg(not(windows))]
    let _ = equaliser;
}

/// The app is closing: stop any run and wait for it to give the level back,
/// since the next thing to play in this webview's name may be another app.
pub fn finish(equaliser: &Equaliser) {
    let shared = &equaliser.0;
    shared.wanted.store(false, SeqCst);
    for _ in 0..40 {
        if !shared.attended.load(SeqCst) {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sound_only_comes_through_here_when_it_would_change_something() {
        let mut lifted = Curve::FLAT;
        lifted.bands[0] = 3.0;
        assert!(should_run(true, &lifted));
        assert!(!should_run(false, &lifted), "off is off");
        assert!(!should_run(true, &Curve::FLAT), "on and flat is the sound as it was");
    }

}
