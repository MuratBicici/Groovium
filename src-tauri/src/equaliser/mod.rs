//! The equaliser, for everything this app plays, Spotify included.
//!
//! Spotify's Web Playback SDK is DRM-protected media: it cannot go through a Web
//! Audio graph, and it has no equaliser of its own. So the sound is met on its
//! way out instead. The webview's session is turned down until it cannot be
//! heard, the per-process capture the visualiser uses is brought back up by the
//! same amount, and what comes out of that is filtered and played from here.
//! Local songs play in the same webview, so one equaliser does for both.
//!
//! All of it was measured before it was built. A muted session captures nothing;
//! a session turned down captures exactly in proportion, down to a hundred
//! thousandth of its level. The route adds about a hundred milliseconds, which
//! is why it is off the road entirely while the equaliser is off or flat: the
//! sound then goes the way it always went, and nothing here is running.
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

/// What the capture has to be multiplied by to be at the level it is played.
///
/// One unless a run has the session turned down. The visualiser reads the same
/// capture, and without this its bars would drop to nothing.
static CAPTURE_SCALE: AtomicU32 = AtomicU32::new(0x3F80_0000);

/// See `CAPTURE_SCALE`.
pub fn capture_scale() -> f32 {
    f32::from_bits(CAPTURE_SCALE.load(SeqCst))
}

#[cfg(windows)]
fn set_capture_scale(scale: f32) {
    CAPTURE_SCALE.store(scale.to_bits(), SeqCst);
}

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

/// What the threads of a run share with the commands.
pub struct Shared {
    curve: Mutex<Curve>,
    /// Whether the sound should be coming through here.
    wanted: AtomicBool,
    /// Whether the threads of a run should keep going.
    running: AtomicBool,
    /// Whether somebody is already looking after a run.
    attended: AtomicBool,
    failed: AtomicBool,
    /// The gain to bring the capture back up by, as the bits of a float.
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

    #[test]
    fn the_capture_is_at_its_own_level_unless_a_run_says_otherwise() {
        assert_eq!(capture_scale(), 1.0);
    }
}
