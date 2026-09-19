//! Telling Japanese written in Latin letters from Japanese itself.
//!
//! Lyrics sites often hold a song twice: in its own script, and romanized —
//! "kimi no koe ga kikoeru" for 君の声が聞こえる. Both are "the lyrics", and
//! both match on title, artist and length, so nothing else tells them apart.
//! The song's own script is the one to show.
//!
//! Romanized Japanese has a shape English does not: every word breaks cleanly
//! into Japanese syllables — a vowel, a consonant and a vowel, "shi", "tsu", a
//! final "n", a doubled consonant before the next syllable. "the", "love",
//! "street" do not. So lyrics in Latin letters whose words mostly break that
//! way are taken to be a romanization. Nothing here needs to know the song.

use super::LyricLine;

fn is_vowel(b: u8) -> bool {
    matches!(b, b'a' | b'i' | b'u' | b'e' | b'o')
}

/// Consonants a romanized syllable can start with. No `l`, `q`, `v` or `x`:
/// Japanese has none, which is most of why English fails this.
fn is_consonant(b: u8) -> bool {
    matches!(
        b,
        b'k' | b's'
            | b't'
            | b'n'
            | b'h'
            | b'm'
            | b'y'
            | b'r'
            | b'w'
            | b'g'
            | b'z'
            | b'd'
            | b'b'
            | b'p'
            | b'j'
            | b'f'
            | b'c'
    )
}

/// Whether a lowercase ASCII word breaks entirely into Japanese syllables.
pub fn is_romaji_word(word: &str) -> bool {
    let w = word.as_bytes();
    if w.is_empty() {
        return false;
    }
    let mut i = 0;
    while i < w.len() {
        let c = w[i];
        let next = w.get(i + 1).copied();
        if is_vowel(c) {
            i += 1;
            continue;
        }
        // A syllabic "n": at the end, or before anything but a vowel or "y".
        if c == b'n' && next.map_or(true, |n| !is_vowel(n) && n != b'y') {
            i += 1;
            continue;
        }
        // A doubled consonant is the small "tsu": "kitto", "zutto".
        if next == Some(c) && is_consonant(c) && c != b'n' {
            i += 1;
            continue;
        }
        // "shi", "chi", "tsu" and their "sha", "cho" kin.
        let two = &w[i..w.len().min(i + 2)];
        if matches!(two, b"sh" | b"ch" | b"ts") && w.get(i + 2).copied().is_some_and(is_vowel) {
            i += 3;
            continue;
        }
        // A consonant, perhaps a "y", then a vowel: "ka", "kyo".
        if is_consonant(c) && c != b'c' {
            if next.is_some_and(is_vowel) {
                i += 2;
                continue;
            }
            if next == Some(b'y') && w.get(i + 2).copied().is_some_and(is_vowel) {
                i += 3;
                continue;
            }
        }
        return false;
    }
    true
}

/// A letter in a script other than Latin: kana, kanji, Hangul, Cyrillic, …
fn is_non_latin_letter(c: char) -> bool {
    c.is_alphabetic()
        && !c.is_ascii()
        && !matches!(c, '\u{00c0}'..='\u{024f}' | '\u{1e00}'..='\u{1eff}')
}

/// Words fewer than this, and there is not enough to judge by.
const MIN_WORDS: usize = 20;
/// The share of words that must break into syllables.
const ROMAJI_SHARE: f64 = 0.7;

/// Letters of another script may make up at most this share of the letters
/// for the text still to count as written in Latin ones. Not none: lyrics
/// typed by hand carry the odd look-alike — a Cyrillic "е" where an "e" was
/// meant — and one of those is not a song in its own script. A song that is
/// has hundreds.
const STRAY_SHARE: f64 = 0.02;

/// A long vowel as romanizations mark it — "ō", "ū", "â" — as the plain vowel,
/// so "Sōdayo" is read as one word rather than split at the macron.
fn plain_vowel(c: char) -> char {
    match c {
        'ā' | 'â' | 'Ā' | 'Â' => 'a',
        'ī' | 'î' | 'Ī' | 'Î' => 'i',
        'ū' | 'û' | 'Ū' | 'Û' => 'u',
        'ē' | 'ê' | 'Ē' | 'Ê' => 'e',
        'ō' | 'ô' | 'Ō' | 'Ô' => 'o',
        other => other,
    }
}

/// Whether lyrics look like Japanese written in Latin letters.
///
/// Only lyrics in Latin letters, give or take a stray look-alike: text with
/// a real share of another script is a song that uses it, and is already in
/// its own script.
pub fn looks_romanized(text: &str) -> bool {
    let letters = text.chars().filter(|c| c.is_alphabetic()).count();
    let stray = text.chars().filter(|&c| is_non_latin_letter(c)).count();
    if letters == 0 || stray as f64 / letters as f64 > STRAY_SHARE {
        return false;
    }
    let folded: String = text.chars().map(plain_vowel).collect();
    let words: Vec<String> = folded
        .split(|c: char| !c.is_ascii_alphabetic() && c != '\'')
        .filter(|w| w.len() >= 2)
        .map(str::to_ascii_lowercase)
        .collect();
    if words.len() < MIN_WORDS {
        return false;
    }
    let romaji = words.iter().filter(|w| is_romaji_word(w)).count();
    romaji as f64 / words.len() as f64 >= ROMAJI_SHARE
}

pub fn lines_romanized(lines: &[LyricLine]) -> bool {
    let text: Vec<&str> = lines.iter().map(|l| l.text.as_str()).collect();
    looks_romanized(&text.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn breaks_japanese_syllables() {
        for w in [
            "kimi",
            "no",
            "koe",
            "ga",
            "shinjitsu",
            "kitto",
            "zutto",
            "tokyo",
            "san",
            "chiisana",
            "kyou",
            "watashi",
            "arigatou",
            "konnichiwa",
            "fuyu",
            "jibun",
        ] {
            assert!(is_romaji_word(w), "{w}");
        }
    }

    #[test]
    fn does_not_break_english() {
        for w in [
            "the", "love", "street", "night", "want", "baby", "world", "xx", "you're", "come",
            "can",
        ] {
            assert!(!is_romaji_word(w), "{w}");
        }
    }

    const ROMAJI: &str = "kimi no koe ga kikoeru\nzutto mae kara shitteita\nsora no iro mo kaze no oto mo\nsubete ga kagayaite ita\nnamida wo fuite aruite yuku\nashita wa kitto hareru kara";

    #[test]
    fn recognises_romanized_japanese() {
        assert!(looks_romanized(ROMAJI));
    }

    #[test]
    fn leaves_english_alone() {
        let english = "I walked along the empty street tonight\nthinking of the words you never said\nevery light was fading into grey\nand still I hear you calling out my name\nhold me close before the morning comes";
        assert!(!looks_romanized(english));
    }

    #[test]
    fn leaves_the_song_s_own_script_alone() {
        assert!(!looks_romanized("君の声が聞こえる\nずっと前から知っていた"));
        // A Japanese song with English in it is in its own script already.
        assert!(!looks_romanized(&format!("{ROMAJI}\n夢の中")));
    }

    #[test]
    fn a_stray_look_alike_letter_does_not_make_it_another_script() {
        // A Cyrillic "е" typed for an "e", as hand-made lyrics carry.
        let typo = ROMAJI.replace("hareru", "harеru");
        assert!(looks_romanized(&typo));
    }

    #[test]
    fn reads_long_vowels_as_vowels() {
        let long = "Sōdayo mō teokure Teikōshinaide anata no make ".repeat(4);
        assert!(looks_romanized(&long));
    }

    #[test]
    fn needs_enough_words_to_judge() {
        assert!(!looks_romanized("kimi no koe ga"));
    }
}
