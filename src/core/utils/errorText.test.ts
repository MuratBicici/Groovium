import { describe, expect, it } from 'vitest';
import { errorText } from './errorText';

/** Whatever was thrown, as something that can be put in front of somebody. */
describe('the text of a failure', () => {
  it('is an error message as it is', () => {
    expect(errorText(new Error('Spotify did not answer in time.'))).toBe(
      'Spotify did not answer in time.',
    );
  });

  it('is never "[object Object]" for what a Tauri command rejects with', () => {
    const text = errorText({ code: 'network', detail: 'dns lookup failed' });
    expect(text).not.toContain('[object Object]');
    expect(text).toBe('Could not reach Spotify. Check your internet connection.');
  });

  it('is the message of an object that carries one', () => {
    expect(errorText({ message: 'refused' })).toBe('refused');
  });

  it('is a string as it is', () => {
    expect(errorText('No such file.')).toBe('No such file.');
  });
});
