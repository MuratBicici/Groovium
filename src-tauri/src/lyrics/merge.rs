//! Putting a syllable-at-a-time record's timings onto a line-at-a-time one.
//!
//! Some songs are held twice: once a line to a line, and once a syllable or
//! a word to a line — `[00:08.75] 문`, `[00:08.86] 을`. The first says where
//! the lines break, the second when each piece is sung; together they are
//! lyrics that can be lit a syllable at a time, the way a karaoke screen does.
//!
//! The pieces are laid along the lines in order, by their letters alone —
//! spaces, punctuation and case are what the two records most often differ
//! in, and none of them is sung. For each line the pieces are looked for a
//! little way ahead, starting near the line's own time and spelling it
//! exactly. A line the pieces do not have — an intro "la la la" one record
//! kept and the other did not — is left lit as a whole line; pieces no line
//! has are passed over. Only when no line at all lines up is it given up.

use super::{LyricLine, Syllable};

/// How far the first piece of a line may start from the line's own time.
/// Both records time the same singing, but not to the same hand.
const LINE_START_GAP_MS: u32 = 2_000;

/// The letters that count when comparing: letters and digits, lowercased.
fn letters(text: &str) -> Vec<char> {
    text.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

/// How many pieces ahead a line's first piece is looked for.
const LOOK_AHEAD: usize = 64;

/// The lines, each cut into the pieces the fragments time where they line
/// up, or `None` when not one line does.
pub fn with_syllables(lines: &[LyricLine], fragments: &[LyricLine]) -> Option<Vec<LyricLine>> {
    // Pieces with no letters — "…", "(" — time nothing that is sung.
    let pieces: Vec<(&LyricLine, Vec<char>)> = fragments
        .iter()
        .map(|f| (f, letters(&f.text)))
        .filter(|(_, l)| !l.is_empty())
        .collect();
    let mut next = 0;
    let mut matched = 0;
    let mut out = Vec::with_capacity(lines.len());

    for line in lines {
        let wanted = letters(&line.text);
        let found = if wanted.is_empty() {
            None
        } else {
            (next..pieces.len().min(next + LOOK_AHEAD))
                .filter(|&start| {
                    pieces[start].0.time_ms.abs_diff(line.time_ms) <= LINE_START_GAP_MS
                })
                .find_map(|start| spell(&wanted, &pieces[start..]).map(|taken| (start, taken)))
        };
        match found {
            Some((start, taken)) => {
                next = start + taken.len();
                matched += 1;
                out.push(LyricLine {
                    words: cut(&line.text, &taken),
                    ..line.clone()
                });
            }
            None => out.push(LyricLine {
                words: Vec::new(),
                ..line.clone()
            }),
        }
    }
    (matched > 0).then_some(out)
}

/// The pieces from the start of `pieces` that spell `wanted` exactly, each
/// with how many letters it covers, or `None` if they spell something else.
fn spell<'a>(
    wanted: &[char],
    pieces: &[(&'a LyricLine, Vec<char>)],
) -> Option<Vec<(&'a LyricLine, usize)>> {
    let mut taken = Vec::new();
    let mut have = 0;
    let mut pieces = pieces.iter();
    while have < wanted.len() {
        let (fragment, spelled) = pieces.next()?;
        if wanted.get(have..have + spelled.len()) != Some(spelled.as_slice()) {
            return None;
        }
        taken.push((*fragment, spelled.len()));
        have += spelled.len();
    }
    Some(taken)
}

/// The line's own text cut where the pieces fall, each piece keeping the
/// spaces and punctuation after its letters, so the pieces join back into
/// the line exactly.
fn cut(text: &str, taken: &[(&LyricLine, usize)]) -> Vec<Syllable> {
    let mut words: Vec<Syllable> = taken
        .iter()
        .map(|(fragment, _)| Syllable {
            time_ms: fragment.time_ms,
            text: String::new(),
        })
        .collect();
    let mut piece = 0;
    let mut counted = 0;
    for c in text.chars() {
        let counts = c.is_alphanumeric();
        // A letter past this piece's share starts the next piece.
        if counts {
            let share = taken[piece].1;
            if counted == share && piece + 1 < words.len() {
                piece += 1;
                counted = 0;
            }
            counted += c.to_lowercase().count();
        }
        words[piece].text.push(c);
    }
    words
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lyrics::lrc::parse_lrc;

    fn joined(line: &LyricLine) -> String {
        line.words.iter().map(|w| w.text.as_str()).collect()
    }

    #[test]
    fn times_each_syllable_of_each_line() {
        let lines = parse_lrc("[00:08.70]문을 열어\n[00:10.00]Hello, world!");
        let fragments = parse_lrc(
            "[00:08.75]문\n[00:08.86]을\n[00:09.08]열\n[00:09.30]어\n[00:10.05]hello\n[00:10.60]WORLD",
        );
        let merged = with_syllables(&lines, &fragments).expect("they line up");

        let first: Vec<(u32, &str)> = merged[0]
            .words
            .iter()
            .map(|w| (w.time_ms, w.text.as_str()))
            .collect();
        assert_eq!(
            first,
            vec![(8750, "문"), (8860, "을 "), (9080, "열"), (9300, "어")]
        );
        let second: Vec<&str> = merged[1].words.iter().map(|w| w.text.as_str()).collect();
        assert_eq!(second, vec!["Hello, ", "world!"]);
        for line in &merged {
            assert_eq!(joined(line), line.text);
        }
    }

    #[test]
    fn keeps_a_line_with_no_words_as_it_is() {
        let lines = parse_lrc("[00:01.00]la\n[00:02.00]\n[00:03.00]da");
        let fragments = parse_lrc("[00:01.00]la\n[00:03.00]da");
        let merged = with_syllables(&lines, &fragments).unwrap();
        assert!(merged[1].words.is_empty());
        assert_eq!(merged[2].words[0].time_ms, 3000);
    }

    #[test]
    fn gives_up_when_the_letters_differ() {
        let lines = parse_lrc("[00:01.00]one two");
        let fragments = parse_lrc("[00:01.00]one\n[00:01.50]three");
        assert!(with_syllables(&lines, &fragments).is_none());
    }

    #[test]
    fn gives_up_when_the_pieces_run_out() {
        let lines = parse_lrc("[00:01.00]one two");
        let fragments = parse_lrc("[00:01.00]one");
        assert!(with_syllables(&lines, &fragments).is_none());
    }

    #[test]
    fn does_not_time_a_line_by_pieces_far_from_it() {
        let lines = parse_lrc(
            "[00:01.00]one
[00:10.00]two",
        );
        let far = parse_lrc(
            "[00:01.00]one
[00:12.50]two",
        );
        let merged = with_syllables(&lines, &far).unwrap();
        assert!(merged[1].words.is_empty());
        let close = parse_lrc(
            "[00:01.00]one
[00:12.00]two",
        );
        assert_eq!(with_syllables(&lines, &close).unwrap()[1].words.len(), 1);
    }

    #[test]
    fn leaves_lines_the_pieces_do_not_have_as_whole_lines() {
        // The intro is in the lines and not in the pieces.
        let lines = parse_lrc(
            "[00:00.02]La la la
[00:08.01]잘 봐
[00:09.77]드러나는",
        );
        let fragments = parse_lrc(
            "[00:08.12]잘
[00:08.33]봐
[00:09.99]드
[00:10.23]러
[00:10.41]나
[00:10.57]는",
        );
        let merged = with_syllables(&lines, &fragments).unwrap();
        assert!(merged[0].words.is_empty());
        assert_eq!(merged[1].words.len(), 2);
        assert_eq!(merged[2].words.len(), 4);
    }

    #[test]
    fn passes_over_pieces_that_belong_to_no_line() {
        // An ad-lib between the two lines, which the lines do not have.
        let lines = parse_lrc(
            "[00:01.00]one
[00:02.00]two",
        );
        let fragments = parse_lrc(
            "[00:01.00]one
[00:01.50]yeah
[00:02.00]two",
        );
        let merged = with_syllables(&lines, &fragments).unwrap();
        assert!(merged.iter().all(|l| l.words.len() == 1));
        assert_eq!(merged[1].words[0].time_ms, 2000);
    }

    #[test]
    fn looks_only_so_far_ahead_for_a_line() {
        let lines = parse_lrc(
            "[00:01.00]one
[00:02.00]two",
        );
        let padding: String = (0..LOOK_AHEAD)
            .map(|_| {
                "[00:01.50]yeah
"
            })
            .collect();
        let fragments = parse_lrc(&format!(
            "[00:01.00]one
{padding}[00:02.00]two"
        ));
        let merged = with_syllables(&lines, &fragments).unwrap();
        assert!(merged[1].words.is_empty());
    }

    #[test]
    fn does_not_time_two_lines_by_the_same_piece() {
        // "la" twice, close together: the second line has the second piece.
        let lines = parse_lrc(
            "[00:01.00]la
[00:01.50]la",
        );
        let fragments = parse_lrc(
            "[00:01.00]la
[00:01.50]la",
        );
        let merged = with_syllables(&lines, &fragments).unwrap();
        assert_eq!(merged[1].words[0].time_ms, 1500);
    }

    #[test]
    fn a_piece_with_no_letters_times_nothing() {
        let lines = parse_lrc("[00:01.00]one two");
        let fragments = parse_lrc(
            "[00:01.00]one
[00:01.20]…
[00:01.50]two",
        );
        let merged = with_syllables(&lines, &fragments).unwrap();
        let pieces: Vec<&str> = merged[0].words.iter().map(|w| w.text.as_str()).collect();
        assert_eq!(pieces, vec!["one ", "two"]);
    }
}
