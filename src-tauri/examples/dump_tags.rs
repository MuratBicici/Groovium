//! Print what the tag reader sees for a given audio file.
//!
//! A diagnostic for the "why does this file show up as Unknown Artist?" case.
//! Reads through the same crate the app uses, so what it prints is exactly what
//! `src/metadata.rs` would produce.
//!
//! Usage:
//!   cargo run --example dump_tags -- "C:\path\to\track.mp3" [more files...]

use std::path::Path;

use lofty::prelude::*;
use lofty::probe::read_from_path;

fn main() {
    let paths: Vec<String> = std::env::args().skip(1).collect();

    if paths.is_empty() {
        eprintln!("usage: cargo run --example dump_tags -- <file> [file...]");
        std::process::exit(2);
    }

    for path in paths {
        dump(Path::new(&path));
        println!();
    }
}

fn dump(path: &Path) {
    println!("── {}", path.display());

    let tagged = match read_from_path(path) {
        Ok(tagged) => tagged,
        Err(e) => {
            println!("   unreadable: {e}");
            return;
        }
    };

    let properties = tagged.properties();
    println!("   file type   {:?}", tagged.file_type());
    println!("   duration    {} ms", properties.duration().as_millis());
    println!("   sample rate {:?}", properties.sample_rate());
    println!("   tags found  {}", tagged.tags().len());

    let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) else {
        println!("   no tags — the app would fall back to the filename");
        return;
    };

    println!("   tag type    {:?}", tag.tag_type());
    println!("   title       {:?}", tag.title());
    println!("   artist      {:?}", tag.artist());
    println!("   album       {:?}", tag.album());
    println!("   pictures    {}", tag.picture_count());

    for (i, picture) in tag.pictures().iter().enumerate() {
        println!(
            "     [{i}] {:?} {} bytes, type {:?}",
            picture.mime_type(),
            picture.data().len(),
            picture.pic_type()
        );
    }
}
