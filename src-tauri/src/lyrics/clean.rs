//! Telling whether two sources are talking about the same song.
//!
//! Spotify's titles carry what the lyrics sites leave out — "2011 Remaster",
//! "feat. …", "Radio Edit", "Slowed + Reverb" — so a title is cleaned before it
//! is searched for. And a search answers with anything that looks like the
//! words asked for, so what comes back is checked against the song: the same
//! title once cleaned, one of the same artists, and a length close enough that
//! the timings belong to this recording and not another one.

/// Words that mark a part of a title as describing the recording rather than
/// naming the song. Matched as whole words, so "Alive" is not "live".
const NOISE_WORDS: &[&str] = &[
    "feat",
    "ft",
    "featuring",
    "prod",
    "remaster",
    "remastered",
    "live",
    "edit",
    "version",
    "mix",
    "sped",
    "slowed",
    "reverb",
    "nightcore",
    "mono",
    "stereo",
    "bonus",
    "demo",
];

/// Words that only mark noise at the start of a bracket: "(with Someone)",
/// "(From the film …)". Inside a title they are ordinary words.
const LEADING_NOISE: &[&str] = &["with", "from"];

/// Lowercase ASCII words, split on anything else.
fn words(text: &str) -> impl Iterator<Item = String> + '_ {
    text.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_ascii_lowercase)
}

fn is_noise(part: &str, bracketed: bool) -> bool {
    let mut all = words(part).peekable();
    if bracketed {
        if let Some(first) = all.peek() {
            if LEADING_NOISE.contains(&first.as_str()) {
                return true;
            }
        }
    }
    all.any(|w| NOISE_WORDS.contains(&w.as_str()))
}

/// Brackets whose contents describe the recording, taken out.
fn strip_brackets(title: &str) -> String {
    let mut out = String::with_capacity(title.len());
    let mut rest = title;
    while let Some(open) = rest.find(['(', '[']) {
        let close_char = if rest[open..].starts_with('(') {
            ')'
        } else {
            ']'
        };
        let Some(len) = rest[open + 1..].find(close_char) else {
            break;
        };
        let inner = &rest[open + 1..open + 1 + len];
        out.push_str(&rest[..open]);
        if !is_noise(inner, true) {
            out.push_str(&rest[open..open + len + 2]);
        }
        rest = &rest[open + len + 2..];
    }
    out.push_str(rest);
    out
}

/// A title as the lyrics sites are likely to have it.
///
/// `"Cry For Me - Slowed + Reverb (feat. Bubi)"` becomes `"Cry For Me"`. A
/// title that would be left with nothing is returned as it was.
pub fn clean_title(title: &str) -> String {
    let unbracketed = strip_brackets(title);

    // " - Remastered 2011", " - Live at …": the first dashed part that
    // describes the recording ends the title.
    let mut kept: Vec<&str> = Vec::new();
    for (i, part) in unbracketed.split(" - ").enumerate() {
        if i > 0 && is_noise(part, false) {
            break;
        }
        kept.push(part);
    }
    let mut joined = kept.join(" - ");

    // An unbracketed "feat." runs to the end.
    let lower = joined.to_ascii_lowercase();
    if let Some(at) = [" feat. ", " feat ", " ft. ", " featuring "]
        .iter()
        .filter_map(|marker| lower.find(marker))
        .min()
    {
        joined.truncate(at);
    }

    let tidy = joined
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|c: char| c == '-' || c.is_whitespace())
        .to_string();
    if tidy.is_empty() {
        title.trim().to_string()
    } else {
        tidy
    }
}

/// The first artist of Spotify's comma-joined list, for searching.
pub fn primary_artist(artists: &str) -> &str {
    artists.split(", ").next().unwrap_or(artists).trim()
}

/// Lowercase, `&` as "and", everything but letters and digits as spaces.
pub fn normalize(text: &str) -> String {
    text.replace('&', " and ")
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_lowercase().next().unwrap_or(c)
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// The separate names in a credit, normalized, with a leading "the" dropped
/// so "The Band" and "Band" are one name.
fn artist_names(credit: &str) -> Vec<String> {
    let mut parts = vec![credit.to_string()];
    for separator in [
        ", ", " & ", " feat. ", " feat ", " ft. ", " x ", " / ", "; ",
    ] {
        parts = parts
            .iter()
            .flat_map(|p| p.split(separator).map(str::to_string).collect::<Vec<_>>())
            .collect();
    }
    parts
        .iter()
        .map(|p| normalize(p))
        .map(|n| n.strip_prefix("the ").map(str::to_string).unwrap_or(n))
        .filter(|n| !n.is_empty())
        .collect()
}

/// Whether a found title and artist are the song wanted.
///
/// Titles match once both are cleaned and normalized — exactly, since one
/// title inside another is as often a different song ("Song", "Other Song")
/// as the same one, and cleaning already takes off what the sites differ on.
/// Artists match when one of
/// the names credited on either side is the same name — whole names, so "Band"
/// is not found in "Another Band". Sites list collaborators differently, so
/// one shared name is enough.
pub fn same_song(want_title: &str, want_artists: &str, got_title: &str, got_artists: &str) -> bool {
    if normalize(&clean_title(want_title)) != normalize(&clean_title(got_title)) {
        return false;
    }
    let got = artist_names(got_artists);
    artist_names(want_artists).iter().any(|w| got.contains(w))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_what_describes_the_recording() {
        assert_eq!(
            clean_title("Cry For Me - Slowed + Reverb (feat. Bubi)"),
            "Cry For Me"
        );
        assert_eq!(
            clean_title("Bohemian Rhapsody - Remastered 2011"),
            "Bohemian Rhapsody"
        );
        assert_eq!(clean_title("Song (Remastered 2009)"), "Song");
        assert_eq!(clean_title("Song [feat. Someone]"), "Song");
        assert_eq!(clean_title("Song (with Someone)"), "Song");
        assert_eq!(clean_title("Song - Live at Wembley"), "Song");
        assert_eq!(clean_title("Song - Radio Edit"), "Song");
        assert_eq!(clean_title("Song - Original Mix"), "Song");
        assert_eq!(clean_title("Song - Single Version"), "Song");
        assert_eq!(clean_title("Song - Sped Up"), "Song");
        assert_eq!(clean_title("Song feat. Someone"), "Song");
    }

    #[test]
    fn leaves_what_names_the_song() {
        assert_eq!(clean_title("Alive"), "Alive");
        assert_eq!(clean_title("Live and Let Die"), "Live and Let Die");
        assert_eq!(clean_title("Song (Part 2)"), "Song (Part 2)");
        assert_eq!(clean_title("Song - Part 2"), "Song - Part 2");
        assert_eq!(clean_title("Stay With Me"), "Stay With Me");
        assert_eq!(clean_title("Song - Remix"), "Song - Remix");
        assert_eq!(clean_title("Gülpembe"), "Gülpembe");
    }

    #[test]
    fn never_cleans_a_title_away() {
        assert_eq!(clean_title("(Live)"), "(Live)");
    }

    #[test]
    fn searches_by_the_first_artist() {
        assert_eq!(primary_artist("Daft Punk, Pharrell Williams"), "Daft Punk");
        assert_eq!(primary_artist("Solo"), "Solo");
    }

    #[test]
    fn recognises_the_same_song_written_differently() {
        assert!(same_song(
            "Get Lucky (feat. Pharrell Williams)",
            "Daft Punk, Pharrell Williams",
            "Get Lucky",
            "Daft Punk, Pharrell Williams, Nile Rodgers"
        ));
        assert!(same_song(
            "Rock & Roll",
            "Band",
            "Rock and Roll",
            "The Band"
        ));
        assert!(same_song("Şımarık", "Tarkan", "şımarık", "TARKAN"));
    }

    #[test]
    fn refuses_another_song_or_another_artist() {
        assert!(!same_song(
            "Get Lucky",
            "Daft Punk",
            "Get Lucky",
            "Some Cover Band"
        ));
        assert!(!same_song("Hello", "Adele", "Goodbye", "Adele"));
        assert!(!same_song("Hello", "Adele", "Hello", ""));
        assert!(!same_song("Song", "Band", "Song", "Another Band"));
        assert!(!same_song("Song", "Band", "Other Song", "Band"));
    }
}
