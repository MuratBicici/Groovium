//! Listening to this app's own audio, and nothing else's.
//!
//! The visualiser behind the deck needs a spectrum, and there is no way to get
//! one from inside the webview. What this app mostly plays comes out of
//! Spotify's Web Playback SDK, which is DRM-protected media: it cannot be
//! routed through a Web Audio graph, so a browser-side `AnalyserNode` reads
//! silence from it forever. Asking Spotify to describe the track instead is
//! closed too — `/audio-features` and `/audio-analysis` both answer 403 to this
//! app, measured against a real, public track id rather than assumed.
//!
//! Reading the machine's output device would work, and a first attempt did
//! exactly that, but it hears every other window on the computer and is far
//! more than an ornament here has any business hearing.
//!
//! Windows will narrow a loopback client to one process tree, and that is the
//! whole of the answer: `ActivateAudioInterfaceAsync` against the virtual
//! `VAD\Process_Loopback` device, aimed at the WebView2 process this app
//! started. Both sources play there — Spotify's SDK and the local player's own
//! `<audio>` element are both in the webview — so it is exactly this app's
//! sound and nothing else's.
//!
//! Which process took measuring. Aiming at this app's own id with the tree
//! included captures silence while it is playing; aiming at its WebView2 child
//! captures the music. Whatever the audio engine means by a process tree, it is
//! not the parent chain, so the browser process is named rather than reached
//! through.

mod bands;
#[cfg(windows)]
mod capture;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rustfft::{num_complex::Complex, FftPlanner};
use tauri::{AppHandle, Emitter};

use bands::BARS;

/// How many samples one frame of the spectrum is computed from.
///
/// At 48kHz this is 43ms of sound and 23Hz per bin. Halving it would blur the
/// bass bars into each other; doubling it would make every bar lag the music by
/// a twelfth of a second, which is visible.
const WINDOW: usize = 2048;

/// What the capture is asked for, and so what the spectrum is computed against.
const RATE: u32 = 48_000;

/// How often a frame is sent.
///
/// Sixty, having been thirty. Thirty was chosen when the only thing listening
/// was a wall of blocks behind the deck, where half a frame of lag is nothing.
/// The window's edge answers to the hits in the music instead, and there the
/// wait between frames *is* the lag — a kick landing up to a thirtieth of a
/// second after it was played is a light that follows the music rather than
/// keeping time with it.
///
/// The cost is one more array of two dozen floats over the bridge per frame,
/// against a spectrum that was already being computed.
const FRAME: Duration = Duration::from_millis(16);

/// The event the webview listens on. One array of `BARS` floats in 0..=1.
const EVENT: &str = "visualizer:bars";

/// Whether the capture should keep going.
#[derive(Default)]
pub struct Running(Arc<AtomicBool>);

/// The most recent samples, mixed down to mono.
///
/// The capture writes it and the frame loop reads it. They run at different
/// rates — buffers arrive every few milliseconds, frames go out thirty times a
/// second — so the samples have to be kept somewhere between them.
struct Ring {
    samples: Vec<f32>,
    at: usize,
}

impl Ring {
    fn new() -> Self {
        Self { samples: vec![0.0; WINDOW], at: 0 }
    }

    fn push(&mut self, value: f32) {
        self.samples[self.at] = value;
        self.at = (self.at + 1) % WINDOW;
    }

    /// The window in order, oldest first, into a buffer the caller keeps.
    fn window(&self, into: &mut Vec<f32>) {
        into.clear();
        let (head, tail) = self.samples.split_at(self.at);
        into.extend_from_slice(tail);
        into.extend_from_slice(head);
    }
}

/// Start listening to this app's audio, if it is not already being listened to.
///
/// Never fatal. A Windows too old for per-process capture, or a webview that
/// has not started yet, simply gets no bars — an ornament must not be able to
/// stop the app playing music.
#[tauri::command]
pub fn visualizer_start(app: AppHandle, running: tauri::State<'_, Running>) {
    let flag = running.0.clone();
    if flag.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        if let Err(err) = run(&app, &flag) {
            eprintln!("[visualizer] {err}");
        }
        flag.store(false, Ordering::SeqCst);
        // One last frame of nothing, so whatever was on screen falls away
        // rather than freezing at the height it had when the sound stopped.
        let _ = app.emit(EVENT, vec![0.0_f32; BARS]);
    });
}

#[tauri::command]
pub fn visualizer_stop(running: tauri::State<'_, Running>) {
    running.0.store(false, Ordering::SeqCst);
}

#[cfg(not(windows))]
fn run(_app: &AppHandle, _running: &AtomicBool) -> Result<(), String> {
    Err("per-process capture is a Windows interface".into())
}

#[cfg(windows)]
fn run(app: &AppHandle, running: &AtomicBool) -> Result<(), String> {
    let me = capture::me();
    let webview =
        capture::webview_of(me).ok_or_else(|| format!("no webview under {me} to listen to"))?;

    let ring = Arc::new(Mutex::new(Ring::new()));

    // The spectrum runs on its own thread rather than between buffers. The
    // capture loop is what keeps up with the audio engine, and an FFT in the
    // middle of it would put a thousand points of work between Windows and the
    // next buffer it wants read.
    let painting = Arc::new(AtomicBool::new(true));
    let frames = {
        let painting = painting.clone();
        let reader = ring.clone();
        let app = app.clone();
        std::thread::spawn(move || {
            let mut spectrum = Spectrum::new();
            let mut window = Vec::with_capacity(WINDOW);
            while painting.load(Ordering::SeqCst) {
                std::thread::sleep(FRAME);
                {
                    let Ok(ring) = reader.lock() else { break };
                    ring.window(&mut window);
                }
                if app.emit(EVENT, spectrum.of(&window)).is_err() {
                    break;
                }
            }
        })
    };

    let writer = ring.clone();
    let result = capture::listen(
        webview,
        &|| running.load(Ordering::SeqCst),
        &mut |samples| {
            let Ok(mut ring) = writer.lock() else { return };
            // Mixed to mono as it arrives. Two bars for two ears is not what
            // this draws, and a stereo spectrum is twice the work for a
            // difference nobody could see at this size.
            for frame in samples.chunks(capture::CHANNELS as usize) {
                ring.push(frame.iter().sum::<f32>() / frame.len().max(1) as f32);
            }
        },
    );

    painting.store(false, Ordering::SeqCst);
    let _ = frames.join();
    result
}

/// One window of samples in, one set of bar heights out.
struct Spectrum {
    fft: Arc<dyn rustfft::Fft<f32>>,
    /// Hann. Without it every window's ends are a step, and a step is
    /// broadband: the whole spectrum lifts off the floor and every bar
    /// twitches at once.
    hann: Vec<f32>,
    edges: Vec<(usize, usize)>,
    buffer: Vec<Complex<f32>>,
    magnitudes: Vec<f32>,
    shown: Vec<f32>,
}

impl Spectrum {
    fn new() -> Self {
        let mut planner = FftPlanner::<f32>::new();
        Self {
            fft: planner.plan_fft_forward(WINDOW),
            hann: (0..WINDOW)
                .map(|i| {
                    let t = i as f32 / (WINDOW - 1) as f32;
                    0.5 - 0.5 * (std::f32::consts::TAU * t).cos()
                })
                .collect(),
            edges: bands::band_edges(RATE, WINDOW),
            buffer: vec![Complex::new(0.0, 0.0); WINDOW],
            magnitudes: vec![0.0; WINDOW / 2],
            shown: vec![0.0; BARS],
        }
    }

    fn of(&mut self, samples: &[f32]) -> &[f32] {
        for (slot, (&sample, &w)) in self.buffer.iter_mut().zip(samples.iter().zip(&self.hann)) {
            *slot = Complex::new(sample * w, 0.0);
        }
        self.fft.process(&mut self.buffer);

        // Normalised by the window length, so a bar means the same thing
        // whatever `WINDOW` is, and doubled because the negative half of the
        // spectrum is being thrown away.
        let scale = 2.0 / WINDOW as f32;
        for (out, bin) in self.magnitudes.iter_mut().zip(self.buffer.iter()) {
            *out = bin.norm() * scale;
        }

        bands::settle(&mut self.shown, &bands::bars_from(&self.magnitudes, &self.edges));
        &self.shown
    }
}
