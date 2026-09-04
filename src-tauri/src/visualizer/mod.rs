//! What the speakers are actually doing, as twenty-four numbers.
//!
//! The visualiser behind the deck is fed from the *output* device rather than
//! from the app's own audio, and that is the only way it could have been. Most
//! of what this app plays comes out of Spotify's Web Playback SDK, which is
//! DRM-protected media: it cannot be routed through a Web Audio graph, so a
//! browser-side `AnalyserNode` reads silence from it forever. The other route —
//! asking Spotify what the track sounds like — was closed in November 2024,
//! when `/audio-features` and `/audio-analysis` were withdrawn from apps in
//! Development Mode, which is every copy of this one.
//!
//! Windows hands out what a render device is playing through the same interface
//! it hands out a microphone, given one flag. `cpal` sets that flag whenever an
//! input stream is built on an output device, so the whole of the difference
//! here is which device is asked.
//!
//! What is captured is the whole machine, not this app. A video in another
//! window moves these bars too. That is inherent to reading the mixer and worth
//! saying out loud rather than hiding.

mod bands;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rustfft::{num_complex::Complex, FftPlanner};
use tauri::{AppHandle, Emitter};

use bands::BARS;

/// How many samples one frame of the spectrum is computed from.
///
/// At 48kHz this is 43ms of sound and 23Hz per bin. Halving it would blur the
/// bass bars into each other; doubling it would make every bar lag the music by
/// a twelfth of a second, which is visible.
const WINDOW: usize = 2048;

/// How often a frame is sent. Thirty a second is smooth and is a thirtieth of
/// the work sixty would be, for something sitting behind the real interface.
const FRAME: Duration = Duration::from_millis(33);

/// The event the webview listens on. One array of `BARS` floats in 0..=1.
const EVENT: &str = "visualizer:bars";

/// Whether the capture thread should keep going.
///
/// A single flag rather than a handle, because the thread owns a `cpal::Stream`
/// and that is not `Send`: it has to be built, kept and dropped all on the same
/// thread, so the thread is asked to stop rather than being reached into.
#[derive(Default)]
pub struct Running(Arc<AtomicBool>);

/// The most recent samples, mixed down to mono.
///
/// A ring the capture callback writes and the frame thread reads. The callback
/// runs on an audio thread and must not block for long or the capture glitches;
/// a lock held for the length of a memcpy of a few hundred floats is short
/// enough, and the alternative is a lock-free queue for one producer and one
/// consumer that would need justifying.
struct Ring {
    samples: Vec<f32>,
    /// Where the next sample goes; the buffer is full from the start and old
    /// samples are simply overwritten.
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

    /// The window in order, oldest first.
    fn window(&self) -> Vec<f32> {
        let (head, tail) = self.samples.split_at(self.at);
        tail.iter().chain(head.iter()).copied().collect()
    }
}

/// Start reading the output device, if it is not already being read.
///
/// Never fatal. A machine with no output device, or one whose driver refuses a
/// loopback client, simply gets no bars — the visualiser is an ornament and
/// must not be able to stop the app from playing music.
#[tauri::command]
pub fn visualizer_start(app: AppHandle, running: tauri::State<'_, Running>) {
    let flag = running.0.clone();
    if flag.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        if let Err(err) = capture(&app, &flag) {
            eprintln!("[visualizer] {err}");
        }
        flag.store(false, Ordering::SeqCst);
        // One last frame of nothing, so whatever was on screen falls away
        // rather than freezing at the height it had when the device went.
        let _ = app.emit(EVENT, vec![0.0_f32; BARS]);
    });
}

#[tauri::command]
pub fn visualizer_stop(running: tauri::State<'_, Running>) {
    running.0.store(false, Ordering::SeqCst);
}

/// Build the loopback stream and send a frame every `FRAME` until asked to stop.
fn capture(app: &AppHandle, running: &AtomicBool) -> Result<(), String> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| "no output device to listen to".to_string())?;

    // The *output* config, on purpose. Windows will not describe an input
    // format for a render device — the loopback client is fed the mix format
    // the device is already rendering, which is exactly this.
    let config = device
        .default_output_config()
        .map_err(|e| format!("no default format: {e}"))?;
    let rate = config.sample_rate();
    let channels = config.channels() as usize;

    let ring = Arc::new(Mutex::new(Ring::new()));
    let writer = ring.clone();
    let on_error = |err| eprintln!("[visualizer] stream error: {err}");

    // Mixed to mono as it arrives. Two bars for two ears is not what this
    // draws, and a stereo spectrum is twice the work for a difference nobody
    // could see at this size.
    let stream = device
        .build_input_stream(
            &config.config(),
            move |data: &[f32], _| {
                let Ok(mut ring) = writer.lock() else { return };
                for frame in data.chunks(channels.max(1)) {
                    let sum: f32 = frame.iter().sum();
                    ring.push(sum / channels.max(1) as f32);
                }
            },
            on_error,
            None,
        )
        .map_err(|e| format!("could not listen to the output device: {e}"))?;
    stream.play().map_err(|e| format!("could not start listening: {e}"))?;

    let edges = bands::band_edges(rate, WINDOW);
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(WINDOW);
    // Hann. Without it every window's ends are a step, and a step is broadband:
    // the whole spectrum lifts off the floor and every bar twitches at once.
    let hann: Vec<f32> = (0..WINDOW)
        .map(|i| {
            let t = i as f32 / (WINDOW - 1) as f32;
            0.5 - 0.5 * (std::f32::consts::TAU * t).cos()
        })
        .collect();

    let mut shown = vec![0.0_f32; BARS];
    let mut buffer = vec![Complex::new(0.0_f32, 0.0); WINDOW];
    let mut magnitudes = vec![0.0_f32; WINDOW / 2];

    while running.load(Ordering::SeqCst) {
        std::thread::sleep(FRAME);

        let samples = match ring.lock() {
            Ok(ring) => ring.window(),
            Err(_) => break,
        };
        for (slot, (&sample, &w)) in buffer.iter_mut().zip(samples.iter().zip(&hann)) {
            *slot = Complex::new(sample * w, 0.0);
        }
        fft.process(&mut buffer);

        // Normalised by the window length, so a bar means the same thing
        // whatever `WINDOW` is set to, and doubled because the negative half of
        // the spectrum is being thrown away.
        let scale = 2.0 / WINDOW as f32;
        for (out, bin) in magnitudes.iter_mut().zip(buffer.iter()) {
            *out = bin.norm() * scale;
        }

        bands::settle(&mut shown, &bands::bars_from(&magnitudes, &edges));
        if app.emit(EVENT, &shown).is_err() {
            break;
        }
    }

    Ok(())
}
