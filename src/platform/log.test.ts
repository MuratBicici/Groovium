import { describe as group, expect, it } from 'vitest';
import { describe, line, redact } from './log';

/**
 * What is allowed into the log file.
 *
 * The file is meant to be pasted into an issue on a public repository without
 * anybody reading it first. The lines worth logging are the ones about things
 * going wrong, and those are exactly the lines that quote a URL, a response
 * body or a header — so each of these is a secret, or a piece of somebody's
 * listening, that an honest error message would otherwise carry out.
 */

const KEY = '0123456789abcdef0123456789abcdef';

group('keeping secrets out of the log', () => {
  it('hides a Last.fm key in the URL an error quotes', () => {
    // reqwest's error text includes the full URL, query string and all.
    const out = redact(
      `Could not reach Last.fm: error sending request for url (https://ws.audioscrobbler.com/2.0/?method=track.getsimilar&api_key=${KEY}&format=json)`,
    );
    expect(out).not.toContain(KEY);
    expect(out).toContain('method=track.getsimilar');
  });

  it('hides a key by its name even when it does not look like one', () => {
    // A Last.fm key is 32 hex characters and the bare-hex rule would catch it
    // on its own. This is for the key that has been mistyped, pasted with
    // something else, or replaced by a format nobody has seen yet.
    const out = redact('https://ws.audioscrobbler.com/2.0/?api_key=pasted-the-wrong-thing&format=json');
    expect(out).not.toContain('pasted-the-wrong-thing');
    expect(out).toContain('format=json');
  });

  it('hides a bearer token', () => {
    const out = redact('Authorization: Bearer BQD3xk-9_aZ.token/value=');
    expect(out).toBe('Authorization: Bearer [redacted]');
  });

  it('hides tokens in a response body', () => {
    const out = redact('{"access_token":"BQDabc","token_type":"Bearer","refresh_token":"AQCdef"}');
    expect(out).not.toContain('BQDabc');
    expect(out).not.toContain('AQCdef');
    expect(out).toContain('"token_type"');
  });

  it('hides the pieces of an OAuth exchange', () => {
    const out = redact('POST /api/token grant_type=authorization_code&code=AQBx&code_verifier=abc123&client_id=xyz');
    expect(out).not.toContain('AQBx');
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('client_id=xyz');
    expect(out).toContain('grant_type=authorization_code');
  });

  it('hides a Client ID or key that arrives with no name in front of it', () => {
    expect(redact(`That key is ${KEY}, which is not a Last.fm key.`)).not.toContain(KEY);
  });

  it('leaves what somebody searched for out', () => {
    // Not a secret, but a log of searches is a log of what somebody listens to.
    const out = redact('Spotify API 500 on /search?q=track:Kiss%20Me%20artist:Sixpence&type=track');
    expect(out).not.toContain('Kiss');
    expect(out).toContain('type=track');
  });

  it('leaves an ordinary line alone', () => {
    // A commit hash is forty hex characters, not thirty-two, and a fault line
    // with no secret in it should come out exactly as it went in.
    const plain = 'stalled: no route to Spotify (9a2a65e1f3c4b5a6d7e8f9a0b1c2d3e4f5a6b7c8)';
    expect(redact(plain)).toBe(plain);
  });
});

group('writing a line', () => {
  it('names where it came from and what was thrown', () => {
    const err = Object.assign(new Error('Spotify did not answer in time.'), {
      name: 'SpotifyError',
      status: 408,
    });
    expect(line('station', 'the spotify search lookup failed', err)).toBe(
      '[station] the spotify search lookup failed — SpotifyError 408: Spotify did not answer in time.',
    );
  });

  it('redacts what was thrown as well as the message', () => {
    const err = new Error(`Could not reach Last.fm: url (https://x/?api_key=${KEY})`);
    expect(line('station', 'track lookup failed', err)).not.toContain(KEY);
  });

  it('describes something thrown that was not an Error', () => {
    expect(describe('offline')).toBe('offline');
    expect(describe({ status: 429 })).toBe('{"status":429}');
  });
});
