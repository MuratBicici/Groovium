//! Turning a spectrum into bars.
//!
//! Kept apart from the capture for the reason `discPhysics` is kept apart from
//! the component that moves the record: which frequencies a bar covers and how
//! fast a bar falls are rules, and a rule is worth being able to test without
//! an audio device to hang it on.

/// How many bars the visualiser draws.
///
/// Chosen for the window rather than for the ear: at 340px across with a gap
/// between each, this is about as many as can be told apart. More would be a
/// texture rather than bars.
pub const BARS: usize = 24;

/// The lowest frequency a bar covers, in Hz.
///
/// Below this is where a room's rumble and a recording's DC offset live, and
/// they would peg the first bar permanently.
const LOW_HZ: f32 = 45.0;

/// The highest. Above it there is very little in most music and nothing that
/// moves, so the last bars would sit still whatever was playing.
const HIGH_HZ: f32 = 14_000.0;

/// How much of its height a bar keeps from one frame to the next while falling.
///
/// Rising is instant and falling is not, which is what makes a bar chart read
/// as an analyser rather than as noise: a peak is legible for a moment after
/// the sound that made it. A full bar empties in a little under half a second.
///
/// The number is per frame rather than per second, so it moved when the frame
/// rate did: at 60 a second, 0.86 empties a bar twice as fast as it used to and
/// the bars would flicker where they used to fall. 0.93 is the same half-second
/// at the new rate.
const FALL: f32 = 0.93;

/// Where each bar's frequencies start and end, as indices into a spectrum.
///
/// Logarithmic, because pitch is: an octave is a doubling, so equal steps in
/// *ratio* rather than in Hz put roughly one octave and a half in each bar
/// across the range. Spaced linearly, the first bar would hold the bottom two
/// octaves and the top half of the bars would all be cymbals.
///
/// Bars are widened rather than allowed to be empty. At the bottom of the range
/// several bars can want the same bin — a 2048-point window at 48kHz is 23Hz
/// per bin, and the first two bars are narrower than that — and a bar with no
/// bins in it is a bar that never moves.
pub fn band_edges(sample_rate: u32, fft_len: usize) -> Vec<(usize, usize)> {
    let bins = fft_len / 2;
    if bins == 0 || sample_rate == 0 {
        return vec![(0, 0); BARS];
    }
    let hz_per_bin = sample_rate as f32 / fft_len as f32;
    let ratio = (HIGH_HZ / LOW_HZ).powf(1.0 / BARS as f32);

    let mut edges = Vec::with_capacity(BARS);
    let mut start = 0usize;
    for i in 0..BARS {
        let upper_hz = LOW_HZ * ratio.powi(i as i32 + 1);
        let lower_hz = LOW_HZ * ratio.powi(i as i32);
        let from = ((lower_hz / hz_per_bin).floor() as usize).max(start).min(bins - 1);
        let to = ((upper_hz / hz_per_bin).ceil() as usize).max(from + 1).min(bins);
        edges.push((from, to));
        start = to;
        // Everything above the top of the spectrum collapses onto the last bin,
        // which is honest: there is nothing up there to show.
        if start >= bins {
            start = bins - 1;
        }
    }
    edges
}

/// One frame of bar heights from one window's magnitudes, each in 0..=1.
///
/// The magnitudes are read in decibels rather than raw, because loudness is
/// logarithmic too: on a linear scale everything but the bass line sits flat on
/// the floor. The window below is about sixty decibels, which is roughly the
/// range between a quiet passage and a loud one.
pub fn bars_from(magnitudes: &[f32], edges: &[(usize, usize)]) -> Vec<f32> {
    const FLOOR_DB: f32 = -66.0;
    const CEIL_DB: f32 = -6.0;

    edges
        .iter()
        .map(|&(from, to)| {
            if from >= to || from >= magnitudes.len() {
                return 0.0;
            }
            let end = to.min(magnitudes.len());
            let slice = &magnitudes[from..end];
            // The loudest bin in the band rather than the mean. A band is one
            // and a half octaves wide at the top, so a single strong partial
            // averaged against its quiet neighbours all but disappears — which
            // is a bar that does not move to a sound anybody can hear.
            let peak = slice.iter().copied().fold(0.0_f32, f32::max);
            if peak <= 0.0 {
                return 0.0;
            }
            let db = 20.0 * peak.log10();
            ((db - FLOOR_DB) / (CEIL_DB - FLOOR_DB)).clamp(0.0, 1.0)
        })
        .collect()
}

/// Let the bars fall towards what was just measured, and jump up to it.
///
/// In place, because this runs thirty times a second for the life of the app
/// and there is no reason for it to allocate.
pub fn settle(shown: &mut [f32], measured: &[f32]) {
    for (bar, &now) in shown.iter_mut().zip(measured) {
        *bar = if now >= *bar { now } else { (*bar * FALL).max(now) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_bar_covers_at_least_one_bin() {
        // A bar with no bins in it is a bar that never moves, and at the bottom
        // of the range several bars are narrower than a single bin.
        for &(rate, len) in &[(48_000, 2048), (44_100, 2048), (96_000, 4096)] {
            for (i, &(from, to)) in band_edges(rate, len).iter().enumerate() {
                assert!(to > from, "bar {i} is empty at {rate}Hz/{len}");
            }
        }
    }

    #[test]
    fn bars_climb_and_never_overlap() {
        let edges = band_edges(48_000, 2048);
        for pair in edges.windows(2) {
            assert!(pair[1].0 >= pair[0].1 - 1, "bars run backwards: {pair:?}");
        }
        assert!(edges.first().unwrap().0 < edges.last().unwrap().0);
    }

    #[test]
    fn bars_get_wider_towards_the_top() {
        // The whole point of spacing them by ratio: an octave at the top of the
        // range is thousands of Hz and at the bottom it is tens.
        let edges = band_edges(48_000, 2048);
        let first = edges[0].1 - edges[0].0;
        let last = edges[BARS - 1].1 - edges[BARS - 1].0;
        assert!(last > first * 4, "top bar {last} bins, bottom bar {first}");
    }

    #[test]
    fn silence_is_flat() {
        let edges = band_edges(48_000, 2048);
        let bars = bars_from(&vec![0.0; 1024], &edges);
        assert_eq!(bars.len(), BARS);
        assert!(bars.iter().all(|&b| b == 0.0));
    }

    #[test]
    fn a_tone_lights_its_own_bar_and_not_the_others() {
        let edges = band_edges(48_000, 2048);
        // 1kHz at 48kHz over 2048 points is bin 42-ish.
        let mut magnitudes = vec![0.0_f32; 1024];
        magnitudes[43] = 0.5;
        let bars = bars_from(&magnitudes, &edges);

        let lit: Vec<usize> = bars
            .iter()
            .enumerate()
            .filter(|(_, &b)| b > 0.0)
            .map(|(i, _)| i)
            .collect();
        assert_eq!(lit.len(), 1, "one tone should light one bar, lit {lit:?}");
    }

    #[test]
    fn quiet_reads_lower_than_loud() {
        let edges = band_edges(48_000, 2048);
        let bar_of = |amp: f32| {
            let mut m = vec![0.0_f32; 1024];
            m[43] = amp;
            bars_from(&m, &edges)[..].iter().copied().fold(0.0_f32, f32::max)
        };
        assert!(bar_of(0.5) > bar_of(0.05));
        // And the scale is decibels, not amplitude: ten times the amplitude is
        // twenty decibels, which is a third of the window rather than all of it.
        let step = bar_of(0.5) - bar_of(0.05);
        assert!((step - 20.0 / 60.0).abs() < 0.02, "step was {step}");
    }

    #[test]
    fn bars_jump_up_and_fall_back() {
        let mut shown = vec![0.0, 1.0];
        settle(&mut shown, &[1.0, 0.0]);
        // Up is instant: a peak has to be there in the frame it happened.
        assert_eq!(shown[0], 1.0);
        // Down is not, or the bar would be gone before it was seen.
        assert!(shown[1] > 0.0 && shown[1] < 1.0);
    }

    #[test]
    fn a_falling_bar_reaches_the_floor() {
        // It must actually get there rather than approaching it forever, or a
        // silent app would keep painting.
        let mut shown = vec![1.0];
        for _ in 0..200 {
            settle(&mut shown, &[0.0]);
        }
        assert!(shown[0] < 0.001, "still at {}", shown[0]);
    }
}
