//! NetEase Cloud Music: the last place asked, when LRCLIB has no timings.
//!
//! This is not a published API. It is the endpoint NetEase's own web player
//! uses, which answers without a key today. The neighbouring search endpoints
//! already answer with encrypted bodies or a phone-verification wall, so this
//! one may follow at any time. Nothing here may therefore be load-bearing: any
//! failure is a quiet "nothing from NetEase", and the whole source is switched
//! off by `NETEASE_ENABLED` in the module above.
//!
//! What it sends is the cleaned title and the first artist, to a service in
//! China. PRIVACY.md has to say so before this reaches a release.

use serde::Deserialize;

use super::clean::{primary_artist, same_song};
use super::lrc::{parse_lrc, words_of};
use super::{fetch, pick_nearest, Found, LyricLine, LyricsResult, Query, SYNCED_GAP_MS};

const SEARCH: &str = "https://music.163.com/api/cloudsearch/pc";
const LYRIC: &str = "https://music.163.com/api/song/lyric";
const REFERER: &str = "https://music.163.com/";

#[derive(Deserialize, Debug)]
struct SearchAnswer {
    result: Option<SearchResult>,
}

#[derive(Deserialize, Debug)]
struct SearchResult {
    #[serde(default)]
    songs: Vec<Song>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct Song {
    pub id: u64,
    pub name: String,
    #[serde(default)]
    pub ar: Vec<Artist>,
    /// Length in milliseconds.
    #[serde(default)]
    pub dt: u32,
    #[serde(default)]
    pub al: Option<Album>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct Artist {
    pub name: String,
}

#[derive(Deserialize, Debug, Clone)]
pub struct Album {
    pub name: String,
}

impl Song {
    fn artists(&self) -> String {
        self.ar
            .iter()
            .map(|a| a.name.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    }
}

#[derive(Deserialize, Debug, Default)]
struct LyricAnswer {
    #[serde(default)]
    lrc: Option<LyricBody>,
    #[serde(default)]
    nolyric: bool,
    #[serde(default)]
    uncollected: bool,
}

#[derive(Deserialize, Debug, Default)]
struct LyricBody {
    #[serde(default)]
    lyric: String,
}

pub async fn find(q: &Query) -> Result<Option<Found>, String> {
    let artist = primary_artist(&q.artist);
    let terms = format!("{} {artist}", q.clean_title);
    let url = reqwest::Url::parse_with_params(
        SEARCH,
        &[
            ("s", terms.as_str()),
            ("type", "1"),
            ("limit", "10"),
            ("offset", "0"),
        ],
    )
    .map_err(|e| format!("Could not build the NetEase address: {e}"))?;
    let Some(body) = fetch(url, Some(REFERER)).await? else {
        return Ok(None);
    };
    let answer: SearchAnswer =
        serde_json::from_str(&body).map_err(|e| format!("Unreadable NetEase search: {e}"))?;
    let songs = answer.result.map(|r| r.songs).unwrap_or_default();
    let Some(song) = choose(&songs, q) else {
        return Ok(None);
    };

    let url = reqwest::Url::parse_with_params(
        LYRIC,
        &[("os", "pc"), ("id", &song.id.to_string()), ("lv", "-1")],
    )
    .map_err(|e| format!("Could not build the NetEase address: {e}"))?;
    let Some(body) = fetch(url, Some(REFERER)).await? else {
        return Ok(None);
    };
    let lyric: LyricAnswer =
        serde_json::from_str(&body).map_err(|e| format!("Unreadable NetEase lyrics: {e}"))?;

    let result = result_of(&lyric, song.dt.abs_diff(q.duration_ms) <= SYNCED_GAP_MS);
    Ok(Some(Found {
        result,
        track_name: song.name.clone(),
        artist_name: song.artists(),
        album_name: song.al.as_ref().map(|a| a.name.clone()).unwrap_or_default(),
        duration_ms: song.dt,
        via: "netease",
    }))
}

/// The search result to use: this song, nearest in length.
///
/// NetEase lists covers, karaoke versions and translations of a title beside
/// the original, so the artist check matters more here than anywhere.
pub fn choose<'a>(songs: &'a [Song], q: &Query) -> Option<&'a Song> {
    let same: Vec<&Song> = songs
        .iter()
        .filter(|s| same_song(&q.title, &q.artist, &s.name, &s.artists()))
        .collect();
    pick_nearest(&same, q.duration_ms, |s| s.dt, |_| true)
}

/// NetEase's marker for a piece with no words: "pure music, please enjoy".
const PURE_MUSIC: &str = "纯音乐";

fn result_of(answer: &LyricAnswer, in_step: bool) -> LyricsResult {
    if answer.nolyric {
        return LyricsResult::Instrumental;
    }
    if answer.uncollected {
        return LyricsResult::NotFound;
    }
    let text = answer.lrc.as_ref().map(|l| l.lyric.as_str()).unwrap_or("");
    if text.contains(PURE_MUSIC) {
        return LyricsResult::Instrumental;
    }
    let lines = without_credits(parse_lrc(text));
    if lines.iter().any(|l| !l.text.is_empty()) {
        if in_step {
            return LyricsResult::Synced(lines);
        }
        return LyricsResult::Plain(words_of(&lines));
    }
    // No stamps at all: the words as they are, if there are any.
    let plain = text.trim();
    if plain.is_empty() || plain.starts_with('[') {
        LyricsResult::NotFound
    } else {
        LyricsResult::Plain(plain.to_string())
    }
}

/// Credit words NetEase writes in English on some tracks' opening lines.
const CREDIT_WORDS: &[&str] = &[
    "composer",
    "lyricist",
    "lyrics",
    "arranger",
    "producer",
    "mixed by",
    "mastered by",
    "written by",
];

fn is_cjk(c: char) -> bool {
    matches!(c, '\u{3040}'..='\u{30ff}' | '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}' | '\u{ac00}'..='\u{d7af}')
}

/// NetEase opens many songs with the credits, as lines of the lyrics: "作词 :
/// …", "作曲 : …", "吉他：…". A short label before a colon, in Chinese or a
/// credit word, is a credit and not a lyric.
pub fn without_credits(lines: Vec<LyricLine>) -> Vec<LyricLine> {
    lines
        .into_iter()
        .filter(|line| {
            let Some(at) = line.text.find([':', '：']) else {
                return true;
            };
            let label = line.text[..at].trim();
            let short = label.chars().count() <= 12;
            let credit = label.chars().any(is_cjk)
                || CREDIT_WORDS.contains(&label.to_ascii_lowercase().as_str());
            !(short && credit)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn song(id: u64, name: &str, artist: &str, dt: u32) -> Song {
        Song {
            id,
            name: name.into(),
            ar: vec![Artist {
                name: artist.into(),
            }],
            dt,
            al: None,
        }
    }

    #[test]
    fn chooses_the_original_over_covers_and_edits() {
        let q = Query::new(
            "Get Lucky (feat. Pharrell Williams)",
            "Daft Punk, Pharrell Williams",
            "",
            369_000,
        );
        let songs = [
            song(1, "Get Lucky", "Some Cover Band", 369_000),
            song(
                2,
                "Get Lucky (Drop Out Orchestra Edit)",
                "Daft Punk",
                331_000,
            ),
            song(3, "Get Lucky", "Daft Punk", 369_684),
        ];
        assert_eq!(choose(&songs, &q).map(|s| s.id), Some(3));
    }

    #[test]
    fn takes_the_credits_out_of_the_lyrics() {
        let lines = parse_lrc(
            "[00:00.000] 作曲 : Pharrell Williams\n[00:01.000] 作词 : Someone\n[00:09.000]吉他：Nile Rodgers\n[00:30.900]Like the legend of the Phoenix\n[00:40.000]Time: it goes on",
        );
        let kept: Vec<String> = without_credits(lines).into_iter().map(|l| l.text).collect();
        assert_eq!(
            kept,
            vec!["Like the legend of the Phoenix", "Time: it goes on"]
        );

        // A sung line with a colon in it is not a credit, however Chinese it is.
        let sung = parse_lrc("[00:10.00]这是一句很长的中文歌词里面有冒号：然后继续");
        assert_eq!(without_credits(sung).len(), 1);
    }

    #[test]
    fn reads_what_the_answer_holds() {
        let synced = LyricAnswer {
            lrc: Some(LyricBody {
                lyric: "[00:01.00]one\n[00:02.00]two".into(),
            }),
            ..Default::default()
        };
        assert!(matches!(result_of(&synced, true), LyricsResult::Synced(_)));
        assert_eq!(
            result_of(&synced, false),
            LyricsResult::Plain("one\ntwo".into())
        );

        let pure = LyricAnswer {
            lrc: Some(LyricBody {
                lyric: "[00:00.00]纯音乐，请欣赏".into(),
            }),
            ..Default::default()
        };
        assert_eq!(result_of(&pure, true), LyricsResult::Instrumental);

        let none = LyricAnswer {
            nolyric: true,
            ..Default::default()
        };
        assert_eq!(result_of(&none, true), LyricsResult::Instrumental);

        let credits_only = LyricAnswer {
            lrc: Some(LyricBody {
                lyric: "[00:00.00-1] 作曲 : Randy Brecker\n".into(),
            }),
            ..Default::default()
        };
        assert_eq!(result_of(&credits_only, true), LyricsResult::NotFound);
    }

    #[test]
    fn reads_netease_json() {
        let body = r#"{"result":{"songs":[{"id":26349642,"name":"Get Lucky","ar":[{"id":1,"name":"Daft Punk"},{"id":2,"name":"Pharrell Williams"}],"dt":369684,"al":{"name":"Random Access Memories"}}]}}"#;
        let answer: SearchAnswer = serde_json::from_str(body).unwrap();
        let songs = answer.result.unwrap().songs;
        assert_eq!(songs[0].artists(), "Daft Punk, Pharrell Williams");
        assert_eq!(songs[0].dt, 369_684);
    }
}
