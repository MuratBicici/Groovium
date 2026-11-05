//! The sums of the equaliser, with nothing of Windows in them.
//!
//! Everything here is one sample at a time and allocates nothing after it is
//! built, because it runs inside the thread that feeds the sound card. It is
//! apart from that thread so all of it can be tested without any sound.

use std::collections::VecDeque;

/// What everything is asked to run at. Windows converts to and from it.
pub const RATE: f64 = 48_000.0;

/// The middle of each band, an octave apart.
pub const BANDS: [f64; 10] = [31.0, 62.0, 125.0, 250.0, 500.0, 1_000.0, 2_000.0, 4_000.0, 8_000.0, 16_000.0];

/// How far a band or the preamp can go either way.
pub const MOST_DB: f32 = 12.0;

/// How wide a band is. Neighbours an octave apart overlap gently at this.
const BAND_Q: f64 = 1.41;

/// How far a band may move per block, so a slider dragged does not click.
const STEER_DB: f32 = 0.25;

/// As loud as the limiter lets anything be.
const CEILING: f64 = 0.98;
/// How fast the limiter lets go again: a tenth of a second to the last of it.
const LIMITER_RELEASE: f64 = 1.0 / (0.1 * RATE);

/// How long the gain takes from nothing to full or back.
pub const RAMP_MS: u64 = 100;
const RAMP_FRAMES: f64 = RAMP_MS as f64 / 1000.0 * RATE;
/// Music cannot be much past full scale. Past this it is not music, and whatever
/// it is should not reach anybody's ears.
const GUARD: f64 = 1.25;
/// How long nothing goes out once the guard has seen that.
const GUARD_HOLD: u32 = (0.2 * RATE) as u32;

/// How much the playback speed may be nudged to hold the buffer steady: a fifth
/// of a percent, which is far too little to hear as pitch.
const MOST_NUDGE: f64 = 0.002;

/// How slowly the buffer's level is read for that, in frames: about a second.
///
/// The capture arrives ten milliseconds at a time, so the level itself is a
/// sawtooth. Read directly, the speed followed it a hundred times a second.
const FILL_SMOOTHING: f64 = RATE;

/// Frames on each side of the point being read.
const HALF_TAPS: usize = 8;
const TAPS: usize = HALF_TAPS * 2;
/// Positions between two frames that a kernel is worked out for.
const PHASES: usize = 128;
/// The Kaiser window's shape: enough to keep the ringing far below hearing.
const KAISER_BETA: f64 = 8.0;

/// A setting of the equaliser.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Curve {
    pub preamp: f32,
    pub bands: [f32; BANDS.len()],
}

impl Curve {
    pub const FLAT: Curve = Curve { preamp: 0.0, bands: [0.0; BANDS.len()] };

    /// One from the page, held to what the sliders can reach. A value that is
    /// not a number counts as flat: it must never reach the filters.
    pub fn from_page(preamp: f32, bands: &[f32]) -> Curve {
        let held = |db: f32| if db.is_finite() { db.clamp(-MOST_DB, MOST_DB) } else { 0.0 };
        let mut curve = Curve { preamp: held(preamp), ..Curve::FLAT };
        for (slot, db) in curve.bands.iter_mut().zip(bands) {
            *slot = held(*db);
        }
        curve
    }

    /// The level the filters are fed at.
    ///
    /// Taken down by as much as the highest band lifts, so a boost has room and
    /// is not simply run into the limiter. Lifting the bass makes the rest
    /// quieter rather than the whole thing distorted.
    fn input_db(&self) -> f32 {
        let lift = self.bands.iter().fold(0.0_f32, |most, db| most.max(*db));
        self.preamp - lift
    }
}

/// One band: a peaking filter, by Robert Bristow-Johnson's cookbook.
#[derive(Clone, Copy)]
struct Band {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z1: [f64; 2],
    z2: [f64; 2],
}

impl Band {
    fn new(freq: f64, db: f32) -> Self {
        let mut band = Band { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0, z1: [0.0; 2], z2: [0.0; 2] };
        band.tune(freq, db);
        band
    }

    /// New coefficients, keeping what it remembers, which is why it can be done
    /// while the music plays.
    fn tune(&mut self, freq: f64, db: f32) {
        let a = 10_f64.powf(f64::from(db) / 40.0);
        let w = std::f64::consts::TAU * freq / RATE;
        let alpha = w.sin() / (2.0 * BAND_Q);
        let a0 = 1.0 + alpha / a;
        self.b0 = (1.0 + alpha * a) / a0;
        self.b1 = -2.0 * w.cos() / a0;
        self.b2 = (1.0 - alpha * a) / a0;
        self.a1 = self.b1;
        self.a2 = (1.0 - alpha / a) / a0;
    }

    fn run(&mut self, channel: usize, x: f64) -> f64 {
        let y = self.b0 * x + self.z1[channel];
        self.z1[channel] = self.b1 * x - self.a1 * y + self.z2[channel];
        self.z2[channel] = self.b2 * x - self.a2 * y;
        y
    }
}

/// The filters and the limiter after them.
pub struct Chain {
    bands: [Band; BANDS.len()],
    now: Curve,
    wanted: Curve,
    /// How far the limiter has the sound down, 1 for not at all.
    reduction: f64,
    /// How many frames the limiter has had to touch since last asked.
    pub limited: u64,
}

impl Chain {
    pub fn new(curve: Curve) -> Self {
        let mut bands = [Band::new(BANDS[0], 0.0); BANDS.len()];
        for (at, band) in bands.iter_mut().enumerate() {
            *band = Band::new(BANDS[at], curve.bands[at]);
        }
        Chain { bands, now: curve, wanted: curve, reduction: 1.0, limited: 0 }
    }

    /// Head for another setting, a little per block.
    pub fn want(&mut self, curve: Curve) {
        self.wanted = curve;
    }

    /// One step towards the setting wanted. Called once per block.
    pub fn steer(&mut self) {
        let toward = |now: f32, wanted: f32| now + (wanted - now).clamp(-STEER_DB, STEER_DB);
        self.now.preamp = toward(self.now.preamp, self.wanted.preamp);
        for (at, band) in self.bands.iter_mut().enumerate() {
            if self.now.bands[at] != self.wanted.bands[at] {
                self.now.bands[at] = toward(self.now.bands[at], self.wanted.bands[at]);
                band.tune(BANDS[at], self.now.bands[at]);
            }
        }
    }

    pub fn run(&mut self, frame: [f64; 2]) -> [f32; 2] {
        let level = 10_f64.powf(f64::from(self.now.input_db()) / 20.0);
        let mut out = [0.0; 2];
        for (channel, slot) in out.iter_mut().enumerate() {
            let mut x = frame[channel] * level;
            for band in &mut self.bands {
                x = band.run(channel, x);
            }
            *slot = x;
        }

        // Down at once when a peak would pass the ceiling, up again slowly.
        // Both channels together, so the picture does not lean.
        let peak = out[0].abs().max(out[1].abs());
        let room = if peak > CEILING { CEILING / peak } else { 1.0 };
        if room < self.reduction {
            self.reduction = room;
            self.limited += 1;
        } else {
            self.reduction = (self.reduction + LIMITER_RELEASE).min(1.0);
        }
        // The last word whatever went before it. Never past full scale.
        [
            (out[0] * self.reduction).clamp(-1.0, 1.0) as f32,
            (out[1] * self.reduction).clamp(-1.0, 1.0) as f32,
        ]
    }
}

/// What stands between the very quiet sound captured and everything after it.
///
/// A listener's ear found out why this exists. Multiplying by ten thousand is
/// only right once the session really is ten thousand times down, and doing it
/// a moment too soon sent full scale to somebody's headphones. So the gain moves
/// by a fixed step per sample, never jumps, and each frame is checked as it goes
/// through: this is tied to the samples and not to any clock.
#[derive(Default)]
pub struct Gate {
    gain: f64,
    full: f64,
    hold: u32,
    /// How many times the guard has shut it since last asked.
    pub trips: u64,
}

impl Gate {
    pub fn run(&mut self, target: f64, frame: [f32; 2]) -> [f64; 2] {
        // A step from the largest gain seen and not from the gain it has now: a
        // step in proportion to what is left would never quite arrive at
        // nothing, and the session comes up after this has gone down.
        self.full = self.full.max(target);
        let step = self.full / RAMP_FRAMES;
        self.gain = if self.gain < target { (self.gain + step).min(target) } else { (self.gain - step).max(target) };

        let out = [f64::from(frame[0]) * self.gain, f64::from(frame[1]) * self.gain];
        if out[0].abs() > GUARD || out[1].abs() > GUARD || !out[0].is_finite() || !out[1].is_finite() {
            if self.hold == 0 {
                self.trips += 1;
            }
            self.hold = GUARD_HOLD;
        }
        if self.hold > 0 {
            self.hold -= 1;
            return [0.0, 0.0];
        }
        out
    }
}

/// The modified Bessel function the Kaiser window is built from.
fn bessel_i0(x: f64) -> f64 {
    let mut sum = 1.0;
    let mut term = 1.0;
    let quarter = x * x / 4.0;
    for k in 1..32 {
        term *= quarter / f64::from(k * k);
        sum += term;
        if term < sum * 1e-12 {
            break;
        }
    }
    sum
}

/// What each of the frames around a point counts for, at every point between
/// two frames: a windowed sinc, each row adding up to exactly one.
fn kernels() -> Vec<[f32; TAPS]> {
    let edge = HALF_TAPS as f64;
    let window_top = bessel_i0(KAISER_BETA);
    (0..=PHASES)
        .map(|phase| {
            let t = phase as f64 / PHASES as f64;
            let mut row = [0.0_f64; TAPS];
            for (tap, slot) in row.iter_mut().enumerate() {
                let x = tap as f64 - (edge - 1.0) - t;
                let sinc = if x.abs() < 1e-9 {
                    1.0
                } else {
                    (std::f64::consts::PI * x).sin() / (std::f64::consts::PI * x)
                };
                let along = (x / edge).clamp(-1.0, 1.0);
                *slot = sinc * bessel_i0(KAISER_BETA * (1.0 - along * along).sqrt()) / window_top;
            }
            let total: f64 = row.iter().sum();
            let mut held = [0.0_f32; TAPS];
            for (slot, value) in held.iter_mut().zip(row) {
                *slot = (value / total) as f32;
            }
            held
        })
        .collect()
}

/// Reading from the captured sound at the speed the sound card takes it.
///
/// The capture and the sound card each keep their own time, and two clocks are
/// never the same. Left alone the buffer between them runs dry or grows without
/// end, so playback is nudged a hair faster or slower to hold it where it should
/// be. Far too little to hear, and no sample is thrown away for it.
///
/// Nudged, it reads between frames, and how it does that is audible. It used to
/// draw a straight line between the two: at the halfway point that is six
/// decibels down at 16 kHz and eight at 18, drifting in and out as the two clocks
/// wandered. Whatever the equaliser was set to, the music had a filter on it. A
/// windowed sinc over sixteen frames is flat to well past that.
pub struct Pacer {
    target: usize,
    /// How far between the two middle frames of the history the reading is.
    at: f64,
    /// The last frames read, oldest first.
    history: [[f32; 2]; TAPS],
    kernels: Vec<[f32; TAPS]>,
    /// The buffer's level, read slowly; see `FILL_SMOOTHING`.
    fill: f64,
    /// Waiting for the buffer to fill before reading from it, as at the start.
    filling: bool,
    pub underruns: u64,
    pub dropped: u64,
}

impl Pacer {
    pub fn new(target_frames: usize) -> Self {
        Pacer {
            target: target_frames,
            at: 0.0,
            history: [[0.0; 2]; TAPS],
            kernels: kernels(),
            fill: target_frames as f64,
            filling: true,
            underruns: 0,
            dropped: 0,
        }
    }

    /// One frame from the history, at the point `at` has got to.
    fn interpolated(&self) -> [f32; 2] {
        let place = self.at * PHASES as f64;
        let row = (place as usize).min(PHASES - 1);
        let mix = (place - row as f64) as f32;
        let (near, far) = (&self.kernels[row], &self.kernels[row + 1]);
        let mut out = [0.0_f32; 2];
        for (tap, frame) in self.history.iter().enumerate() {
            let weight = near[tap] + (far[tap] - near[tap]) * mix;
            out[0] += frame[0] * weight;
            out[1] += frame[1] * weight;
        }
        out
    }

    /// Hand `count` frames to `out` from the buffer.
    pub fn read(&mut self, ring: &mut VecDeque<[f32; 2]>, count: usize, mut out: impl FnMut([f32; 2])) {
        for _ in 0..count {
            // Too far behind to catch up by nudging, as after a stall: jump.
            while ring.len() > self.target * 3 {
                ring.pop_front();
                self.dropped += 1;
            }
            if self.filling {
                if ring.len() < self.target {
                    out([0.0; 2]);
                    continue;
                }
                self.filling = false;
                self.fill = ring.len() as f64;
            }
            self.fill += (ring.len() as f64 - self.fill) / FILL_SMOOTHING;
            let error = (self.fill - self.target as f64) / self.target.max(1) as f64;
            let speed = 1.0 + (error * MOST_NUDGE * 4.0).clamp(-MOST_NUDGE, MOST_NUDGE);
            self.at += speed;
            let mut ran_dry = false;
            while self.at >= 1.0 {
                self.at -= 1.0;
                let Some(next) = ring.pop_front() else {
                    ran_dry = true;
                    break;
                };
                self.history.copy_within(1.., 0);
                self.history[TAPS - 1] = next;
            }
            if ran_dry {
                self.underruns += 1;
                self.filling = true;
                self.at = 0.0;
                out([0.0; 2]);
                continue;
            }
            out(self.interpolated());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FULL: f64 = 10_000.0;

    /// A sine through a chain: the level at its end against the level put in, in dB.
    fn response(chain: &mut Chain, freq: f64) -> f64 {
        let amp = 0.01;
        let total = (RATE as usize) * 2;
        let mut sum = 0.0;
        let mut count = 0.0;
        for n in 0..total {
            let x = amp * (std::f64::consts::TAU * freq * n as f64 / RATE).sin();
            let [left, _] = chain.run([x, x]);
            if n > total / 2 {
                sum += f64::from(left).powi(2);
                count += 1.0;
            }
        }
        20.0 * ((sum / count).sqrt() / (amp / 2_f64.sqrt())).log10()
    }

    #[test]
    fn a_flat_curve_leaves_the_sound_alone() {
        let mut chain = Chain::new(Curve::FLAT);
        for n in 0..4_800 {
            let x = 0.5 * (n as f64 * 0.05).sin();
            let [left, right] = chain.run([x, -x]);
            assert!((f64::from(left) - x).abs() < 1e-6);
            assert!((f64::from(right) + x).abs() < 1e-6);
        }
    }

    #[test]
    fn a_band_lifts_its_own_frequency_and_leaves_far_ones_nearly_alone() {
        let mut bands = [0.0; BANDS.len()];
        bands[5] = 6.0;
        let curve = Curve { preamp: 0.0, bands };
        // Six down going in for the headroom, six up in the band.
        assert!(response(&mut Chain::new(curve), 1_000.0).abs() < 0.2);
        assert!((response(&mut Chain::new(curve), 62.0) + 6.0).abs() < 0.3);
    }

    #[test]
    fn a_cut_needs_no_headroom() {
        let mut bands = [0.0; BANDS.len()];
        bands[2] = -6.0;
        let curve = Curve { preamp: 0.0, bands };
        assert!((response(&mut Chain::new(curve), 125.0) + 6.0).abs() < 0.2);
        assert!(response(&mut Chain::new(curve), 8_000.0).abs() < 0.2);
    }

    #[test]
    fn nothing_ever_passes_full_scale() {
        let mut chain = Chain::new(Curve { preamp: MOST_DB, bands: [0.0; BANDS.len()] });
        for n in 0..48_000 {
            let x = 1.2 * (n as f64 * 0.03).sin();
            let [left, right] = chain.run([x, x]);
            assert!(left.abs() <= 1.0 && right.abs() <= 1.0);
        }
        assert!(chain.limited > 0, "and the limiter is what stopped it");
    }

    #[test]
    fn a_curve_from_the_page_is_held_to_what_is_allowed() {
        let curve = Curve::from_page(f32::NAN, &[99.0, -99.0, f32::INFINITY, 3.0]);
        assert_eq!(curve.preamp, 0.0);
        assert_eq!(&curve.bands[..4], &[MOST_DB, -MOST_DB, 0.0, 3.0]);
        assert_eq!(Curve::from_page(0.0, &[]), Curve::FLAT);
    }

    #[test]
    fn a_slider_moved_changes_the_sound_gradually() {
        let mut chain = Chain::new(Curve::FLAT);
        let mut bands = [0.0; BANDS.len()];
        bands[0] = 6.0;
        chain.want(Curve { preamp: 0.0, bands });
        chain.steer();
        assert_eq!(chain.now.bands[0], STEER_DB);
        for _ in 0..100 {
            chain.steer();
        }
        assert_eq!(chain.now.bands[0], 6.0);
    }

    #[test]
    fn the_gain_opens_gradually_and_never_jumps() {
        let mut gate = Gate::default();
        let quiet = [0.00005, 0.00005];
        let [first, _] = gate.run(FULL, quiet);
        assert!(first < 0.01, "not at once: {first}");
        for _ in 0..RAMP_FRAMES as usize {
            gate.run(FULL, quiet);
        }
        let [opened, _] = gate.run(FULL, quiet);
        assert!((opened - 0.5).abs() < 1e-3, "all the way in the end: {opened}");
    }

    #[test]
    fn the_gain_is_gone_before_the_session_comes_back_up() {
        // Measured with nothing going to the sound card: a step in proportion
        // to the gain left still had a quarter of it when the session rose, and
        // peaked at twice full scale on the way out.
        let mut gate = Gate::default();
        let quiet = [0.0001, 0.0001];
        for _ in 0..(RAMP_FRAMES as usize + 10) {
            gate.run(FULL, quiet);
        }
        for _ in 0..(RAMP_FRAMES as usize + 1) {
            gate.run(0.0, quiet);
        }
        let [left, _] = gate.run(0.0, [0.9, 0.9]);
        assert_eq!(left, 0.0, "the session at full now, and nothing through");
    }

    #[test]
    fn full_gain_on_a_session_not_turned_down_is_shut_off() {
        // What hurt somebody's ear, on purpose.
        let mut gate = Gate::default();
        let loud = [0.5, -0.5];
        let mut most = 0.0_f64;
        for _ in 0..48_000 {
            let [left, _] = gate.run(FULL, loud);
            most = most.max(left.abs());
        }
        assert!(most <= GUARD, "nothing past the guard: {most}");
        assert_eq!(gate.trips, 1, "and it stays shut while it lasts");
        let [left, _] = gate.run(FULL, loud);
        assert_eq!(left, 0.0);
    }

    #[test]
    fn it_opens_again_once_the_session_is_quiet() {
        let mut gate = Gate::default();
        for _ in 0..48_000 {
            gate.run(FULL, [0.5, 0.5]);
        }
        for _ in 0..GUARD_HOLD {
            gate.run(FULL, [0.00005, 0.00005]);
        }
        let [left, _] = gate.run(FULL, [0.00005, 0.00005]);
        assert!((left - 0.5).abs() < 1e-3);
    }

    /// Feed and read at slightly different speeds, and see where the buffer ends up.
    fn run_clocks(fed_per_block: f64) -> (usize, Pacer) {
        let target = 1_920;
        let mut pacer = Pacer::new(target);
        let mut ring = VecDeque::new();
        let mut owed = 0.0;
        for _ in 0..(60 * 100) {
            owed += fed_per_block;
            while owed >= 1.0 {
                ring.push_back([0.1, 0.1]);
                owed -= 1.0;
            }
            pacer.read(&mut ring, 480, |_| {});
        }
        (ring.len(), pacer)
    }

    #[test]
    fn clocks_a_little_apart_never_empty_or_fill_the_buffer() {
        for fed in [480.0 * 0.9995, 480.0, 480.0 * 1.0005] {
            let (left, pacer) = run_clocks(fed);
            assert!((480..=4_800).contains(&left), "{fed}: {left} left");
            assert_eq!(pacer.dropped, 0, "{fed}");
            assert_eq!(pacer.underruns, 0, "{fed}");
        }
    }

    /// A sine through the pacer with the clocks this far apart: its level at the
    /// worst moment and the best, in decibels, once it has settled.
    fn through_pacer(freq: f64, clocks: f64) -> (f64, f64) {
        let mut pacer = Pacer::new(1_920);
        let mut ring = VecDeque::new();
        let mut n = 0_u64;
        let mut owed = 2_000.0;
        let mut levels = vec![];
        for block in 0..4_000 {
            owed += 480.0 * clocks;
            while owed >= 1.0 {
                let x = (std::f64::consts::TAU * freq * n as f64 / RATE).sin() as f32;
                ring.push_back([x, x]);
                n += 1;
                owed -= 1.0;
            }
            let mut sum = 0.0;
            pacer.read(&mut ring, 480, |frame| sum += f64::from(frame[0]).powi(2));
            if block > 1_000 {
                levels.push(20.0 * ((sum / 480.0).sqrt() * 2_f64.sqrt()).log10());
            }
        }
        let worst = levels.iter().copied().fold(f64::MAX, f64::min);
        let best = levels.iter().copied().fold(f64::MIN, f64::max);
        (worst, best)
    }

    #[test]
    fn the_highs_come_through_whatever_the_clocks_are_doing() {
        // A listener heard this before anything measured it: a filter on the music
        // at every setting. Reading between frames with a straight line took six
        // decibels off 16 kHz at the worst moment, and it came and went.
        for clocks in [1.0, 1.0002, 0.9998, 1.001] {
            for freq in [100.0, 1_000.0, 5_000.0, 10_000.0, 14_000.0, 16_000.0, 18_000.0] {
                let (worst, best) = through_pacer(freq, clocks);
                assert!(worst > -0.2 && best < 0.2, "{freq} Hz at {clocks}: {worst} to {best} dB");
            }
        }
    }

    #[test]
    fn a_stall_is_got_over_by_waiting_for_the_buffer_again() {
        let mut pacer = Pacer::new(100);
        let mut ring: VecDeque<[f32; 2]> = std::iter::repeat([0.1, 0.1]).take(100).collect();
        pacer.read(&mut ring, 150, |_| {});
        assert_eq!(pacer.underruns, 1);
        assert!(pacer.filling);
        ring.extend(std::iter::repeat([0.1, 0.1]).take(50));
        let mut out = vec![];
        pacer.read(&mut ring, 10, |f| out.push(f[0]));
        assert_eq!(ring.len(), 50, "not read until it is full enough");
        assert!(out.iter().all(|x| *x == 0.0));
    }
}
