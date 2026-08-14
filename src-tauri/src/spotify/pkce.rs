//! PKCE (RFC 7636) parameter generation.
//!
//! A desktop app cannot keep a client secret, so Spotify requires the PKCE
//! extension: the client invents a random `verifier`, sends its SHA-256 hash as
//! the `challenge`, and proves ownership later by presenting the verifier. An
//! intercepted authorization code is useless without it.
//!
//! Deliberately not using the `oauth2` crate. We need exactly one flow, and the
//! parts that matter here — cryptographic randomness, the S256 transform, and a
//! constant-time-ish `state` comparison — are small enough to verify directly.
//! `challenge_for` is checked against the official RFC 7636 Appendix B test
//! vector below, which is stronger evidence than "we used a library".

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};

/// 32 bytes of entropy encodes to a 43-character verifier — the RFC's minimum,
/// and every character lands inside its allowed unreserved set.
const VERIFIER_BYTES: usize = 32;
/// 16 bytes is plenty for a CSRF nonce that lives for one browser round trip.
const STATE_BYTES: usize = 16;

pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
    pub state: String,
}

pub fn generate() -> Pkce {
    let verifier = random_token(VERIFIER_BYTES);
    let challenge = challenge_for(&verifier);
    Pkce {
        verifier,
        challenge,
        state: random_token(STATE_BYTES),
    }
}

/// The S256 transform: base64url(sha256(ascii(verifier))), unpadded.
pub fn challenge_for(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// Cryptographically secure random token in the base64url alphabet.
///
/// `getrandom` reads from the OS entropy source; a `rand` thread RNG would be
/// the wrong tool for something an attacker must not be able to predict.
pub fn random_token(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).expect("OS entropy source unavailable");
    URL_SAFE_NO_PAD.encode(buf)
}

/// Compare the returned `state` to the one we sent.
///
/// A mismatch means the callback did not originate from the request we started,
/// so the code that came with it must not be exchanged.
pub fn state_matches(expected: &str, received: &str) -> bool {
    // Length check first, then a full-width comparison that does not bail on the
    // first differing byte.
    if expected.len() != received.len() {
        return false;
    }
    expected
        .bytes()
        .zip(received.bytes())
        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 7636 Appendix B, the specification's own worked example.
    #[test]
    fn matches_the_rfc_7636_test_vector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
        assert_eq!(challenge_for(verifier), expected);
    }

    #[test]
    fn verifier_length_is_within_the_rfc_range() {
        let pkce = generate();
        assert!(
            (43..=128).contains(&pkce.verifier.len()),
            "verifier was {} characters",
            pkce.verifier.len()
        );
    }

    #[test]
    fn verifier_uses_only_unreserved_characters() {
        // RFC 7636 section 4.1: ALPHA / DIGIT / "-" / "." / "_" / "~"
        let pkce = generate();
        assert!(pkce
            .verifier
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_' | '~')));
    }

    #[test]
    fn every_run_produces_fresh_values() {
        let a = generate();
        let b = generate();
        assert_ne!(a.verifier, b.verifier);
        assert_ne!(a.state, b.state);
    }

    #[test]
    fn state_comparison_accepts_only_an_exact_match() {
        assert!(state_matches("abc123", "abc123"));
        assert!(!state_matches("abc123", "abc124"));
        assert!(!state_matches("abc123", "abc12"));
        assert!(!state_matches("abc123", ""));
        assert!(!state_matches("", "abc123"));
    }
}
