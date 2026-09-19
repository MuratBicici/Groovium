//! Reading LRC, the format both LRCLIB and NetEase hand synced lyrics back in.

use super::LyricLine;

/// `[mm:ss]`, `[mm:ss.x]`, `[mm:ss.xx]` or `[mm:ss.xxx]` (a colon before the
/// fraction is accepted too) as milliseconds. `None` for anything else.
pub fn stamp_ms(tag: &str) -> Option<i64> {
    let (minutes, rest) = tag.split_once(':')?;
    let (seconds, fraction) = match rest.split_once(['.', ':']) {
        Some((s, f)) => (s, f),
        None => (rest, ""),
    };
    if minutes.is_empty() || !minutes.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if seconds.len() != 2 || !seconds.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if fraction.len() > 3 || !fraction.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let frac_ms = match fraction.len() {
        0 => 0,
        1 => fraction.parse::<i64>().ok()? * 100,
        2 => fraction.parse::<i64>().ok()? * 10,
        _ => fraction.parse::<i64>().ok()?,
    };
    Some(minutes.parse::<i64>().ok()? * 60_000 + seconds.parse::<i64>().ok()? * 1000 + frac_ms)
}

/// The tags at the start of a line, and what follows them.
fn split_tags(line: &str) -> (Vec<&str>, &str) {
    let mut tags = Vec::new();
    let mut rest = line.trim_start();
    while let Some(inner) = rest.strip_prefix('[') {
        let Some(end) = inner.find(']') else { break };
        tags.push(&inner[..end]);
        rest = &inner[end + 1..];
    }
    (tags, rest)
}

/// A line's words without the per-word stamps of "enhanced" LRC —
/// `<00:12.34>word <00:12.80>word` — which time each word within the line.
/// Only the line's own time is used, so they are only in the way.
fn without_word_stamps(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('<') {
        let Some(len) = rest[open + 1..].find('>') else {
            break;
        };
        out.push_str(&rest[..open]);
        let inner = &rest[open + 1..open + 1 + len];
        if stamp_ms(inner).is_none() {
            out.push_str(&rest[open..open + len + 2]);
        }
        rest = &rest[open + len + 2..];
    }
    out.push_str(rest);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Fewer lines than this, and there is not enough to judge by.
const MIN_FRAGMENT_LINES: usize = 20;

/// Whether synced lyrics are stored a syllable or a letter at a time — each
/// its own line, `[00:08.75] 문`, `[00:08.86] 을` — rather than a line at a
/// time. They keep time, but a list of single syllables is not something to
/// read. Taken to be so when at least half the lines with words in them have
/// one or two letters.
pub fn fragmented(lines: &[LyricLine]) -> bool {
    let lengths: Vec<usize> = lines
        .iter()
        .map(|l| l.text.chars().filter(|c| !c.is_whitespace()).count())
        .filter(|&n| n > 0)
        .collect();
    lengths.len() >= MIN_FRAGMENT_LINES
        && lengths.iter().filter(|&&n| n <= 2).count() * 2 >= lengths.len()
}

/// Every timed line, earliest first.
///
/// A line with several stamps — a chorus written once — becomes one line per
/// stamp. Metadata tags are skipped. `[offset:±ms]` is applied: a positive
/// offset brings the words in earlier. A stamp with no words after it is kept,
/// because it marks where the singing stops.
pub fn parse_lrc(text: &str) -> Vec<LyricLine> {
    let mut offset = 0i64;
    let mut timed: Vec<(i64, String)> = Vec::new();

    for line in text.lines() {
        let (tags, rest) = split_tags(line);
        let mut stamps = Vec::new();
        for tag in tags {
            if let Some(ms) = stamp_ms(tag) {
                stamps.push(ms);
            } else if let Some(value) = tag.strip_prefix("offset:") {
                offset = value.trim().trim_start_matches('+').parse().unwrap_or(0);
            }
        }
        let words = without_word_stamps(rest);
        for ms in stamps {
            timed.push((ms, words.to_string()));
        }
    }

    let mut lines: Vec<LyricLine> = timed
        .into_iter()
        .map(|(ms, text)| LyricLine {
            time_ms: u32::try_from((ms - offset).max(0)).unwrap_or(u32::MAX),
            text,
        })
        .collect();
    lines.sort_by_key(|l| l.time_ms);
    lines
}

/// The words alone, one line each, for lyrics that are to be read rather than
/// followed — synced ones from a take too far off in length to keep time.
pub fn words_of(lines: &[LyricLine]) -> String {
    lines
        .iter()
        .map(|l| l.text.as_str())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(time_ms: u32, text: &str) -> LyricLine {
        LyricLine {
            time_ms,
            text: text.into(),
        }
    }

    #[test]
    fn reads_stamps_at_every_precision() {
        let lines = parse_lrc("[00:01]a\n[00:02.5]b\n[00:03.25]c\n[01:04.125]d\n[00:05:50]e");
        assert_eq!(
            lines,
            vec![
                line(1000, "a"),
                line(2500, "b"),
                line(3250, "c"),
                line(5500, "e"),
                line(64125, "d"),
            ]
        );
    }

    #[test]
    fn a_line_with_several_stamps_is_sung_each_time() {
        let lines = parse_lrc("[00:30.00][00:10.00]chorus\n[00:20.00]verse");
        assert_eq!(
            lines,
            vec![
                line(10000, "chorus"),
                line(20000, "verse"),
                line(30000, "chorus")
            ]
        );
    }

    #[test]
    fn skips_metadata_and_keeps_empty_lines() {
        let lines =
            parse_lrc("[ar:Someone]\n[ti:Something]\n[00:01.00]words\n[00:04.00]\nnot a line");
        assert_eq!(lines, vec![line(1000, "words"), line(4000, "")]);
    }

    #[test]
    fn applies_the_offset_and_never_goes_below_zero() {
        let lines = parse_lrc("[offset:+500]\n[00:00.20]early\n[00:02.00]late");
        assert_eq!(lines, vec![line(0, "early"), line(1500, "late")]);
        let later = parse_lrc("[offset:-250]\n[00:01.00]x");
        assert_eq!(later, vec![line(1250, "x")]);
    }

    #[test]
    fn refuses_what_is_not_a_stamp() {
        assert_eq!(stamp_ms("1:2"), None);
        assert_eq!(stamp_ms("aa:12"), None);
        assert_eq!(stamp_ms("00:12.1234"), None);
        assert_eq!(stamp_ms("length:03:20"), None);
        // NetEase writes this on its credit lines.
        assert_eq!(stamp_ms("00:00.00-1"), None);
    }

    #[test]
    fn drops_the_stamps_on_each_word() {
        let lines = parse_lrc("[00:12.34]<00:12.34>kimi <00:12.80>no <00:13.10>koe <b>");
        assert_eq!(lines, vec![line(12340, "kimi no koe <b>")]);
    }

    #[test]
    fn tells_a_syllable_at_a_time_from_a_line_at_a_time() {
        let syllables: String = (0..30)
            .map(|i| {
                format!(
                    "[00:{:02}.00]문
",
                    i
                )
            })
            .collect();
        assert!(fragmented(&parse_lrc(&syllables)));
        // Two to a line is still fragments: "열어", "보면".
        let pairs: String = (0..30)
            .map(|i| {
                format!(
                    "[00:{:02}.00]열어
",
                    i
                )
            })
            .collect();
        assert!(fragmented(&parse_lrc(&pairs)));
        let sentences: String = (0..30)
            .map(|i| {
                format!(
                    "[00:{:02}.00]드러나는 My worth
",
                    i
                )
            })
            .collect();
        assert!(!fragmented(&parse_lrc(&sentences)));
        // Too few lines to say.
        assert!(!fragmented(&parse_lrc(
            "[00:01.00]문
[00:02.00]을"
        )));
    }

    #[test]
    fn keeps_only_the_words_for_reading() {
        let lines = [line(0, ""), line(1000, "one"), line(2000, "two")];
        assert_eq!(words_of(&lines), "one\ntwo");
    }
}
